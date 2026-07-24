"""
Preblast feature — Slack handler and view-orchestration layer.

Phase 4 refactored this module to delegate all business logic to
``PreblastService`` (and subordinate services).  Direct ``DbManager`` usage
has been removed; data access flows through the application-layer services
whose repositories are backed by the F3 Nation REST API.

Exported function names are preserved for routing compatibility with
``routing.py``, ``home.py``, ``auto_preblast_send.py``, etc.
"""

from __future__ import annotations

import json
import random
import time
from dataclasses import dataclass
from logging import Logger
from typing import Any

from f3_data_models.models import Attendance, AttendanceType, EventInstance, Org
from slack_sdk.errors import SlackApiError
from slack_sdk.web import WebClient
from sqlalchemy import or_

from application.attendance import CO_Q_TYPE_ID, Q_TYPE_ID, AttendanceData
from application.attendance.service import AttendanceService
from application.event_instance import EventInstanceData
from application.event_instance.service import EventInstanceService
from application.event_type.service import EventTypeService
from application.preblast import PreblastEventTypeData
from application.preblast.service import PostMode, PreblastService
from features import backblast, connect
from features.calendar import get_preblast_action_blocks
from features.calendar.preblast_views import PreblastViews
from infrastructure.api_client import (
    get_api_attendance_repository,
    get_api_event_instance_repository,
    get_api_event_type_repository,
)
from utilities import constants
from utilities.bot_logger import post_bot_log
from utilities.builders import add_loading_form, update_submission_wait_view
from utilities.database.orm import SlackSettings
from utilities.database.special_queries import event_attendance_query, get_admin_users, get_aoq_users
from utilities.helper_functions import (
    current_date_cst,
    extract_state_values,
    fix_from_llm_tags,
    get_location_display_name,
    get_user,
    get_user_names,
    parse_rich_block,
    replace_user_channel_ids,
    reupload_file_as_bot,
    safe_convert,
    safe_get,
)
from utilities.slack import actions, orm

# ---------------------------------------------------------------------------
# Composition roots
# ---------------------------------------------------------------------------

_evt_svc: EventInstanceService | None = None
_att_svc: AttendanceService | None = None
_et_svc: EventTypeService | None = None
_pb_svc: PreblastService | None = None


def _build_event_instance_service() -> EventInstanceService:
    global _evt_svc
    if _evt_svc is None:
        _evt_svc = EventInstanceService(repository=get_api_event_instance_repository())
    return _evt_svc


def _build_attendance_service() -> AttendanceService:
    global _att_svc
    if _att_svc is None:
        _att_svc = AttendanceService(repository=get_api_attendance_repository())
    return _att_svc


def _build_event_type_service() -> EventTypeService:
    global _et_svc
    if _et_svc is None:
        _et_svc = EventTypeService(repository=get_api_event_type_repository())
    return _et_svc


def _build_preblast_service() -> PreblastService:
    global _pb_svc
    if _pb_svc is None:
        _pb_svc = PreblastService(
            event_instance_service=_build_event_instance_service(),
            attendance_service=_build_attendance_service(),
        )
    return _pb_svc


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


@dataclass
class PreblastInfo:
    """Structured preblast info returned by ``build_preblast_info``.

    .. note::
       ``preblast_blocks`` and ``action_blocks`` contain plain dicts (Slack
       block payloads) rather than ORM objects for Phase 4 compatibility.
    """
    event_record: EventInstanceData
    attendance_records: list[dict[str, Any]]
    preblast_blocks: list[dict[str, Any]]
    action_blocks: list[dict[str, Any]]
    user_is_q: bool = False
    attendance_slack_dict: dict[int, str] | None = None


# ---------------------------------------------------------------------------
# Legacy helpers (SlackSettings DB compatibility exception)
# ---------------------------------------------------------------------------


def get_preblast_channel(region_record: SlackSettings, preblast_info: PreblastInfo) -> str | None:
    """Return the Slack channel where the preblast should be posted.

    Fallback order is:
    1. Event meta ``slack_channel_id``
    2. Region default preblast destination channel
    3. AO Slack channel from org meta
    4. None
    """
    event = preblast_info.event_record
    if event.meta and event.meta.get("slack_channel_id"):
        return str(event.meta["slack_channel_id"])
    if (
        region_record.default_preblast_destination == constants.CONFIG_DESTINATION_SPECIFIED["value"]
        and region_record.preblast_destination_channel
    ):
        return region_record.preblast_destination_channel
    # Fallback to the AO's Slack channel from org meta
    org_meta = event.org_meta or {}
    if org_meta.get("slack_channel_id"):
        return str(org_meta["slack_channel_id"])
    return None


# ---------------------------------------------------------------------------
# HC thread reply
# ---------------------------------------------------------------------------


def post_hc_thread_reply(
    client: WebClient,
    logger: Logger,
    region_record: SlackSettings,
    preblast_channel: str | None,
    preblast_ts: str | None,
    slack_user_id: str,
    is_hc: bool,
    event_instance_id: int | None = None,
) -> None:
    """Post an optional announcement in the preblast thread when a user HCs or Un-HCs.

    Uses ``PreblastService`` deduplication helpers to avoid duplicate replies.
    """
    option = region_record.hc_announce_option
    if not option or option == "off" or not preblast_channel or not preblast_ts:
        return
    targets = region_record.hc_announce_targets or "both"
    if is_hc and targets == "unhc_only":
        return
    if not is_hc and targets == "hc_only":
        return

    if event_instance_id is not None:
        try:
            svc = _build_preblast_service()
            if not svc.check_and_mark_hc_announcement(event_instance_id, slack_user_id, is_hc=is_hc):
                return
        except Exception as e:
            logger.warning(f"HC dedupe check failed for event {event_instance_id}: {e}")

    user_mention = f"<@{slack_user_id}>"
    if option == "snarky":
        responses = constants.HC_SNARKY_RESPONSES if is_hc else constants.UNHC_SNARKY_RESPONSES
        text = random.choice(responses).format(user=user_mention)
    else:
        template = constants.HC_STANDARD_RESPONSE if is_hc else constants.UNHC_STANDARD_RESPONSE
        text = template.format(user=user_mention)
    try:
        client.chat_postMessage(channel=preblast_channel, thread_ts=preblast_ts, text=text)
    except Exception as e:
        logger.error(f"Error posting HC thread reply for event in channel {preblast_channel}: {e}")


def post_hc_failure_ephemeral(
    body: dict,
    client: WebClient,
    logger: Logger,
    metadata: dict,
    slack_user_id: str,
    text: str,
) -> None:
    """Notify the acting user that their HC mutation failed, when a channel is available."""
    channel_id = (
        safe_get(body, "channel", "id")
        or safe_get(body, "container", "channel_id")
        or safe_get(body, "message", "channel")
        or safe_get(metadata, "preblast_channel_id")
    )
    if not channel_id:
        logger.warning("Could not post HC failure ephemeral: no Slack channel available")
        return

    try:
        client.chat_postEphemeral(channel=channel_id, user=slack_user_id, text=text)
    except Exception as e:
        logger.error(f"Error posting HC failure ephemeral in channel {channel_id}: {e}")


# ---------------------------------------------------------------------------
# Middleware / routing
# ---------------------------------------------------------------------------


def preblast_middleware(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    if region_record.org_id is None:
        connect.build_connect_options_form(body, client, logger, context, region_record)
    else:
        build_event_preblast_select_form(body, client, logger, context, region_record)


# ---------------------------------------------------------------------------
# Select form
# ---------------------------------------------------------------------------


def build_event_preblast_select_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    """Open or update the preblast event-selector modal.

    Three sections:
      1. The user's upcoming Qs (events where they are Q/Co-Q, no preblast yet).
         Up to four are shown as buttons; the rest go in a dropdown select.
      2. A link to the calendar so the user can sign up to Q for an event.
      3. A button to create a preblast for an unscheduled event.
    """
    user_id = get_user(
        safe_get(body, "user", "id") or safe_get(body, "user_id"), region_record, client, logger
    ).user_id

    # Query for upcoming events where this user is Q or Co-Q, no preblast yet
    event_records = event_attendance_query(
        attendance_filter=[
            Attendance.user_id == user_id,
            Attendance.is_planned,
            Attendance.attendance_types.any(AttendanceType.id.in_([Q_TYPE_ID, CO_Q_TYPE_ID])),
        ],
        event_filter=[
            EventInstance.start_date >= current_date_cst(),
            EventInstance.preblast_ts.is_(None),
            EventInstance.is_active,
            or_(
                EventInstance.org_id == region_record.org_id,
                EventInstance.org.has(Org.parent_id == region_record.org_id),
            ),
        ],
    )

    # Section 1: User's upcoming Qs
    if event_records:
        # Sort by soonest date first
        event_records.sort(key=lambda r: r.start_date)
        select_blocks = [
            orm.HeaderBlock(label=":point_up: Select From Upcoming Qs:"),
            orm.ActionsBlock(
                elements=[
                    orm.ButtonElement(
                        label=(
                            f"{r.start_date.strftime('%m/%d')} {r.org.name} "
                            f"{' / '.join([t.name for t in r.event_types])}"
                        ),
                        action=f"{actions.EVENT_PREBLAST_FILL_BUTTON}_{r.id}",
                        value=str(r.id),
                    )
                    for r in event_records[:4]
                ],
            ),
        ]
        if len(event_records) > 4:
            select_blocks.append(
                orm.InputBlock(
                    label="All upcoming Qs",
                    action=actions.EVENT_PREBLAST_SELECT,
                    dispatch_action=True,
                    optional=False,
                    element=orm.StaticSelectElement(
                        placeholder="Select an event",
                        options=orm.as_selector_options(
                            names=[
                                f"{r.start_date} {r.org.name} {' / '.join([t.name for t in r.event_types])}"[:50]
                                for r in event_records
                            ],
                            values=[str(r.id) for r in event_records],
                        ),
                    ),
                    hint="If not listed above",
                )
            )
    else:
        select_blocks = [
            orm.SectionBlock(
                label="Looks like you are caught up! You have no upcoming Qs that have not already been posted for.",
            ),
        ]

    blocks = [
        *select_blocks,
        orm.DividerBlock(),
    ]

    # Section 2: Events without a Q
    blocks += [
        orm.SectionBlock(label="Sign up to Q for an upcoming event from the calendar:"),
        orm.ActionsBlock(
            elements=[
                orm.ButtonElement(label=":calendar: Open Calendar", action=actions.OPEN_CALENDAR_BUTTON),
            ]
        ),
        orm.DividerBlock(),
    ]

    # Section 3: Unscheduled event
    blocks += [
        orm.SectionBlock(label="Or, create a preblast for an event *not on the calendar:*"),
        orm.ActionsBlock(
            elements=[
                orm.ButtonElement(
                    label="New Unscheduled Event",
                    action=actions.EVENT_PREBLAST_NEW_BUTTON,
                    confirm=orm.ConfirmObject(
                        title="Are you sure?",
                        text=(
                            "This option should ONLY BE USED FOR UNSCHEDULED EVENTS that are not listed on "
                            "the calendar. If this is for a normal, scheduled event, please select it from "
                            "the lists above."
                        ),
                        confirm="Yes, I'm sure",
                        deny="Whups, never mind",
                        style="danger",
                    ),
                ),
            ]
        ),
    ]

    form = orm.BlockView(blocks=blocks)
    update_view_id = safe_get(body, "view", "id") or safe_get(body, actions.LOADING_ID)
    if update_view_id:
        form.update_modal(
            client=client,
            view_id=update_view_id,
            callback_id=actions.EVENT_PREBLAST_SELECT_CALLBACK_ID,
            title_text="Select Preblast",
            submit_button_text="None",
        )
    else:
        form.post_modal(
            client=client,
            trigger_id=safe_get(body, "trigger_id"),
            callback_id=actions.EVENT_PREBLAST_SELECT_CALLBACK_ID,
            title_text="Select Preblast",
            submit_button_text="None",
        )


def handle_event_preblast_select(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    action_id = safe_get(body, "actions", 0, "action_id") or ""
    view_id = safe_get(body, "view", "id")

    # comes from hitting the button on the preblast select modal
    if action_id[: len(actions.EVENT_PREBLAST_FILL_BUTTON)] == actions.EVENT_PREBLAST_FILL_BUTTON:
        event_instance_id = safe_convert(safe_get(body, "actions", 0, "value"), int)
    else:
        event_instance_id = safe_convert(safe_get(body, "actions", 0, "selected_option", "value"), int)

    build_event_preblast_form(
        body, client, logger, context, region_record, event_instance_id=event_instance_id, update_view_id=view_id
    )


# ---------------------------------------------------------------------------
# Preblast form build
# ---------------------------------------------------------------------------


def build_event_preblast_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
    event_instance_id: int = None,
    update_view_id: str = None,
):
    """Build and show the preblast edit/view form."""
    if not update_view_id:
        loading_view_id = add_loading_form(
            body, client, new_or_add="add" if safe_get(body, "view", "id") else "new"
        )
    else:
        loading_view_id = update_view_id

    try:
        _build_and_show_preblast_form(
            body, client, logger, context, region_record,
            event_instance_id, loading_view_id, update_view_id,
        )
    except Exception as e:
        logger.exception(f"Error building preblast form for event {event_instance_id}: {e}")
        # Update the loading screen with an error message so it doesn't stay stuck
        from slack_sdk.models.blocks import SectionBlock
        from slack_sdk.models.blocks.basic_components import MarkdownTextObject

        from utilities.slack.sdk_orm import SdkBlockView

        error_view = SdkBlockView(blocks=[
            SectionBlock(text=MarkdownTextObject(
                text=f":warning: Error loading preblast form: {e}"
            )),
        ])
        error_view.update_modal(
            client=client,
            view_id=loading_view_id,
            title_text="Error",
            callback_id=actions.EVENT_PREBLAST_CALLBACK_ID,
            submit_button_text="None",
        )


def _build_and_show_preblast_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
    event_instance_id: int,
    loading_view_id: str,
    update_view_id: str | None,
):
    """Internal: build preblast info and form, then update the modal."""
    preblast_info = build_preblast_info(body, client, logger, context, region_record, event_instance_id)
    record = preblast_info.event_record

    # Resolve default channel for the form
    preblast_channel = get_preblast_channel(region_record, preblast_info)
    org_id: int = region_record.org_id or 0

    # Load supporting data for both edit and read-only views
    svc = _build_preblast_service()
    event_type_svc = _build_event_type_service()

    raw_types = event_type_svc.get_all_event_types_for_org(org_id)
    event_types = [PreblastEventTypeData(id=t.id, event_category=t.event_category) for t in raw_types]

    from application.location.service import LocationService
    from infrastructure.api_client import get_api_location_repository

    loc_svc = LocationService(repository=get_api_location_repository())
    location_data = loc_svc.get_org_locations(org_id)
    locations = [{"id": loc.id, "name": get_location_display_name(loc)} for loc in location_data]

    from application.event_tag.service import EventTagService
    from infrastructure.api_client import get_api_event_tag_repository

    tag_svc = EventTagService(repository=get_api_event_tag_repository())
    tag_data = tag_svc.get_all_tags_for_org(org_id)
    event_tags_list = [{"id": tag.id, "name": tag.name} for tag in tag_data]

    title_text = "Edit Event Preblast"
    submit_button_text = "Update"
    initial_coq_slack_ids = [
        preblast_info.attendance_slack_dict[attendance["user_id"]]
        for attendance in preblast_info.attendance_records
        if CO_Q_TYPE_ID in attendance.get("attendance_type_ids", [])
        and preblast_info.attendance_slack_dict
        and attendance["user_id"] in preblast_info.attendance_slack_dict
    ]
    form = PreblastViews.build_preblast_form(
        event=record,
        locations=locations,
        event_tags=event_tags_list,
        event_types=event_types,
        preblast_service=svc,
        default_channel_id=preblast_channel,
        existing_preblast_ts=record.preblast_ts,
        preblast_moleskin_template=region_record.preblast_moleskin_template,
        initial_coq_slack_ids=initial_coq_slack_ids,
        user_is_q=preblast_info.user_is_q,
    )

    metadata = {
        "event_instance_id": event_instance_id,
        "preblast_ts": str(preblast_info.event_record.preblast_ts),
        "preblast_channel_id": preblast_channel,
    }

    form.update_modal(
        client=client,
        view_id=loading_view_id,
        title_text=title_text,
        submit_button_text=submit_button_text,
        parent_metadata=metadata,
        callback_id=actions.EVENT_PREBLAST_CALLBACK_ID,
    )


# ---------------------------------------------------------------------------
# View submission handler
# ---------------------------------------------------------------------------


def handle_event_preblast_edit(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    """Handle preblast form submission — assemble command and save through ``PreblastService``."""
    submission_view_id = safe_get(body, "submission_view_id") or safe_get(body, "view", "id")
    metadata = json.loads(safe_get(body, "view", "private_metadata") or "{}")
    event_instance_id = safe_get(metadata, "event_instance_id")
    existing_ts = safe_get(metadata, "preblast_ts")

    form_data: dict[str, Any] = extract_state_values(body)

    svc = _build_preblast_service()
    event_svc = _build_event_instance_service()
    event = event_svc.get_by_id(event_instance_id)

    if event is None:
        logger.error(f"Event instance {event_instance_id} not found for preblast edit")
        update_submission_wait_view(
            client=client,
            title="Error",
            text="Event instance not found and may have been deleted.",
            level=constants.AlertLevel.ERROR,
            logger=logger,
            view_id=submission_view_id,
        )
        return

    # Slack-only transforms
    rich_raw = form_data.get(actions.EVENT_PREBLAST_MOLESKINE_EDIT)
    if rich_raw:
        preblast_rich = fix_from_llm_tags(rich_raw)
        preblast_plain = replace_user_channel_ids(
            parse_rich_block(preblast_rich),
            region_record,
            client,
            logger,
        )
    else:
        preblast_rich = None
        preblast_plain = None

    # Handle image upload
    meta_updates: dict[str, Any] = {}
    image_data = form_data.get(actions.EVENT_PREBLAST_IMAGE)
    if image_data:
        file_obj = safe_get(image_data, 0) if isinstance(image_data, list) else image_data
        try:
            file_id = reupload_file_as_bot(file_obj, client, logger, region_record=region_record) or safe_get(
                file_obj, "id"
            )
            meta_updates["preblast_image_slack_file_id"] = file_id
        except Exception as e:
            logger.error(f"Error reuploading preblast image for event {event_instance_id}: {e}")

    # Resolve channel from form selector or existing meta
    desired_channel = form_data.get("preblast_channel_selector") or None

    # Build command via service
    start_time_raw = form_data.get(actions.EVENT_PREBLAST_START_TIME)
    start_time = start_time_raw.replace(":", "") if start_time_raw else None

    tag_raw = form_data.get(actions.EVENT_PREBLAST_TAG)
    event_tag_ids = [int(t) for t in tag_raw] if tag_raw else []

    location_raw = form_data.get(actions.EVENT_PREBLAST_LOCATION)
    location_id = int(location_raw) if location_raw else None

    command = svc.build_update_command(
        event,
        name=form_data.get(actions.EVENT_PREBLAST_TITLE),
        preblast_rich=preblast_rich,
        preblast=preblast_plain,
        location_id=location_id,
        clear_location_id=location_id is None and event.location_id is not None,
        start_time=start_time,
        event_tag_ids=event_tag_ids if event_tag_ids else None,
        desired_channel_id=desired_channel,
        meta_updates=meta_updates if meta_updates else None,
    )

    # Save via service
    svc.save_event_update(command, existing_event=event)

    # Handle Co-Q list — use assign_qs to set Q + Co-Qs atomically. If the
    # multiselect field is present, its value is authoritative; an empty value
    # intentionally clears all Co-Qs while preserving the existing Q.
    if actions.EVENT_PREBLAST_COQS in form_data:
        coq_slack_ids = form_data.get(actions.EVENT_PREBLAST_COQS) or []
        coq_user_ids: list[int | str] = []
        unresolved_coq_slack_ids: list[str] = []
        for slack_id in coq_slack_ids:
            try:
                user = get_user(slack_id, region_record, client, logger)
                coq_user_ids.append(user.user_id)
            except Exception as e:
                unresolved_coq_slack_ids.append(str(slack_id))
                logger.error(f"Error resolving Co-Q {slack_id} for event {event_instance_id}: {e}")

        if unresolved_coq_slack_ids:
            failed_coqs = ", ".join(f"<@{slack_id}>" for slack_id in unresolved_coq_slack_ids)
            update_submission_wait_view(
                client=client,
                title="Co-Qs not saved",
                text=(
                    "Preblast details were saved, but Co-Qs were not updated because "
                    f"these Slack users could not be resolved: {failed_coqs}. "
                    "Please reopen the form and try again."
                ),
                level=constants.AlertLevel.ERROR,
                logger=logger,
                view_id=submission_view_id,
            )
            return

        try:
            planned_attendance = _build_attendance_service().get_planned_for_event_instance(event_instance_id)
            q_user_id = next(
                (
                    attendance.user_id
                    for attendance in planned_attendance
                    if Q_TYPE_ID in attendance.attendance_type_ids
                ),
                None,
            )
            svc.assign_qs(event_instance_id, q_user_id, coq_user_ids)
        except Exception as e:
            logger.error(f"Error assigning Co-Qs for event {event_instance_id}: {e}")
            coq_failure_detail = (
                "These Co-Qs were not assigned: "
                + ", ".join(f"<@{slack_id}>" for slack_id in coq_slack_ids)
                if coq_slack_ids
                else "Existing Co-Qs were not cleared."
            )
            update_submission_wait_view(
                client=client,
                title="Co-Qs not saved",
                text=(
                    "Preblast details were saved, but Co-Qs were not updated. "
                    f"{coq_failure_detail} Please reopen the form and try again."
                ),
                level=constants.AlertLevel.ERROR,
                logger=logger,
                view_id=submission_view_id,
            )
            return

    # Determine if we should post/send the preblast now
    preblast_send = (
        form_data.get(actions.EVENT_PREBLAST_SEND_OPTIONS) == "Send now"
        or (existing_ts or "None") != "None"
    )

    if preblast_send:
        # Get update mode if we're editing an existing post
        update_mode = safe_get(
            body,
            "view",
            "state",
            "values",
            actions.EVENT_PREBLAST_UPDATE_MODE,
            actions.EVENT_PREBLAST_UPDATE_MODE,
            "selected_option",
            "value",
        )
        repost = update_mode == "Repost preblast" if update_mode else False

        send_preblast(
            body,
            client,
            logger,
            context,
            region_record,
            event_instance_id,
            repost=repost,
        )

    else:
        update_submission_wait_view(
            client=client,
            title="Complete!",
            text="Preblast saved successfully!",
            level=constants.AlertLevel.SUCCESS,
            logger=logger,
            view_id=submission_view_id,
        )


# ---------------------------------------------------------------------------
# Slack post helpers
# ---------------------------------------------------------------------------


def _post_blocks(api_call, blocks: list, logger: Logger, max_retries: int = 3, **kwargs):
    """Call a Slack API method with blocks, retrying on invalid slack file errors.

    Slack occasionally needs a moment to process a freshly uploaded file before it
    can be referenced in a slack_file image block.  On that specific error, this
    retries with exponential back-off (1 s, 2 s, 4 s) rather than a fixed sleep.
    All other errors are re-raised immediately.
    """
    for attempt in range(max_retries):
        try:
            return api_call(blocks=blocks, **kwargs)
        except SlackApiError as exc:
            is_file_not_ready = exc.response.get("error") == "invalid_blocks" and any(
                "slack file" in (e or "") for e in exc.response.get("errors", [])
            )
            if is_file_not_ready and attempt < max_retries - 1:
                wait = 2**attempt  # 1 s, 2 s, 4 s …
                logger.warning(f"Slack file not ready (attempt {attempt + 1}/{max_retries}), retrying in {wait}s")
                time.sleep(wait)
                continue
            raise


def _format_attendance_user(attendance: AttendanceData, attendance_slack_dict: dict[int, str]) -> str:
    slack_id = attendance_slack_dict.get(attendance.user_id)
    if slack_id:
        return f"<@{slack_id}>"
    return f"@{attendance.f3_name or 'Unknown'}"


# ---------------------------------------------------------------------------
# send_preblast
# ---------------------------------------------------------------------------


def send_preblast(
    body: dict = None,
    client: WebClient = None,
    logger: Logger = None,
    context: dict = None,
    region_record: SlackSettings = None,
    event_instance_id: int = None,
    repost: bool = False,
):
    """Post or update a preblast message in Slack.

    Uses ``PreblastService.decide_post_mode()`` and ``persist_posted_preblast()``
    to handle all post-mode scenarios.
    """
    outcome = "success" # used for logging and user feedback
    slack_user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")
    preblast_info = build_preblast_info(body, client, logger, context, region_record, event_instance_id)
    q_attendance = next(
        (r for r in preblast_info.attendance_records if Q_TYPE_ID in r.get("attendance_type_ids", [])),
        None,
    )
    q_slack_id = None
    if q_attendance and preblast_info.attendance_slack_dict:
        q_slack_id = preblast_info.attendance_slack_dict.get(q_attendance["user_id"])
    q_list = [
        r for r in preblast_info.attendance_records
        if bool({Q_TYPE_ID, CO_Q_TYPE_ID}.intersection(r.get("attendance_type_ids", [])))
    ]

    blocks = list(preblast_info.preblast_blocks)
    blocks.extend(
        b.as_form_field() for b in get_preblast_action_blocks(
            has_q=len(q_list) > 0, event_instance_id=event_instance_id
        )
    )

    # Image block from meta
    if preblast_info.event_record.meta and preblast_info.event_record.meta.get("preblast_image_slack_file_id"):
        blocks.insert(
            -1,
            {
                "type": "image",
                "slack_file": {
                    "id": preblast_info.event_record.meta["preblast_image_slack_file_id"],
                },
                "alt_text": "Preblast Image",
            },
        )

    metadata_dict = {
        "event_instance_id": event_instance_id,
        "attendees": [r.get("user_id") for r in preblast_info.attendance_records],
        "qs": [r.get("user_id") for r in q_list],
    }

    # Username / icon
    if body:
        slack_id = q_slack_id or slack_user_id
        q_name, q_url = get_user_names([slack_id], logger, client, return_urls=True)
        q_name = (q_name or [""])[0]
        q_url = q_url[0] if q_url else None
        username = f"{q_name} (via F3 Nation)"
        icon_url = q_url
    else:
        username = None
        icon_url = None

    preblast_channel = get_preblast_channel(region_record, preblast_info)

    # Use service to decide post mode
    svc = _build_preblast_service()
    event = preblast_info.event_record
    default_channel = preblast_channel or ""

    # Desired channel: prefer form override saved in meta, else default
    desired_channel = str(
        (event.meta or {}).get("preblast_channel_id") or default_channel
    )

    if not desired_channel:
        action_text = "saved (no channel)"
        post_bot_log(
            client=client,
            region_record=region_record,
            text=f":mega: Preblast {action_text}",
            logger=logger,
        )
        return

    decision = svc.decide_post_mode(
        event,
        desired_channel,
        posted_channel_fallback_id=default_channel,
        force_repost=repost,
    )

    if decision.mode == PostMode.SAVE:
        action_text = "saved"
    if decision.mode in (PostMode.POST_NEW, PostMode.POST_NEW_CHANNEL):
        action_text = "posted" if decision.mode == PostMode.POST_NEW else "posted in new channel"
        res = None
        try:
            res = _post_blocks(
                client.chat_postMessage,
                blocks,
                logger,
                channel=desired_channel,
                text="Event Preblast",
                metadata={"event_type": "preblast", "event_payload": metadata_dict},
                unfurl_links=False,
                username=username,
                icon_url=icon_url,
            )
        except Exception as e:
            logger.error(f"Error posting preblast for event {event_instance_id}: {e}")
            action_text = "post failed on posting"
            outcome = "error"

        # Persist the posted preblast ts and channel id if the post was successful
        if res:
            try:
                ts = float(res["ts"])
                svc.persist_posted_preblast(
                    instance_id=event_instance_id,
                    preblast_ts=ts,
                    channel_id=desired_channel,
                    existing_event=event,
                )
                event.preblast_ts = ts
            except Exception as e:
                logger.error(f"Error persisting posted preblast for event {event_instance_id}: {e}")
                action_text = "was posted but was not fully saved; it may not be marked as posted in the database."
                outcome = "error"
    elif decision.mode == PostMode.UPDATE_EXISTING:
        posted_channel = decision.posted_channel_id or desired_channel
        try:
            _post_blocks(
                client.chat_update,
                blocks,
                logger,
                channel=posted_channel,
                ts=f"{decision.existing_preblast_ts:.6f}",
                text="Event Preblast",
                metadata={"event_type": "preblast", "event_payload": metadata_dict},
                username=username,
                icon_url=icon_url,
            )
            action_text = "updated"
        except Exception as e:
            logger.error(f"Error updating preblast for event {event_instance_id}: {e}")
            action_text = "update failed"
            outcome = "error"

    log_msg = (
        f":mega: Preblast {action_text} for *{event.name}* "
        f"on *{event.start_date}* by <@{slack_user_id or 'app'}>"
    )
    user_msg = f"Preblast {action_text}"
    if outcome == "success":
        user_msg += " successfully!"
    if desired_channel and event.preblast_ts:
        log_msg += (
            f" <slack://channel?team={region_record.team_id}"
            f"&id={desired_channel}&ts={event.preblast_ts}|Link>\n"
        )
        user_msg += f" <slack://channel?team={region_record.team_id}&id={desired_channel}&ts={event.preblast_ts}| Link>"
    post_bot_log(
        client=client,
        region_record=region_record,
        text=log_msg,
        logger=logger,
    )

    update_submission_wait_view(
        client=client,
        title="Complete!" if outcome == "success" else "Error",
        text=user_msg,
        level=constants.AlertLevel.SUCCESS if outcome == "success" else constants.AlertLevel.ERROR,
        logger=logger,
        view_id=safe_get(body, "submission_view_id") or safe_get(body, "view", "id"),
    )


# ---------------------------------------------------------------------------
# build_preblast_info
# ---------------------------------------------------------------------------


def build_preblast_info(
    body: dict = None,
    client: WebClient = None,
    logger: Logger = None,
    context: dict = None,
    region_record: SlackSettings = None,
    event_instance_id: int = None,
) -> PreblastInfo:
    """Build preblast info using API services instead of DbManager."""
    event_svc = _build_event_instance_service()
    att_svc = _build_attendance_service()

    event = event_svc.get_by_id(event_instance_id)
    if event is None:
        raise ValueError(f"Event instance {event_instance_id} not found")

    attendance_data = att_svc.get_planned_for_event_instance(event_instance_id)

    # Resolve Slack IDs for attendance users (SlackUser DB compatibility exception)
    attendance_slack_dict: dict[int, str] = {}
    if region_record and attendance_data:
        try:
            from f3_data_models.models import SlackUser
            from f3_data_models.utils import DbManager

            user_ids = [att.user_id for att in attendance_data]
            slack_users = DbManager.find_records(
                SlackUser,
                [
                    SlackUser.user_id.in_(user_ids),
                    SlackUser.slack_team_id == region_record.team_id,
                ],
            )
            for su in slack_users:
                attendance_slack_dict[su.user_id] = su.slack_id
        except Exception as e:
            message = f"Failed to resolve Slack user IDs for attendance on event {event_instance_id}: {e}"
            if logger:
                logger.exception(message)
            raise RuntimeError(message) from e

    # Build action blocks as plain dicts
    action_blocks: list[dict[str, Any]] = []

    user_id = None
    user_is_q = False
    if body:
        user_obj = get_user(
            safe_get(body, "user", "id") or safe_get(body, "user_id"), region_record, client, logger
        )
        user_id = user_obj.user_id
        user_is_q = any(
            att.user_id == user_id
            for att in attendance_data
            if bool({Q_TYPE_ID, CO_Q_TYPE_ID}.intersection(att.attendance_type_ids))
        )

    # Build Q list with Slack mentions
    q_attendance = [
        att for att in attendance_data
        if bool({Q_TYPE_ID, CO_Q_TYPE_ID}.intersection(att.attendance_type_ids))
    ]
    q_mentions = [_format_attendance_user(att, attendance_slack_dict) for att in q_attendance]
    q_list = " ".join(q_mentions) if q_mentions else "Open!"
    if not q_attendance:
        action_blocks.append(
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "Take Q"},
                "action_id": actions.EVENT_PREBLAST_TAKE_Q,
                "value": str(event.id),
            }
        )
    elif user_is_q:
        action_blocks.append(
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "Take myself off Q"},
                "action_id": actions.EVENT_PREBLAST_REMOVE_Q,
                "value": str(event.id),
            }
        )

    user_hc = any(att.user_id == user_id for att in attendance_data) if user_id else False
    if user_hc:
        if not user_is_q:
            action_blocks.append(
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "Un-HC"},
                    "action_id": actions.EVENT_PREBLAST_UN_HC,
                    "value": str(event.id),
                }
            )
    else:
        action_blocks.append(
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "HC"},
                "action_id": actions.EVENT_PREBLAST_HC,
                "value": str(event.id),
            }
        )

    # Build HC list with Slack mentions
    hc_mentions = [_format_attendance_user(att, attendance_slack_dict) for att in attendance_data]
    hc_list = " ".join(hc_mentions) if hc_mentions else "None"
    hc_count = len({att.user_id for att in attendance_data})

    # Build location display with channel link and maps link
    location_display = ""
    org_meta = event.org_meta or (event.meta or {}).get("org_meta") or {}
    if org_meta.get("slack_channel_id"):
        location_display += f"<#{org_meta['slack_channel_id']}>"
    elif event.org_name:
        location_display += event.org_name
    else:
        location_display += "Unknown AO"
    if event.location_name:
        loc_name = event.location_name
        if event.location_latitude and event.location_longitude:
            location_display += (
                f" - <https://www.google.com/maps/search/?api=1&"
                f"query={event.location_latitude},{event.location_longitude}|{loc_name}>"
            )
        elif location_display:
            location_display += f" - {loc_name}"

    # Build event details string
    event_type_display = " / ".join(event.event_type_names) if event.event_type_names else "TBD"
    event_tag_display = ", ".join(event.event_tag_names) if event.event_tag_names else None

    event_details = (
        f"*Preblast: {event.name}*"
        f"\n*Date:* {event.start_date.strftime('%A, %B %d') if event.start_date else 'TBD'}"
        f"\n*Time:* {event.start_time or 'TBD'}"
        f"\n*Where:* {location_display or 'TBD'}"
        f"\n*Event Type:* {event_type_display}"
        + (f"\n*Event Tag:* {event_tag_display}" if event_tag_display else "")
        + f"\n*Q:* {q_list}"
        + f"\n*HC Count:* {hc_count}"
        + f"\n*HCs:* {hc_list}"
    )

    preblast_blocks: list[dict[str, Any]] = [
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": event_details},
        },
        {
            "type": "rich_text",
            "elements": event.preblast_rich.get("elements", []) if isinstance(event.preblast_rich, dict) else (
                [{"type": "rich_text_section", "elements": [{"type": "text", "text": str(event.preblast_rich or "")}]}]
            ),
        },
    ]

    return PreblastInfo(
        event_record=event,
        attendance_records=[att.model_dump() for att in attendance_data],
        preblast_blocks=preblast_blocks,
        action_blocks=action_blocks,
        user_is_q=user_is_q,
        attendance_slack_dict=attendance_slack_dict,
    )


# ---------------------------------------------------------------------------
# Overflow / action routing
# ---------------------------------------------------------------------------


def route_preblast_overflow_action(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    action_value: str = body["actions"][0]["selected_option"]["value"]
    metadata = safe_get(body, "message", "metadata", "event_payload")

    if action_value.startswith(actions.EVENT_PREBLAST_EDIT):
        user_id = get_user(
            safe_get(body, "user", "id") or safe_get(body, "user_id"), region_record, client, logger
        ).user_id
        if constants.ALL_USERS_ARE_ADMINS or (user_id in (safe_get(metadata, "qs") or [])):
            user_can_edit = True
        else:
            admin_users = get_admin_users(region_record.org_id, slack_team_id=region_record.team_id)
            aoq_users = get_aoq_users(region_record.org_id)
            user_can_edit = any(u[0].id == user_id for u in admin_users) or any(u.id == user_id for u in aoq_users)
        if user_can_edit:
            body["actions"][0]["action_id"] = "Edit Preblast"
            body["actions"][0]["value"] = "Edit Preblast"
            build_event_preblast_form(
                body, client, logger, context, region_record, event_instance_id=int(action_value.split("_")[-1])
            )
    elif action_value.startswith(actions.PREBLAST_FILL_BACKBLAST_BUTTON):
        body["actions"][0]["action_id"] = action_value.split("_")[0]
        backblast.build_backblast_form(
            body, client, logger, context, region_record, event_instance_id=int(action_value.split("_")[-1])
        )
    elif action_value == actions.NEW_PREBLAST_BUTTON:
        body["actions"][0]["action_id"] = action_value
        preblast_middleware(body, client, logger, context, region_record)


# ---------------------------------------------------------------------------
# Action handler (HC / Un-HC / Take-Q / Remove-Q)
# ---------------------------------------------------------------------------


def handle_event_preblast_action(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    action_id = safe_get(body, "actions", 0, "action_id")
    metadata = json.loads(safe_get(body, "view", "private_metadata") or "{}") or safe_get(
        body, "message", "metadata", "event_payload"
    )
    event_instance_id = safe_get(metadata, "event_instance_id")
    slack_user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")
    user_id = get_user(slack_user_id, region_record, client, logger).user_id
    view_id = safe_get(body, "view", "id")

    svc = _build_preblast_service()

    if view_id:
        # In-modal actions
        if action_id == actions.EVENT_PREBLAST_HC:
            try:
                svc.add_hc(event_instance_id, user_id)
            except Exception as e:
                logger.warning(f"Error HC for event {event_instance_id}: {e}")
                post_hc_failure_ephemeral(
                    body,
                    client,
                    logger,
                    metadata,
                    slack_user_id,
                    "Sorry, we couldn't record your HC — please try again.",
                )
                return
        elif action_id == actions.EVENT_PREBLAST_UN_HC:
            try:
                svc.remove_hc(event_instance_id, user_id)
            except Exception as e:
                logger.warning(f"Error Un-HC for event {event_instance_id}: {e}")
                post_hc_failure_ephemeral(
                    body,
                    client,
                    logger,
                    metadata,
                    slack_user_id,
                    "Sorry, we couldn't update your HC — please try again.",
                )
                return
        elif action_id == actions.EVENT_PREBLAST_TAKE_Q:
            try:
                svc.take_q(event_instance_id, user_id)
            except Exception as e:
                logger.error(f"Error taking Q for event {event_instance_id}: {e}")
        elif action_id == actions.EVENT_PREBLAST_REMOVE_Q:
            try:
                svc.remove_q(event_instance_id, user_id)
            except Exception as e:
                logger.error(f"Error removing Q for event {event_instance_id}: {e}")

        # Update the Slack message after action
        if metadata.get("preblast_ts") and metadata["preblast_ts"] != "None":
            preblast_info = build_preblast_info(body, client, logger, context, region_record, event_instance_id)
            blocks = list(preblast_info.preblast_blocks) + [
                b.as_form_field() for b in get_preblast_action_blocks(
                    has_q=any(
                        bool({Q_TYPE_ID, CO_Q_TYPE_ID}.intersection(r.get("attendance_type_ids", [])))
                        for r in preblast_info.attendance_records
                    ),
                    event_instance_id=event_instance_id,
                )
            ]
            if preblast_info.event_record.meta and preblast_info.event_record.meta.get("preblast_image_slack_file_id"):
                blocks.insert(
                    -1,
                    {
                        "type": "image",
                        "slack_file": {"id": preblast_info.event_record.meta["preblast_image_slack_file_id"]},
                        "alt_text": "Preblast Image",
                    },
                )

            q_name, q_url = get_user_names([slack_user_id], logger, client, return_urls=True)
            q_name = (q_name or [""])[0]
            q_url = q_url[0] if q_url else None
            preblast_channel = get_preblast_channel(region_record, preblast_info)
            try:
                client.chat_update(
                    channel=preblast_channel,
                    ts=metadata["preblast_ts"],
                    blocks=blocks,
                    text="Event Preblast",
                    metadata={"event_type": "preblast", "event_payload": metadata},
                    username=f"{q_name} (via F3 Nation)",
                    icon_url=q_url,
                )
            except Exception as e:
                logger.error(
                    f"Error updating preblast message after action {action_id} "
                    f"and event_instance_id {event_instance_id}: {e}"
                )
            if action_id in (actions.EVENT_PREBLAST_HC, actions.EVENT_PREBLAST_UN_HC):
                post_hc_thread_reply(
                    client,
                    logger,
                    region_record,
                    preblast_channel,
                    metadata["preblast_ts"],
                    slack_user_id,
                    is_hc=action_id == actions.EVENT_PREBLAST_HC,
                    event_instance_id=event_instance_id,
                )

        build_event_preblast_form(
            body, client, logger, context, region_record,
            event_instance_id=event_instance_id, update_view_id=view_id,
        )

    else:
        # Message-embedded actions (outside modal)
        if action_id == actions.EVENT_PREBLAST_HC_UN_HC:
            already_hcd = user_id in (safe_get(metadata, "attendees") or [])
            if already_hcd:
                try:
                    svc.remove_hc(event_instance_id, user_id)
                except Exception as e:
                    logger.warning(f"Error Un-HC for event {event_instance_id}: {e}")
                    post_hc_failure_ephemeral(
                        body,
                        client,
                        logger,
                        metadata,
                        slack_user_id,
                        "Sorry, we couldn't update your HC — please try again.",
                    )
                    return
            else:
                try:
                    svc.add_hc(event_instance_id, user_id)
                except Exception as e:
                    logger.warning(f"Error HC for event {event_instance_id}: {e}")
                    post_hc_failure_ephemeral(
                        body,
                        client,
                        logger,
                        metadata,
                        slack_user_id,
                        "Sorry, we couldn't record your HC — please try again.",
                    )
                    return

            preblast_info = build_preblast_info(body, client, logger, context, region_record, event_instance_id)
            q_id_list = [
                r.get("user_id")
                for r in preblast_info.attendance_records
                if bool({Q_TYPE_ID, CO_Q_TYPE_ID}.intersection(r.get("attendance_type_ids", [])))
            ]
            metadata = {
                "event_instance_id": event_instance_id,
                "attendees": [r.get("user_id") for r in preblast_info.attendance_records],
                "qs": q_id_list,
            }
            button_blocks = get_preblast_action_blocks(
                has_q=len(q_id_list) > 0, event_instance_id=event_instance_id
            )
            blocks = list(preblast_info.preblast_blocks) + [b.as_form_field() for b in button_blocks]
            if (
                preblast_info.event_record.meta
                and preblast_info.event_record.meta.get("preblast_image_slack_file_id")
            ):
                blocks.insert(
                    -1,
                    {
                        "type": "image",
                        "slack_file": {"id": preblast_info.event_record.meta["preblast_image_slack_file_id"]},
                        "alt_text": "Preblast Image",
                    },
                )

            q_name, q_url = get_user_names([slack_user_id], logger, client, return_urls=True)
            q_name = (q_name or [""])[0]
            q_url = q_url[0] if q_url else None
            preblast_channel = get_preblast_channel(region_record, preblast_info)
            metadata["preblast_channel_id"] = preblast_channel

            try:
                client.chat_update(
                    channel=preblast_channel,
                    ts=body["message"]["ts"],
                    blocks=blocks,
                    text="Preblast",
                    metadata={"event_type": "preblast", "event_payload": metadata},
                    username=f"{q_name} (via F3 Nation)",
                    icon_url=q_url,
                )
            except Exception as e:
                logger.error(
                    f"Error updating preblast message after action {action_id} "
                    f"for event {event_instance_id}: {e}"
                )
            post_hc_thread_reply(
                client,
                logger,
                region_record,
                preblast_channel,
                body["message"]["ts"],
                slack_user_id,
                is_hc=not already_hcd,
                event_instance_id=event_instance_id,
            )

        elif action_id == actions.EVENT_PREBLAST_EDIT:
            if constants.ALL_USERS_ARE_ADMINS:
                user_is_admin = True
            else:
                admin_users = get_admin_users(region_record.org_id, slack_team_id=region_record.team_id)
                user_is_admin = any(u[0].id == user_id for u in admin_users)
            if (user_id in (safe_get(metadata, "qs") or [])) or user_is_admin:
                build_event_preblast_form(
                    body, client, logger, context, region_record, event_instance_id=event_instance_id
                )
            else:
                client.chat_postEphemeral(
                    channel=body["channel"]["id"],
                    user=slack_user_id,
                    text=":warning: Only Qs can edit the preblast! :warning:",
                )

        elif action_id == actions.MSG_EVENT_PREBLAST_BUTTON:
            event_instance_id = safe_convert(body["actions"][0]["value"], int)
            build_event_preblast_form(
                body, client, logger, context, region_record, event_instance_id=event_instance_id
            )

        elif action_id == actions.EVENT_PREBLAST_TAKE_Q:
            event_instance_id = safe_convert(body["actions"][0]["value"], int)
            try:
                svc.take_q(event_instance_id, user_id)
            except Exception as e:
                logger.error(f"Error taking Q for event {event_instance_id}: {e}")
            build_event_preblast_form(
                body, client, logger, context, region_record, event_instance_id=event_instance_id
            )
