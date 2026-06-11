import json
import random
import time
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from logging import Logger
from typing import List

from f3_data_models.models import (
    Attendance,
    Attendance_x_AttendanceType,
    AttendanceType,
    EventInstance,
    EventTag,
    EventTag_x_EventInstance,
    Location,
    Org,
)
from f3_data_models.utils import DbManager
from slack_sdk.errors import SlackApiError
from slack_sdk.web import WebClient
from sqlalchemy import or_

from features import backblast, connect
from features.calendar import get_preblast_action_blocks
from utilities import constants
from utilities.bot_logger import post_bot_log
from utilities.builders import add_loading_form
from utilities.database.orm import SlackSettings
from utilities.database.special_queries import (
    event_attendance_query,
    get_admin_users,
    get_aoq_users,
)
from utilities.helper_functions import (
    current_date_cst,
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


@dataclass
class PreblastInfo:
    event_record: EventInstance
    attendance_records: list[Attendance]
    preblast_blocks: list[orm.BaseBlock]
    action_blocks: list[orm.BaseElement]
    user_is_q: bool = False
    attendance_slack_dict: dict[Attendance, str] = None


def get_preblast_channel(region_record: SlackSettings, preblast_info: PreblastInfo) -> str | None:
    if (
        region_record.default_preblast_destination == constants.CONFIG_DESTINATION_SPECIFIED["value"]
        and region_record.preblast_destination_channel
    ):
        return region_record.preblast_destination_channel
    return safe_get(preblast_info.event_record.org.meta, "slack_channel_id")


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
    """Post an optional announcement in the preblast thread when a user HCs or Un-HCs."""
    option = region_record.hc_announce_option
    if not option or option == "off" or not preblast_channel or not preblast_ts:
        return
    targets = region_record.hc_announce_targets or "both"
    if is_hc and targets == "unhc_only":
        return
    if not is_hc and targets == "hc_only":
        return
    # Only post the first time a user performs each action (HC or Un-HC) for this event
    if event_instance_id is not None:
        event_record: EventInstance = DbManager.get(EventInstance, event_instance_id)
        meta = event_record.meta or {}
        hc_announced = meta.get("hc_announced", {})
        key = "hc" if is_hc else "unhc"
        if slack_user_id in (hc_announced.get(key) or []):
            return
        hc_announced.setdefault(key, []).append(slack_user_id)
        meta["hc_announced"] = hc_announced
        DbManager.update_record(EventInstance, event_instance_id, {EventInstance.meta: meta})
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


def preblast_middleware(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    if (
        region_record.org_id is None
        or (safe_convert(region_record.migration_date, datetime.strptime, args=["%Y-%m-%d"]) or datetime.now())
        > datetime.now()
    ):
        connect.build_connect_options_form(body, client, logger, context, region_record)
    else:
        build_event_preblast_select_form(body, client, logger, context, region_record)


def build_event_preblast_select_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    user_id = get_user(safe_get(body, "user", "id") or safe_get(body, "user_id"), region_record, client, logger).user_id
    event_records = event_attendance_query(
        attendance_filter=[
            Attendance.user_id == user_id,
            Attendance.is_planned,
            Attendance.attendance_types.any(AttendanceType.id.in_([2, 3])),
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
                        label=f"{r.start_date.strftime('%m/%d')} {r.org.name} {' / '.join([t.name for t in r.event_types])}",  # noqa: E501
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
                label="Looks like you are caught up! You have no upcoming Qs that have not already been posted for."
            ),  # noqa
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
                        text="This option should ONLY BE USED FOR UNSCHEDULED EVENTS that are not listed on the calendar. If this is for a normal, scheduled event, please select it from the lists above.",  # noqa
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

    # Handle fill button click (action_id starts with EVENT_PREBLAST_FILL_BUTTON)
    if action_id[: len(actions.EVENT_PREBLAST_FILL_BUTTON)] == actions.EVENT_PREBLAST_FILL_BUTTON:
        event_instance_id = safe_convert(safe_get(body, "actions", 0, "value"), int)
    # Handle no-Q select with Q assignment
    elif action_id == actions.EVENT_PREBLAST_NOQ_SELECT:
        event_instance_id = safe_convert(safe_get(body, "actions", 0, "selected_option", "value"), int)
        # Assign the user as Q for this event
        slack_user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")
        user_id = get_user(slack_user_id, region_record, client, logger).user_id
        try:
            attendance_record = Attendance(
                event_instance_id=event_instance_id,
                user_id=user_id,
                attendance_x_attendance_types=[Attendance_x_AttendanceType(attendance_type_id=2)],  # Q type
                is_planned=True,
            )
            DbManager.create_record(attendance_record)
        except Exception as e:
            logger.error(f"Error assigning Q for event {event_instance_id}: {e}")
    # Handle dropdown select
    else:
        event_instance_id = safe_convert(safe_get(body, "actions", 0, "selected_option", "value"), int)

    build_event_preblast_form(
        body, client, logger, context, region_record, event_instance_id=event_instance_id, update_view_id=view_id
    )


def build_event_preblast_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
    event_instance_id: int = None,
    update_view_id: str = None,
):
    if not update_view_id:
        loading_view_id = add_loading_form(body, client, new_or_add="add" if safe_get(body, "view", "id") else "new")

    preblast_info = build_preblast_info(body, client, logger, context, region_record, event_instance_id)
    record = preblast_info.event_record
    view_id = safe_get(body, "view", "id")
    action_value = safe_get(body, "actions", 0, "value") or safe_get(body, "actions", 0, "selected_option", "value")

    preblast_channel = get_preblast_channel(region_record, preblast_info)
    if action_value == "Edit Preblast" or preblast_info.user_is_q:
        form = deepcopy(EVENT_PREBLAST_FORM)

        location_records: list[Location] = DbManager.find_records(
            Location, [Location.org_id == region_record.org_id, Location.is_active]
        )  # noqa
        event_tags: list[EventTag] = DbManager.find_records(
            EventTag, [or_(EventTag.specific_org_id == region_record.org_id, EventTag.specific_org_id.is_(None))]
        )
        # TODO: filter locations to AO?
        # TODO: show hardcoded details (date, time, etc.)
        form.set_options(
            {
                actions.EVENT_PREBLAST_LOCATION: orm.as_selector_options(
                    names=[get_location_display_name(location) for location in location_records],
                    values=[str(location.id) for location in location_records],
                ),
                actions.EVENT_PREBLAST_TAG: orm.as_selector_options(
                    names=[tag.name for tag in event_tags if tag.name != "Open"],
                    values=[str(tag.id) for tag in event_tags if tag.name != "Open"],
                ),
            }
        )
        # if start_date is more than 24 hours away, default to sending 24 hours before
        print(record.start_date, current_date_cst(), (record.start_date - current_date_cst()).days, record.preblast_ts)  # noqa
        if (
            record.start_date > current_date_cst()
            and (record.start_date - current_date_cst()).days > 1
            and not record.preblast_ts
        ):
            schedule_default = "Send a day before the event"
        else:
            schedule_default = "Send now"
        initial_values = {
            actions.EVENT_PREBLAST_TITLE: record.name,
            actions.EVENT_PREBLAST_MOLESKINE_EDIT: record.preblast_rich or region_record.preblast_moleskin_template,
            actions.EVENT_PREBLAST_START_TIME: record.start_time[:2] + ":" + record.start_time[2:],
            actions.EVENT_PREBLAST_SEND_OPTIONS: schedule_default,
            # actions.EVENT_PREBLAST_TAG: safe_convert(getattr(record.event_tags, "id", None), str),
        }
        if record.location:
            initial_values[actions.EVENT_PREBLAST_LOCATION] = str(record.location.id)
        if record.event_tags:
            initial_values[actions.EVENT_PREBLAST_TAG] = [
                str(record.event_tags[0].id)
            ]  # TODO: handle multiple event types and current data format
        coq_list = [
            s for a, s in preblast_info.attendance_slack_dict.items() if 3 in [t.id for t in a.attendance_types]
        ]
        if coq_list:
            initial_values[actions.EVENT_PREBLAST_COQS] = coq_list

        form.set_initial_values(initial_values)
        title_text = "Edit Event Preblast"
        submit_button_text = "Update"

        if not preblast_channel or preblast_info.event_record.preblast_ts:
            form.blocks = form.blocks[:-1]
            if not preblast_channel:
                form.blocks.append(
                    orm.SectionBlock(
                        label="A slack channel has not been set for this AO or region, so this will not be posted. "
                        "An admin can set the channel for the AO through Calendar Settings -> Manage AOs or for "
                        "the region through Backblast & Preblast Settings."
                    )
                )
            if preblast_info.event_record.preblast_ts and preblast_channel:
                form.blocks.append(
                    orm.InputBlock(
                        label="How would you like to update the preblast?",
                        action=actions.EVENT_PREBLAST_UPDATE_MODE,
                        element=orm.RadioButtonsElement(
                            options=orm.as_selector_options(
                                names=["Update preblast", "Repost preblast"],
                            ),
                            initial_value="Update preblast",
                        ),
                        optional=False,
                    )
                )
        else:
            form.blocks[-1].label = "When would you like to send the preblast?"
        form.blocks.append(orm.ActionsBlock(elements=preblast_info.action_blocks))
    else:
        blocks = [
            *preblast_info.preblast_blocks,
            orm.ActionsBlock(elements=preblast_info.action_blocks),
        ]
        if preblast_info.event_record.preblast_ts:
            blocks.append(
                orm.SectionBlock(
                    label=f"\n*This preblast has been posted, <slack://channel?team={body['team']['id']}&id={preblast_channel}&ts={preblast_info.event_record.preblast_ts}|check it out in the channel>*"  # noqa
                )
            )  # noqa

        form = orm.BlockView(blocks=blocks)
        title_text = "Event Preblast"
        submit_button_text = "None"

    metadata = {
        "event_instance_id": event_instance_id,
        "preblast_ts": str(preblast_info.event_record.preblast_ts),
    }

    if update_view_id:
        update_view_id = update_view_id
        callback_id = actions.EVENT_PREBLAST_CALLBACK_ID
    else:
        update_view_id = loading_view_id
        if view_id:
            callback_id = actions.EVENT_PREBLAST_CALLBACK_ID
        else:
            callback_id = actions.EVENT_PREBLAST_POST_CALLBACK_ID

    form.update_modal(
        client=client,
        view_id=update_view_id,
        title_text=title_text,
        submit_button_text=submit_button_text,
        parent_metadata=metadata,
        callback_id=callback_id,
    )


def handle_event_preblast_edit(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    form_data = EVENT_PREBLAST_FORM.get_selected_values(body)
    metadata = json.loads(safe_get(body, "view", "private_metadata") or "{}")
    event_instance_id = safe_get(metadata, "event_instance_id")

    preblast_send = (
        form_data[actions.EVENT_PREBLAST_SEND_OPTIONS] == "Send now"
        or (safe_get(metadata, "preblast_ts") or "None") != "None"
    )

    update_fields = {
        EventInstance.name: form_data[actions.EVENT_PREBLAST_TITLE],
        EventInstance.location_id: form_data[actions.EVENT_PREBLAST_LOCATION],
        EventInstance.preblast_rich: fix_from_llm_tags(form_data[actions.EVENT_PREBLAST_MOLESKINE_EDIT]),
        EventInstance.preblast: replace_user_channel_ids(
            parse_rich_block(fix_from_llm_tags(form_data[actions.EVENT_PREBLAST_MOLESKINE_EDIT])),
            region_record,
            client,
            logger,
        ),
        EventInstance.start_time: safe_get(form_data, actions.EVENT_PREBLAST_START_TIME).replace(":", ""),
    }
    if form_data[actions.EVENT_PREBLAST_IMAGE]:
        event_instance_record: EventInstance = DbManager.get(EventInstance, event_instance_id)
        event_instance_meta = event_instance_record.meta or {}
        file_obj = safe_get(form_data[actions.EVENT_PREBLAST_IMAGE], 0)
        file_id = reupload_file_as_bot(file_obj, client, logger, region_record=region_record) or safe_get(
            file_obj, "id"
        )
        event_instance_meta["preblast_image_slack_file_id"] = file_id
        update_fields[EventInstance.meta] = event_instance_meta

    DbManager.update_record(EventInstance, event_instance_id, update_fields)
    DbManager.delete_records(
        cls=EventTag_x_EventInstance,
        filters=[EventTag_x_EventInstance.event_instance_id == event_instance_id],
    )
    if form_data[actions.EVENT_PREBLAST_TAG]:
        DbManager.create_record(
            EventTag_x_EventInstance(
                event_instance_id=event_instance_id,
                event_tag_id=safe_get(form_data, actions.EVENT_PREBLAST_TAG, 0),
            )
        )

    coq_list = safe_get(form_data, actions.EVENT_PREBLAST_COQS) or []
    user_ids = [get_user(slack_id, region_record, client, logger).user_id for slack_id in coq_list]
    # better way to upsert / on conflict do nothing?
    DbManager.delete_records(
        cls=Attendance,
        filters=[
            Attendance.event_instance_id == event_instance_id,
            Attendance.attendance_types.any(AttendanceType.id == 3),
        ],  # COQ type
        joinedloads=[Attendance.attendance_x_attendance_types],
    )
    if user_ids:
        DbManager.delete_records(
            cls=Attendance,
            filters=[
                Attendance.event_instance_id == event_instance_id,
                Attendance.is_planned,
                Attendance.user_id.in_(user_ids),
            ],
            joinedloads=[Attendance.attendance_x_attendance_types],
        )
        new_records = [
            Attendance(
                event_instance_id=event_instance_id,
                user_id=user_id,
                attendance_x_attendance_types=[Attendance_x_AttendanceType(attendance_type_id=3)],
                is_planned=True,
            )
            for user_id in user_ids
        ]
        DbManager.create_records(new_records)

    if preblast_send:
        # Get update mode directly from body since it's dynamically added to the form
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
        repost = update_mode == "Repost preblast"
        send_preblast(
            body,
            client,
            logger,
            context,
            region_record,
            event_instance_id,
            repost=repost,
        )
        # forms.SUBMIT_FORM_SUCCESS.update_modal(
        #     client=client,
        #     view_id=safe_get(body, "view", "id"),
        #     callback_id="submit_form_success",
        #     title_text="Preblast Submitted",
        #     submit_button_text="None",
        # )

    # elif form_data[actions.EVENT_PREBLAST_SEND_OPTIONS] == "Schedule 24 hours before event":
    #     pass  # schedule preblast
    else:
        pass


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
            # TODO: optionally remove the image block as a last resort if the file never becomes ready?
            raise


def send_preblast(
    body: dict = None,
    client: WebClient = None,
    logger: Logger = None,
    context: dict = None,
    region_record: SlackSettings = None,
    event_instance_id: int = None,
    repost: bool = False,
):
    slack_user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")
    preblast_info = build_preblast_info(body, client, logger, context, region_record, event_instance_id)
    q_attendance = next(
        (r for r in preblast_info.attendance_records if any(t.id == 2 for t in r.attendance_types)), None
    )
    q_user_id = safe_get(preblast_info.attendance_slack_dict, q_attendance)
    q_list = [
        r for r in preblast_info.attendance_records if bool({t.id for t in r.attendance_types}.intersection([2, 3]))
    ]
    blocks = [
        *preblast_info.preblast_blocks,
        *get_preblast_action_blocks(has_q=len(q_list) > 0, event_instance_id=event_instance_id),
    ]
    if safe_get(preblast_info.event_record.meta, "preblast_image_slack_file_id"):
        blocks.insert(
            -1,
            orm.ImageBlock(
                slack_file_id=safe_get(preblast_info.event_record.meta, "preblast_image_slack_file_id"),
                alt_text="Preblast Image",
            ),
        )
    blocks = [b.as_form_field() for b in blocks]
    metadata = {
        "event_instance_id": event_instance_id,
        "attendees": [r.user.id for r in preblast_info.attendance_records],
        "qs": [r.user.id for r in q_list],
    }
    if not body:
        # this will happen if called outside a user interaction
        username = None
        icon_url = None
    else:
        slack_id = q_user_id or slack_user_id
        q_name, q_url = get_user_names([slack_id], logger, client, return_urls=True)
        q_name = (q_name or [""])[0]
        q_url = q_url[0]
        username = f"{q_name} (via F3 Nation)"
        icon_url = q_url
    preblast_channel = get_preblast_channel(region_record, preblast_info)

    existing_ts = preblast_info.event_record.preblast_ts or safe_get(metadata, "preblast_ts")
    if existing_ts and preblast_channel:
        if repost:
            # Delete the original message and create a new one
            try:
                client.chat_delete(
                    channel=preblast_channel,
                    ts=str(existing_ts),
                )
            except Exception as e:
                logger.error(f"Error deleting original preblast message for event_instance_id {event_instance_id}: {e}")
            # Post new message
            try:
                res = _post_blocks(
                    client.chat_postMessage,
                    blocks,
                    logger,
                    channel=preblast_channel,
                    text="Event Preblast",
                    metadata={"event_type": "preblast", "event_payload": metadata},
                    unfurl_links=False,
                    username=username,
                    icon_url=icon_url,
                )
                DbManager.update_record(EventInstance, event_instance_id, {EventInstance.preblast_ts: float(res["ts"])})
            except Exception as e:
                logger.error(f"Error posting new preblast message for event_instance_id {event_instance_id}: {e}")
        else:
            # Update existing message
            try:
                _post_blocks(
                    client.chat_update,
                    blocks,
                    logger,
                    channel=preblast_channel,
                    ts=str(existing_ts),
                    text="Event Preblast",
                    metadata={"event_type": "preblast", "event_payload": metadata},
                    username=username,
                    icon_url=icon_url,
                )
            except Exception as e:
                logger.error(f"Error updating preblast message for event_instance_id {event_instance_id}: {e}")
        action_text = "reposted" if repost else "updated"
    else:
        if not preblast_channel:
            preblast_channel = client.chat_postMessage(
                channel=slack_user_id,
                text="Your preblast was saved. However, in order to post it to Slack, you will need to set a preblast "
                "channel. This can be done by region "
                "admins; either at the AO level by going to Settings -> Calendar Settings -> Manage AOs, "
                "or at the region level by going to Settings -> Preblast and Backblast Settings.",
            )
            action_text = "saved (no channel)"
        else:
            res = _post_blocks(
                client.chat_postMessage,
                blocks,
                logger,
                channel=preblast_channel,
                text="Event Preblast",
                metadata={"event_type": "preblast", "event_payload": metadata},
                unfurl_links=False,
                username=username,
                icon_url=icon_url,
            )
            DbManager.update_record(EventInstance, event_instance_id, {EventInstance.preblast_ts: float(res["ts"])})
            action_text = "posted"
    log_msg = f":mega: Preblast {action_text} for *{preblast_info.event_record.name}* on *{preblast_info.event_record.start_date}* by <@{slack_user_id or 'app'}>"  # noqa: E501
    if preblast_channel and preblast_info.event_record.preblast_ts:
        log_msg += f" <slack://channel?team={region_record.team_id}&id={preblast_channel}&ts={preblast_info.event_record.preblast_ts}|Link>\n"  # noqa: E501
    post_bot_log(
        client=client,
        region_record=region_record,
        text=log_msg,
        logger=logger,
    )


def build_preblast_info(
    body: dict = None,
    client: WebClient = None,
    logger: Logger = None,
    context: dict = None,
    region_record: SlackSettings = None,
    event_instance_id: int = None,
) -> PreblastInfo:
    event_record: EventInstance = DbManager.get(EventInstance, event_instance_id, joinedloads="all")
    attendance_records: List[Attendance] = DbManager.find_records(
        Attendance, [Attendance.event_instance_id == event_instance_id, Attendance.is_planned], joinedloads="all"
    )
    attendance_slack_dict = {
        r: next((s.slack_id for s in (r.slack_users or []) if s.slack_team_id == region_record.team_id), None)
        for r in attendance_records
    }

    action_blocks = []
    # build list of attenance_slack_dict where the value is not None
    hc_list = " ".join([f"<@{s}>" for a, s in attendance_slack_dict.items() if s is not None])
    hc_list += " ".join([f"@{a.user.f3_name or 'Unknown'}" for a, s in attendance_slack_dict.items() if s is None])
    hc_list = hc_list if hc_list else "None"
    hc_count = len({r.user.id for r in attendance_records})

    if not body:
        # this will happen if called outside a user interaction
        user_id = None
        user_is_q = False
    else:
        user_id = get_user(
            safe_get(body, "user", "id") or safe_get(body, "user_id"), region_record, client, logger
        ).user_id
        user_is_q = any(
            r.user.id == user_id
            for r in attendance_records
            if bool({t.id for t in r.attendance_types}.intersection([2, 3]))
        )

    q_list = " ".join(
        [
            f"<@{attendance_slack_dict[r]}>"
            for r in attendance_records
            if bool({t.id for t in r.attendance_types}.intersection([2, 3])) and attendance_slack_dict[r]
        ]
    )
    q_list += " ".join(
        [
            f"@{r.user.f3_name or 'Unknown'}"
            for r in attendance_records
            if bool({t.id for t in r.attendance_types}.intersection([2, 3])) and not attendance_slack_dict[r]
        ]
    )
    if not q_list:
        q_list = "Open!"
        action_blocks.append(
            orm.ButtonElement(
                label="Take Q",
                action=actions.EVENT_PREBLAST_TAKE_Q,
                value=str(event_record.id),
            )
        )
    elif user_is_q:
        action_blocks.append(
            orm.ButtonElement(
                label="Take myself off Q",
                action=actions.EVENT_PREBLAST_REMOVE_Q,
                value=str(event_record.id),
            )
        )

    user_hc = any(r.user.id == user_id for r in attendance_records)
    if user_hc:
        if not user_is_q:
            action_blocks.append(
                orm.ButtonElement(
                    label="Un-HC",
                    action=actions.EVENT_PREBLAST_UN_HC,
                    value=str(event_record.id),
                )
            )
    else:
        action_blocks.append(
            orm.ButtonElement(
                label="HC",
                action=actions.EVENT_PREBLAST_HC,
                value=str(event_record.id),
            )
        )

    location = ""
    if safe_get(event_record.org.meta, "slack_channel_id"):
        location += f"<#{event_record.org.meta['slack_channel_id']}>"
    if event_record.location:
        name = get_location_display_name(event_record.location)
        if event_record.location.latitude and event_record.location.longitude:
            location += f" - <https://www.google.com/maps/search/?api=1&query={event_record.location.latitude},{event_record.location.longitude}|{name}>"
        else:
            location += f" - {name}"

    event_details = f"*Preblast: {event_record.name}*"
    event_details += f"\n*Date:* {event_record.start_date.strftime('%A, %B %d')}"
    event_details += f"\n*Time:* {event_record.start_time}"
    event_details += f"\n*Where:* {location}"
    event_details += f"\n*Event Type:* {' / '.join([t.name for t in event_record.event_types])}"
    if event_record.event_tags:
        event_details += f"\n*Event Tag:* {', '.join([tag.name for tag in event_record.event_tags])}"
    event_details += f"\n*Q:* {q_list}"
    event_details += f"\n*HC Count:* {hc_count}"
    event_details += f"\n*HCs:* {hc_list}"

    preblast_blocks = [
        orm.SectionBlock(label=event_details),
        orm.RichTextBlock(
            label=event_record.preblast_rich or region_record.preblast_moleskin_template or DEFAULT_PREBLAST
        ),
    ]
    return PreblastInfo(
        event_record=event_record,
        attendance_records=attendance_records,
        preblast_blocks=preblast_blocks,
        action_blocks=action_blocks,
        user_is_q=user_is_q,
        attendance_slack_dict=attendance_slack_dict,
    )


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

    if view_id:
        if action_id == actions.EVENT_PREBLAST_HC:
            DbManager.create_record(
                Attendance(
                    event_instance_id=event_instance_id,
                    user_id=user_id,
                    attendance_x_attendance_types=[Attendance_x_AttendanceType(attendance_type_id=1)],
                    is_planned=True,
                )
            )
        elif action_id == actions.EVENT_PREBLAST_UN_HC:
            DbManager.delete_records(
                cls=Attendance,
                filters=[
                    Attendance.event_instance_id == event_instance_id,
                    Attendance.user_id == user_id,
                    Attendance.is_planned,
                    Attendance.attendance_x_attendance_types.any(Attendance_x_AttendanceType.attendance_type_id == 1),
                ],
                joinedloads=[Attendance.attendance_x_attendance_types],
            )
        elif action_id == actions.EVENT_PREBLAST_TAKE_Q:
            DbManager.delete_records(
                cls=Attendance,
                filters=[
                    Attendance.event_instance_id == event_instance_id,
                    Attendance.user_id == user_id,
                    Attendance.is_planned,
                ],
                joinedloads=[Attendance.attendance_x_attendance_types],
            )
            DbManager.create_record(
                Attendance(
                    event_instance_id=event_instance_id,
                    user_id=user_id,
                    attendance_x_attendance_types=[Attendance_x_AttendanceType(attendance_type_id=2)],
                    is_planned=True,
                )
            )
        elif action_id == actions.EVENT_PREBLAST_REMOVE_Q:
            DbManager.delete_records(
                cls=Attendance,
                filters=[
                    Attendance.event_instance_id == event_instance_id,
                    Attendance.user_id == user_id,
                    Attendance.attendance_x_attendance_types.any(
                        Attendance_x_AttendanceType.attendance_type_id.in_([2, 3])
                    ),
                    Attendance.is_planned,
                ],
                joinedloads=[Attendance.attendance_x_attendance_types],
            )
            # Touch EventInstance.updated so calendar images are regenerated
            DbManager.update_record(EventInstance, event_instance_id, fields={"updated": datetime.now(timezone.utc)})
        if metadata.get("preblast_ts") and metadata["preblast_ts"] != "None":
            preblast_info = build_preblast_info(body, client, logger, context, region_record, event_instance_id)
            blocks = [
                *preblast_info.preblast_blocks,
                *get_preblast_action_blocks(
                    has_q=len(preblast_info.action_blocks) > 0, event_instance_id=event_instance_id
                ),
            ]
            if safe_get(preblast_info.event_record.meta, "preblast_image_slack_file_id"):
                blocks.insert(
                    -1,
                    orm.ImageBlock(
                        slack_file_id=safe_get(preblast_info.event_record.meta, "preblast_image_slack_file_id"),
                        alt_text="Preblast Image",
                    ),
                )
            blocks = [b.as_form_field() for b in blocks]

            q_name, q_url = get_user_names([slack_user_id], logger, client, return_urls=True)
            q_name = (q_name or [""])[0]
            q_url = q_url[0]
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
                    f"Error updating preblast message after action {action_id} and event_instance_id {event_instance_id}: {e}"  # noqa
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
            body, client, logger, context, region_record, event_instance_id=event_instance_id, update_view_id=view_id
        )
    else:
        if action_id == actions.EVENT_PREBLAST_HC_UN_HC:
            already_hcd = user_id in (safe_get(metadata, "attendees") or [])
            if already_hcd:
                DbManager.delete_records(
                    cls=Attendance,
                    filters=[
                        Attendance.event_instance_id == event_instance_id,
                        Attendance.user_id == user_id,
                        Attendance.attendance_types.any(AttendanceType.id == 1),
                        Attendance.is_planned,
                    ],
                    joinedloads=[Attendance.attendance_types],
                )
            else:
                try:
                    DbManager.create_record(
                        Attendance(
                            event_instance_id=event_instance_id,
                            user_id=user_id,
                            attendance_x_attendance_types=[Attendance_x_AttendanceType(attendance_type_id=1)],
                            is_planned=True,
                        )
                    )
                except Exception as e:
                    logger.warning(
                        f"User {user_id} already marked as HC for event {event_instance_id} or is duplicate: {e}"
                    )
            preblast_info = build_preblast_info(body, client, logger, context, region_record, event_instance_id)
            q_id_list = [
                r.user.id
                for r in preblast_info.attendance_records
                if bool({t.id for t in r.attendance_types}.intersection([2, 3]))
            ]
            metadata = {
                "event_instance_id": event_instance_id,
                "attendees": [r.user.id for r in preblast_info.attendance_records],
                "qs": q_id_list,
            }
            button_blocks = get_preblast_action_blocks(has_q=len(q_id_list) > 0, event_instance_id=event_instance_id)
            blocks = [*preblast_info.preblast_blocks, *button_blocks]
            if safe_get(preblast_info.event_record.meta, "preblast_image_slack_file_id"):
                blocks.insert(
                    -1,
                    orm.ImageBlock(
                        slack_file_id=safe_get(preblast_info.event_record.meta, "preblast_image_slack_file_id"),
                        alt_text="Preblast Image",
                    ),
                )
            q_name, q_url = get_user_names([slack_user_id], logger, client, return_urls=True)
            q_name = (q_name or [""])[0]
            q_url = q_url[0]
            preblast_channel = get_preblast_channel(region_record, preblast_info)
            client.chat_update(
                channel=preblast_channel,
                ts=body["message"]["ts"],
                blocks=[b.as_form_field() for b in blocks],
                text="Preblast",
                metadata={"event_type": "preblast", "event_payload": metadata},
                username=f"{q_name} (via F3 Nation)",
                icon_url=q_url,
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
            build_event_preblast_form(body, client, logger, context, region_record, event_instance_id=event_instance_id)
        elif action_id == actions.EVENT_PREBLAST_TAKE_Q:
            event_instance_id = safe_convert(body["actions"][0]["value"], int)
            DbManager.delete_records(
                cls=Attendance,
                filters=[
                    Attendance.event_instance_id == event_instance_id,
                    Attendance.user_id == user_id,
                    Attendance.is_planned,
                ],
                joinedloads=[Attendance.attendance_x_attendance_types],
            )
            DbManager.create_record(
                Attendance(
                    event_instance_id=event_instance_id,
                    user_id=user_id,
                    attendance_x_attendance_types=[Attendance_x_AttendanceType(attendance_type_id=2)],
                    is_planned=True,
                )
            )
            build_event_preblast_form(body, client, logger, context, region_record, event_instance_id=event_instance_id)


DEFAULT_PREBLAST = {
    "type": "rich_text",
    "elements": [{"type": "rich_text_section", "elements": [{"text": "No preblast text entered", "type": "text"}]}],
}

EVENT_PREBLAST_FORM = orm.BlockView(
    blocks=[
        orm.InputBlock(
            label="Title",
            action=actions.EVENT_PREBLAST_TITLE,
            element=orm.PlainTextInputElement(
                placeholder="Event Title",
            ),
            optional=False,
            hint="Studies show that fun titles generate 42% more HC's!",
        ),
        orm.InputBlock(
            label="Location",
            action=actions.EVENT_PREBLAST_LOCATION,
            element=orm.StaticSelectElement(),
            optional=True,
        ),
        orm.InputBlock(
            label="Start Time",
            action=actions.EVENT_PREBLAST_START_TIME,
            element=orm.TimepickerElement(placeholder="Select start time"),
            optional=False,
        ),
        orm.InputBlock(
            label="Co-Qs",
            action=actions.EVENT_PREBLAST_COQS,
            element=orm.MultiUsersSelectElement(placeholder="Select Co-Qs"),
            optional=True,
        ),
        orm.InputBlock(
            label="Event Tag",
            action=actions.EVENT_PREBLAST_TAG,
            element=orm.MultiStaticSelectElement(placeholder="Select Event Tag", max_selected_items=1),
            optional=True,
        ),
        orm.InputBlock(
            label="Preblast",
            action=actions.EVENT_PREBLAST_MOLESKINE_EDIT,
            element=orm.RichTextInputElement(placeholder="Give us an event preview!"),
            optional=False,
        ),
        orm.InputBlock(
            label="Preblast Image",
            action=actions.EVENT_PREBLAST_IMAGE,
            element=orm.FileInputElement(
                placeholder="Upload an image to be included in the preblast",
                filetypes=["jpg", "jpeg", "png", "gif"],
                max_files=1,
            ),
            optional=True,
            hint="Missing images from iOS? HEICs are a pain, write Tim Cook and tell him to stop using proprietary formats that break everything",  # noqa
        ),
        orm.InputBlock(
            label="When to send preblast?",
            action=actions.EVENT_PREBLAST_SEND_OPTIONS,
            element=orm.RadioButtonsElement(
                options=orm.as_selector_options(
                    names=["Send now", "Send a day before the event"],
                ),
                initial_value="Send a day before the event",
            ),
            optional=False,
        ),
    ]
)
