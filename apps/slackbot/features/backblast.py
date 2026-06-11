import copy
import json
import os
import ssl
import time
from collections import defaultdict
from datetime import datetime
from logging import Logger
from typing import Dict, List

import pytz
from cryptography.fernet import Fernet
from f3_data_models.models import (
    Attendance,
    Attendance_x_AttendanceType,
    AttendanceType,
    EventInstance,
    EventType_x_EventInstance,
    Location,
    Org,
    Org_Type,
    Org_x_SlackSpace,
    SlackSpace,
    SlackUser,
    User,
)
from f3_data_models.utils import DbManager
from slack_sdk.web import WebClient
from sqlalchemy import not_, or_
from sqlmodel import func

from features import connect
from utilities import constants, sendmail
from utilities.bot_logger import post_bot_log
from utilities.database.orm import SlackSettings
from utilities.database.special_queries import (
    MissingBackblastQuery,
    event_attendance_query,
    get_admin_users,
    get_aoq_users,
    missing_backblasts_query,
)
from utilities.helper_functions import (
    REGION_RECORDS,
    current_date_cst,
    fix_from_llm_tags,
    get_location_display_name,
    get_pax,
    get_user,
    parse_rich_block,
    remove_keys_from_dict,
    replace_rich_text_user_channel,
    replace_user_channel_ids,
    safe_convert,
    safe_get,
    upload_files_to_storage,
)
from utilities.slack import actions, forms
from utilities.slack import orm as slack_orm

META_EXCLUDE_FROM_PAX_VAULT = "exclude_from_pax_vault"


def add_custom_field_blocks(
    form: slack_orm.BlockView, region_record: SlackSettings, initial_values: dict = None
) -> slack_orm.BlockView:
    if initial_values is None:
        initial_values = {}
    output_form = copy.deepcopy(form)
    for custom_field in (region_record.custom_fields or {}).values():
        if safe_get(custom_field, "enabled"):
            output_form.add_block(
                slack_orm.InputBlock(
                    element=forms.CUSTOM_FIELD_TYPE_MAP[custom_field["type"]],
                    action=actions.CUSTOM_FIELD_PREFIX + custom_field["name"],
                    label=custom_field["name"],
                    optional=True,
                )
            )
            if safe_get(custom_field, "type") == "Dropdown":
                output_form.set_options(
                    {
                        actions.CUSTOM_FIELD_PREFIX + custom_field["name"]: slack_orm.as_selector_options(
                            names=custom_field["options"],
                            values=custom_field["options"],
                        )
                    }
                )
            if initial_values and custom_field["name"] in initial_values:
                output_form.set_initial_values(
                    {
                        actions.CUSTOM_FIELD_PREFIX + custom_field["name"]: safe_convert(
                            safe_get(initial_values, custom_field["name"]), str
                        )
                        or ""
                    }
                )
            else:
                output_form.set_initial_values({actions.CUSTOM_FIELD_PREFIX + custom_field["name"]: None})
    return output_form


def backblast_middleware(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    action_id = safe_get(body, "actions", 0, "action_id") or ""
    if (
        region_record.org_id is None
        or (safe_convert(region_record.migration_date, datetime.strptime, args=["%Y-%m-%d"]) or datetime.now())
        > datetime.now()
    ):
        connect.build_connect_options_form(body, client, logger, context, region_record)
    elif action_id == actions.MSG_EVENT_BACKBLAST_BUTTON:
        event_instance_id = safe_convert(safe_get(body, "actions", 0, "value"), int)
        event_instance = DbManager.get(EventInstance, event_instance_id)
        if event_instance.backblast_ts:
            form = copy.deepcopy(forms.ALREADY_POSTED_FORM)
            form.post_modal(
                client=client,
                trigger_id=safe_get(body, "trigger_id"),
                title_text="Backblast",
                callback_id=actions.ALREADY_POSTED,
                submit_button_text="None",
            )
            return
        else:
            build_backblast_form(body, client, logger, context, region_record)
    elif (
        action_id == actions.PREBLAST_FILL_BACKBLAST_BUTTON
        or action_id[: len(actions.BACKBLAST_FILL_BUTTON)] == actions.BACKBLAST_FILL_BUTTON
    ):
        event_instance_id = safe_convert(safe_get(body, "actions", 0, "value"), int)
        event_instance = DbManager.get(EventInstance, event_instance_id)
        if event_instance.backblast_ts:
            form = copy.deepcopy(forms.ALREADY_POSTED_FORM)
            form.update_modal(
                client=client,
                view_id=safe_get(body, actions.LOADING_ID),
                title_text="Backblast",
                callback_id=actions.ALREADY_POSTED,
                submit_button_text="None",
            )
            try:
                blocks = safe_get(body, "message", "blocks")
                blocks[-1].get("elements").pop(-1)  # remove the fill backblast button
                client.chat_update(
                    channel=safe_get(body, "container", "channel_id"),
                    ts=safe_get(body, "container", "message_ts"),
                    text=safe_get(body, "message", "text"),
                    blocks=blocks,
                )
            except Exception as e:
                logger.error(f"Error updating message to remove fill backblast button: {e}")
            return
        else:
            user_id = get_user(
                safe_get(body, "user", "id") or safe_get(body, "user_id"), region_record, client, logger
            ).user_id
            attendance_records = DbManager.find_records(
                Attendance,
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
            admin_users = get_admin_users(region_record.org_id, region_record.team_id)
            if attendance_records or any(u[0].id == user_id for u in admin_users):
                build_backblast_form(body, client, logger, context, region_record, event_instance_id=event_instance_id)
    else:
        user = get_user(safe_get(body, "user", "id") or safe_get(body, "user_id"), region_record, client, logger)
        user_id = user.user_id
        event_records = event_attendance_query(
            attendance_filter=[
                Attendance.user_id == user_id,
                Attendance.is_planned,
                Attendance.attendance_types.any(AttendanceType.id.in_([2, 3])),
            ],
            event_filter=[
                EventInstance.start_date <= current_date_cst(),
                EventInstance.backblast_ts.is_(None),
                EventInstance.is_active,
                or_(
                    EventInstance.org_id == region_record.org_id,
                    EventInstance.org.has(Org.parent_id == region_record.org_id),
                ),
                or_(
                    EventInstance.meta.is_(None),
                    func.coalesce(
                        EventInstance.meta["backblast_reminder_dismissed"].as_boolean(),
                        False,
                    ).is_(False),
                ),
            ],
        )

        if event_records:
            # sort by most recent date first
            event_records.sort(key=lambda r: r.start_date, reverse=True)
            select_blocks = [
                slack_orm.HeaderBlock(label=":point_up:Select From Recent Qs:"),
                slack_orm.ActionsBlock(
                    elements=[
                        slack_orm.ButtonElement(
                            label=f"{r.start_date.strftime('%m/%d')} {r.org.name} {' / '.join([t.name for t in r.event_types])}",  # noqa: E501
                            action=f"{actions.BACKBLAST_FILL_BUTTON}_{r.id}",
                            value=str(r.id),
                        )
                        for r in event_records[:4]
                    ],
                ),
            ]
            if len(event_records) > 4:
                select_blocks.append(
                    slack_orm.InputBlock(
                        label="All past Qs",
                        action=actions.BACKBLAST_FILL_SELECT,
                        dispatch_action=True,
                        optional=False,
                        element=slack_orm.StaticSelectElement(
                            placeholder="Select an event",
                            options=slack_orm.as_selector_options(
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
                slack_orm.SectionBlock(label="No past events for you to send a backblast for!"),
            ]

        blocks = [
            *select_blocks,
            slack_orm.DividerBlock(),
        ]
        blocks += [
            slack_orm.SectionBlock(label="Or, create a backblast for an event *not on the calendar:*"),
            slack_orm.ActionsBlock(
                elements=[
                    slack_orm.ButtonElement(
                        label="New Unscheduled Event",
                        action=actions.BACKBLAST_NEW_BLANK_BUTTON,
                        confirm=slack_orm.ConfirmObject(
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

        admin_users = get_admin_users(region_record.org_id, region_record.team_id)
        aoq_users = get_aoq_users(region_record.org_id)
        user_is_admin = any(u[0].id == user_id for u in admin_users) or any(u.id == user_id for u in aoq_users)
        if user_is_admin:
            blocks.append(slack_orm.DividerBlock())
            blocks.append(
                slack_orm.ActionsBlock(
                    elements=[
                        slack_orm.ButtonElement(
                            label=":mag: Missing Backblasts",
                            action=actions.MISSING_BACKBLASTS_BUTTON,
                            value="missing",
                        )
                    ]
                )
            )

        form = slack_orm.BlockView(blocks=blocks)
        form.update_modal(
            client=client,
            view_id=safe_get(body, actions.LOADING_ID),
            callback_id=actions.BACKBLAST_SELECT_CALLBACK_ID,
            title_text="Select Backblast",
            submit_button_text="None",
        )


def build_missing_backblasts_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
    update_view_id: str = None,
):
    slack_user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")
    user_id = get_user(slack_user_id, region_record, client, logger).user_id

    admin_users = get_admin_users(region_record.org_id, region_record.team_id)
    aoq_users = get_aoq_users(region_record.org_id)
    user_is_admin = any(u[0].id == user_id for u in admin_users) or any(u.id == user_id for u in aoq_users)
    if not user_is_admin:
        return

    from f3_data_models.models import Org_Type

    ao_records = DbManager.find_records(
        Org,
        filters=[Org.parent_id == region_record.org_id, Org.org_type == Org_Type.ao, Org.is_active.is_(True)],
    )

    # Build filter blocks first so we can parse existing selections
    filter_block = slack_orm.InputBlock(
        label="Filter by AO",
        action=actions.MISSING_BACKBLASTS_AO_FILTER,
        element=slack_orm.MultiStaticSelectElement(
            placeholder="All AOs",
            options=slack_orm.as_selector_options(
                names=[ao.name for ao in ao_records],
                values=[str(ao.id) for ao in ao_records],
            ),
        ),
        dispatch_action=True,
        optional=True,
    )

    existing_filter_data = {}
    if safe_get(body, "view"):
        existing_filter_data = slack_orm.BlockView(blocks=[filter_block]).get_selected_values(body)

    selected_ao_ids = [
        v
        for v in (
            safe_convert(x, int) for x in (safe_get(existing_filter_data, actions.MISSING_BACKBLASTS_AO_FILTER) or [])
        )
        if v is not None
    ]

    missing: List[MissingBackblastQuery] = missing_backblasts_query(
        region_org_id=region_record.org_id,
        slack_team_id=region_record.team_id,
        org_ids=selected_ao_ids or None,
    )

    blocks = [
        slack_orm.HeaderBlock(label=":mag: Missing Backblasts (Last 60 Days)"),
        filter_block,
        slack_orm.DividerBlock(),
    ]

    if missing:
        for item in missing:
            event_type_str = " / ".join(t.name for t in item.event_types)
            q_tag = " / ".join(f"<@{sid}>" for sid in item.q_slack_ids) if item.q_slack_ids else "Open"
            site_q_tag = " / ".join(f"<@{sid}>" for sid in item.site_q_slack_ids) if item.site_q_slack_ids else "None"
            label = (
                f"*{item.event.start_date.strftime('%m/%d')}* @ {item.org.name} {event_type_str}"
                f" | Q: {q_tag} | Site Q: {site_q_tag}"
            )

            overflow_names = ["Edit Backblast", "Remove from List"]
            if item.site_q_slack_ids:
                overflow_names.append("Notify Site Q")
            if item.q_slack_ids:
                overflow_names.append("Notify Q")

            blocks.append(
                slack_orm.SectionBlock(
                    label=label,
                    element=slack_orm.OverflowElement(
                        action=f"{actions.MISSING_BACKBLASTS_EVENT}_{item.event.id}",
                        options=slack_orm.as_selector_options(overflow_names),
                    ),
                )
            )
    else:
        blocks.append(slack_orm.SectionBlock(label="No missing backblasts in the last 60 days! :tada:"))

    form = slack_orm.BlockView(blocks=blocks)
    form.set_initial_values(existing_filter_data)
    view_id = update_view_id or safe_get(body, actions.LOADING_ID) or safe_get(body, "view", "id")
    if view_id:
        form.update_modal(
            client=client,
            view_id=view_id,
            title_text="Missing Backblasts",
            callback_id=actions.MISSING_BACKBLASTS_CALLBACK_ID,
            submit_button_text="None",
        )
    else:
        form.post_modal(
            client=client,
            trigger_id=safe_get(body, "trigger_id"),
            title_text="Missing Backblasts",
            callback_id=actions.MISSING_BACKBLASTS_CALLBACK_ID,
            new_or_add="add",
            submit_button_text="None",
        )


def handle_missing_backblasts_overflow(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    action_id = safe_get(body, "actions", 0, "action_id") or ""
    event_instance_id = safe_convert(action_id[len(actions.MISSING_BACKBLASTS_EVENT) + 1 :], int)
    action = safe_get(body, "actions", 0, "selected_option", "value")
    view_id = safe_get(body, "view", "id")
    slack_user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")

    if action == "Edit Backblast":
        build_backblast_form(body, client, logger, context, region_record, event_instance_id=event_instance_id)
        return

    if action == "Remove from List":
        event_record = DbManager.get(EventInstance, event_instance_id)
        meta = (event_record.meta or {}).copy()
        meta["backblast_admin_dismissed"] = True
        DbManager.update_record(EventInstance, event_instance_id, fields={EventInstance.meta: meta})

    elif action in ("Notify Q", "Notify Site Q"):
        event_record = DbManager.get(
            EventInstance, event_instance_id, joinedloads=[EventInstance.org, EventInstance.event_types]
        )
        event_label = f"{event_record.org.name} on {event_record.start_date.strftime('%A, %B %d')}"
        event_type_str = " / ".join(t.name for t in event_record.event_types)

        notify_blocks = [
            slack_orm.SectionBlock(
                label=(
                    f"<@{slack_user_id}> is reminding you that the backblast for "
                    f"*{event_label}* ({event_type_str}) has not been submitted."
                )
            ),
            slack_orm.ActionsBlock(
                elements=[
                    slack_orm.ButtonElement(
                        label="Submit Backblast",
                        value=str(event_instance_id),
                        style="primary",
                        action=actions.MSG_EVENT_BACKBLAST_BUTTON,
                    )
                ]
            ),
        ]
        notify_blocks_rendered = [b.as_form_field() for b in notify_blocks]
        notify_text = f"Reminder: backblast for {event_label} has not been submitted."

        if action == "Notify Q":
            # Pull planned Q/CoQ Slack IDs for this event
            q_attendance = DbManager.find_records(
                Attendance,
                filters=[
                    Attendance.event_instance_id == event_instance_id,
                    Attendance.is_planned,
                    Attendance.attendance_x_attendance_types.any(
                        Attendance_x_AttendanceType.attendance_type_id.in_([2, 3])
                    ),
                ],
                joinedloads=[Attendance.slack_users, Attendance.attendance_x_attendance_types],
            )
            target_slack_ids = [
                s.slack_id
                for r in q_attendance
                for s in (r.slack_users or [])
                if s.slack_team_id == region_record.team_id
            ]
        else:
            # Site Q — look up via Position
            from utilities.database.special_queries import get_site_q_slack_ids_by_ao

            site_q_map = get_site_q_slack_ids_by_ao([event_record.org_id], region_record.team_id)
            target_slack_ids = site_q_map.get(event_record.org_id, [])

        for target_id in target_slack_ids:
            try:
                client.chat_postMessage(
                    channel=target_id,
                    text=notify_text,
                    blocks=notify_blocks_rendered,
                )
            except Exception as e:
                logger.error(f"Error sending missing backblast notification to {target_id}: {e}")

    build_missing_backblasts_form(body, client, logger, context, region_record, update_view_id=view_id)


def build_backblast_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
    event_instance_id: int = None,
):
    """
    Args:
        body (dict): Slack request body
        client (WebClient): Slack WebClient object
        logger (Logger): Logger object
        context (dict): Slack request context
        region_record (Region): Region record for the requesting region
    """

    user_id = safe_get(body, "user_id") or safe_get(body, "user", "id")
    trigger_id = safe_get(body, "trigger_id")
    backblast_metadata = safe_get(body, "message", "metadata", "event_payload") or {}
    view_metadata = safe_convert(safe_get(body, "view", "private_metadata") or "{}", json.loads)
    action_id = safe_get(body, "actions", 0, "action_id") or ""
    f3_user_id = get_user(user_id, region_record, client, logger).user_id
    is_scheduled = True
    if event_instance_id:
        pass
    elif action_id == actions.BACKBLAST_FILL_SELECT:
        event_instance_id = safe_convert(safe_get(body, "actions", 0, "selected_option", "value"), int)
    elif action_id == actions.MSG_EVENT_BACKBLAST_BUTTON:
        event_instance_id = safe_convert(safe_get(body, "actions", 0, "value"), int)
    elif action_id[: len(actions.BACKBLAST_FILL_BUTTON)] == actions.BACKBLAST_FILL_BUTTON:
        event_instance_id = safe_convert(safe_get(body, "actions", 0, "value"), int)
    elif action_id == actions.BACKBLAST_NEW_BLANK_BUTTON or view_metadata.get("is_unscheduled") == "true":
        event_instance_id = None
        is_scheduled = False
        event_record = None
    elif action_id == actions.BACKBLAST_NOQ_SELECT:
        event_instance_id = safe_convert(safe_get(body, "actions", 0, "selected_option", "value"), int)
        try:
            DbManager.create_record(
                Attendance(
                    event_instance_id=event_instance_id,
                    user_id=f3_user_id,
                    is_planned=True,
                    attendance_x_attendance_types=[Attendance_x_AttendanceType(attendance_type_id=2)],  # assign as Q
                )
            )
        except Exception as e:
            logger.error(f"Error creating attendance record for backblast no-Q select: {e}")
    else:
        event_instance_id = safe_get(backblast_metadata, "event_instance_id")
    update_view_id = safe_get(body, actions.LOADING_ID) or safe_get(body, "view", "id")

    backblast_form = copy.deepcopy(forms.BACKBLAST_FORM)
    attendance_non_slack_users = []
    is_paxminer_backblast = False
    if event_instance_id:
        event_record: EventInstance = DbManager.get(
            EventInstance, event_instance_id, joinedloads=[EventInstance.org, EventInstance.event_types]
        )
        event_metadata = event_record.meta or {}
        already_posted = event_record.backblast_ts is not None
        already_saved = event_record.pax_count is not None
        attendance_records: List[Attendance] = DbManager.find_records(
            Attendance,
            [Attendance.event_instance_id == event_instance_id, Attendance.is_planned != already_saved],
            joinedloads="all",
        )
        attendance_slack_dict = {
            r: next((s.slack_id for s in (r.slack_users or []) if s.slack_team_id == region_record.team_id), None)
            for r in attendance_records
        }
        # create a list of attendance records that are not in slack
        attendance_non_slack_users = [r for r in attendance_records if not attendance_slack_dict[r]]
        q_list = [
            attendance_slack_dict[r]
            for r in attendance_records
            if bool({t.id for t in r.attendance_types}.intersection([2])) and attendance_slack_dict[r]
        ]
        if not q_list and safe_get(body, "actions", 0, "action_id") == actions.BACKBLAST_NOQ_SELECT:
            q_list = [user_id]
        coq_list = [
            attendance_slack_dict[r]
            for r in attendance_records
            if bool({t.id for t in r.attendance_types}.intersection([3])) and attendance_slack_dict[r]
        ]
        slack_pax_list = [attendance_slack_dict[r] for r in attendance_records if attendance_slack_dict[r]]

        if already_posted or event_record.backblast_rich or event_record.backblast:
            if event_record.backblast_rich and len(event_record.backblast_rich) > 0:
                moleskin_block = [
                    block for block in event_record.backblast_rich if safe_get(block, "type") == "rich_text"
                ][0]
            elif event_record.backblast:
                # this will happen when trying to edit a backblast from the old paxminer system
                is_paxminer_backblast = True
                moleskin_block = {
                    "type": "rich_text",
                    "elements": [
                        {
                            "type": "rich_text_section",
                            "elements": [
                                {
                                    "type": "text",
                                    "text": event_record.backblast,
                                }
                            ],
                        }
                    ],
                }
                # find moleskin block number and add hint to edit form about legacy backblast
                for i, block in enumerate(backblast_form.blocks):
                    if block.action == actions.BACKBLAST_MOLESKIN:
                        backblast_form.blocks[
                            i
                        ].hint = ":warning: This backblast was created in paxminer. If resaving, we recommend deleting the header lines so they are not duplicated."  # noqa: E501
        else:
            moleskin_block = None
        initial_backblast_data = {
            actions.BACKBLAST_TITLE: event_record.name,
            actions.BACKBLAST_INFO: f"""
*AO:* {event_record.org.name}
*DATE:* {event_record.start_date.strftime("%Y-%m-%d")}
*EVENT TYPE:* {" / ".join([t.name for t in event_record.event_types])}
""",
            # actions.BACKBLAST_DATE: event_record.start_date.strftime("%Y-%m-%d"),
            # actions.BACKBLAST_AO: event_record.org.meta["slack_channel_id"],
            actions.BACKBLAST_Q: safe_get(q_list, 0),
            actions.BACKBLAST_COQ: coq_list,
            actions.BACKBLAST_PAX: slack_pax_list,
            actions.BACKBLAST_MOLESKIN: moleskin_block or region_record.backblast_moleskin_template,
            actions.BACKBLAST_FNGS: safe_get(backblast_metadata, actions.BACKBLAST_FNGS) or "",
            actions.BACKBLAST_NONSLACK_PAX: safe_get(backblast_metadata, actions.BACKBLAST_NONSLACK_PAX) or "",
            # actions.BACKBLAST_EVENT_TYPE: str(event_record.event_types[0].id),  # picking the first for now
            # TODO: non-slack pax
        }
        # Restore options checkbox state
        options = []
        if safe_get(event_metadata, META_EXCLUDE_FROM_PAX_VAULT):
            options.append("exclude_from_pax_vault")
        if options:
            initial_backblast_data[actions.BACKBLAST_OPTIONS] = options
        backblast_metadata["event_instance_id"] = event_instance_id
    elif safe_get(backblast_metadata, actions.BACKBLAST_TITLE):
        initial_backblast_data = backblast_metadata
        moleskin_block = safe_get(body, "message", "blocks", 1)
        moleskin_block = remove_keys_from_dict(moleskin_block, ["display_team_id", "display_url"])
        initial_backblast_data[actions.BACKBLAST_MOLESKIN] = moleskin_block
        event_metadata = {}
    else:
        # this is triggered for unscheduled backblasts
        for block in forms.UNSCHEDULED_BACKBLAST_BLOCKS:
            backblast_form.blocks.insert(2, block)
        backblast_form.delete_block(actions.BACKBLAST_INFO)
        aos: List[Org] = DbManager.find_records(
            Org, [Org.parent_id == region_record.org_id, Org.is_active, Org.org_type == Org_Type.ao]
        )
        ao_location_records = DbManager.find_join_records2(
            Location,
            Org,
            [
                Location.org_id == Org.id,
                or_(Org.parent_id == region_record.org_id, Org.id == region_record.org_id),
                Location.is_active,
            ],
        )
        location_records: List[Location] = [record[0] for record in ao_location_records]
        # De-duplicate in case a location appears in both sources.
        location_records = list({location.id: location for location in location_records}.values())
        location_records.sort(key=lambda location: (get_location_display_name(location) or "").lower())
        region_org_record: Org = DbManager.get(Org, region_record.org_id, joinedloads=[Org.event_types])
        backblast_form.set_options(
            {
                actions.BACKBLAST_AO: slack_orm.as_selector_options(
                    names=[ao.name for ao in aos],
                    values=[str(ao.id) for ao in aos],
                ),
                actions.BACKBLAST_EVENT_TYPE: slack_orm.as_selector_options(
                    names=[event_type.name for event_type in region_org_record.event_types],
                    values=[str(event_type.id) for event_type in region_org_record.event_types],
                ),
                actions.BACKBLAST_LOCATION: slack_orm.as_selector_options(
                    names=[get_location_display_name(location) for location in location_records],
                    values=[str(location.id) for location in location_records],
                ),
            }
        )
        initial_backblast_data = {
            actions.BACKBLAST_Q: user_id,
            actions.BACKBLAST_DATE: datetime.now(pytz.timezone("US/Central")).strftime("%Y-%m-%d"),
            actions.BACKBLAST_MOLESKIN: region_record.backblast_moleskin_template,
        }
        event_metadata = {}
        attendance_non_slack_users = []

    org_event_types: Org = DbManager.get(Org, region_record.org_id, joinedloads=[Org.event_types])
    event_type_options = slack_orm.as_selector_options(
        [r.name for r in org_event_types.event_types], [str(r.id) for r in org_event_types.event_types]
    )

    if (current_date_cst() < (safe_get(event_record, "start_date") or current_date_cst())) or is_paxminer_backblast:
        initial_backblast_data[actions.BACKBLAST_SEND_OPTIONS] = "Save and send later"

    backblast_form.set_options({actions.BACKBLAST_EVENT_TYPE: event_type_options})
    backblast_form.set_initial_values(initial_backblast_data)
    backblast_form = add_custom_field_blocks(backblast_form, region_record, initial_values=event_metadata)

    if safe_get(backblast_metadata, actions.BACKBLAST_FILE, 0):
        backblast_form.blocks.insert(
            1,
            slack_orm.ImageBlock(
                image_url=backblast_metadata[actions.BACKBLAST_FILE][0],
                alt_text="Existing Boyband",
            ),
        )

    if attendance_non_slack_users:
        update_list = [
            {
                "text": r.user.f3_name,
                "value": str(r.user.id),
            }
            for r in attendance_non_slack_users
        ]
        backblast_form.set_initial_values({actions.USER_OPTION_LOAD: update_list})

    if (region_record.email_enabled or 0) == 0 or (region_record.email_option_show or 0) == 0:
        backblast_form.delete_block(actions.BACKBLAST_EMAIL_SEND)
    # backblast_metadata = None
    if action_id == actions.BACKBLAST_EDIT_BUTTON or safe_get(event_record, "backblast_ts"):
        callback_id = actions.BACKBLAST_EDIT_CALLBACK_ID
        backblast_metadata["channel_id"] = safe_get(body, "container", "channel_id")
        backblast_metadata["message_ts"] = safe_get(body, "container", "message_ts")
        backblast_metadata["files"] = safe_get(backblast_metadata, actions.BACKBLAST_FILE) or []
        backblast_metadata["file_ids"] = safe_get(backblast_metadata, "file_ids") or []
    else:
        callback_id = actions.BACKBLAST_CALLBACK_ID

    backblast_metadata["is_scheduled"] = is_scheduled

    if update_view_id:
        backblast_form.update_modal(
            client=client,
            view_id=update_view_id,
            callback_id=callback_id,
            title_text="Backblast",
            parent_metadata=backblast_metadata,
        )
    else:
        backblast_form.post_modal(
            client=client,
            trigger_id=trigger_id,
            callback_id=callback_id,
            title_text="Backblast",
            parent_metadata=backblast_metadata,
        )


def handle_backblast_post(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    create_or_edit = "create" if safe_get(body, "view", "callback_id") == actions.BACKBLAST_CALLBACK_ID else "edit"
    metadata = json.loads(safe_get(body, "view", "private_metadata") or "{}")
    event_instance_id = safe_get(metadata, "event_instance_id")
    backblast_form = copy.deepcopy(forms.BACKBLAST_FORM)
    backblast_form = add_custom_field_blocks(backblast_form, region_record)
    slack_user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")

    if event_instance_id:
        event: EventInstance = DbManager.get(
            EventInstance, event_instance_id, joinedloads=[EventInstance.org, EventInstance.event_types]
        )
        date = event.start_date
        event_type = event.event_types[0].id if event.event_types else None
        event_org = event.org
        backblast_data: dict = backblast_form.get_selected_values(body)
        print(f"Backblast data from scheduled event: {backblast_data}")
    else:
        event = None
        date = None
        event_type = None
        for block in forms.UNSCHEDULED_BACKBLAST_BLOCKS:
            backblast_form.blocks.append(block)
        backblast_data: dict = backblast_form.get_selected_values(body)
        event_org = DbManager.get(Org, safe_convert(safe_get(backblast_data, actions.BACKBLAST_AO), int))

    logger.debug(f"Backblast data: {backblast_data}")

    title = safe_get(backblast_data, actions.BACKBLAST_TITLE)
    the_date = safe_get(backblast_data, actions.BACKBLAST_DATE) or date
    the_q = safe_get(backblast_data, actions.BACKBLAST_Q)
    the_coq = safe_get(backblast_data, actions.BACKBLAST_COQ)
    pax = safe_get(backblast_data, actions.BACKBLAST_PAX)
    dr_pax = [int(id) for id in (safe_get(backblast_data, actions.USER_OPTION_LOAD) or [])]
    non_slack_pax = safe_get(backblast_data, actions.BACKBLAST_NONSLACK_PAX)
    fngs = safe_get(backblast_data, actions.BACKBLAST_FNGS)
    count = safe_get(backblast_data, actions.BACKBLAST_COUNT)
    moleskin = fix_from_llm_tags(safe_get(backblast_data, actions.BACKBLAST_MOLESKIN))
    email_send = safe_get(backblast_data, actions.BACKBLAST_EMAIL_SEND)
    send_options = safe_get(backblast_data, actions.BACKBLAST_SEND_OPTIONS)
    # ao = safe_get(backblast_data, actions.BACKBLAST_AO)
    event_type = safe_convert(safe_get(backblast_data, actions.BACKBLAST_EVENT_TYPE), int) or event_type
    location_id = safe_convert(safe_get(backblast_data, actions.BACKBLAST_LOCATION), int) or safe_get(
        event, "location_id"
    )
    files = safe_get(backblast_data, actions.BACKBLAST_FILE) or []
    file_ids = safe_get(backblast_data, "file_ids") or []
    selected_options = safe_get(backblast_data, actions.BACKBLAST_OPTIONS) or []

    user_id = safe_get(body, "user_id") or safe_get(body, "user", "id")
    if files:
        file_list, file_send_list, file_ids, low_rez_file_list = upload_files_to_storage(
            files=files,
            logger=logger,
            client=client,
            bucket_name="event_instance_images",
            file_name=str(event_instance_id) if event_instance_id else None,
        )
    elif safe_get(metadata, actions.BACKBLAST_FILE, 0):
        file_list = safe_get(metadata, actions.BACKBLAST_FILE)
        file_send_list = []
        file_ids = safe_get(metadata, "file_ids")
        low_rez_file_list = safe_get(metadata, actions.BACKBLAST_FILE + "_low_rez")
    else:
        file_list = []
        file_send_list = []
        file_ids = []
        low_rez_file_list = []

    if (
        region_record.default_backblast_destination == constants.CONFIG_DESTINATION_SPECIFIED["value"]
        and region_record.backblast_destination_channel
    ):
        destination_channel = region_record.backblast_destination_channel
    else:
        destination_channel = safe_get(event_org.meta, "slack_channel_id")

    if create_or_edit == "edit":
        message_channel = safe_get(metadata, "channel_id")
        message_ts = safe_get(metadata, "message_ts")
        file_list = safe_get(metadata, "files") if not file_list else file_list
        file_ids = safe_get(metadata, "file_ids") if not file_ids else file_ids
    else:
        message_channel = None
        message_ts = None

    all_pax = list(set([the_q] + (the_coq or []) + pax))
    db_users: List[SlackUser] = [get_user(p, region_record, client, logger) for p in all_pax]
    db_ids = []
    db_users_deduped = []
    for u in db_users:
        if u.user_id not in db_ids:
            db_users_deduped.append(u)
            db_ids.append(u.user_id)
    db_users = db_users_deduped
    auto_count = len(all_pax)
    pax_names_list = [user.user_name for user in db_users]

    pax_formatted = get_pax(pax)
    pax_full_list = [pax_formatted]
    fngs_formatted = fngs
    fng_count = 0
    if dr_pax:
        dr_pax_users = DbManager.find_records(
            User,
            [User.id.in_(dr_pax)],
            joinedloads=[User.home_region_org],
        )
        dr_pax_names = []
        for u in dr_pax_users:
            if u.id not in db_ids:
                db_users.append(SlackUser(user_id=u.id, slack_id=u.id, user_name=u.f3_name))
                db_ids.append(u.id)
            if u.home_region_org:
                dr_pax_names.append(f"{u.f3_name} ({u.home_region_org.name})")
            else:
                dr_pax_names.append(u.f3_name)
        dr_pax_names = [u.f3_name for u in dr_pax_users]
        dr_pax_names = ", ".join(dr_pax_names)
        pax_full_list.append(dr_pax_names)
        pax_names_list.append(dr_pax_names)
        auto_count += len(dr_pax_names.split(","))
    if non_slack_pax:
        pax_full_list.append(non_slack_pax)
        pax_names_list.append(non_slack_pax)
        auto_count += non_slack_pax.count(",") + 1
    if fngs:
        pax_full_list.append(fngs)
        pax_names_list.append(fngs)
        fng_count = fngs.count(",") + 1
        fngs_formatted = str(fng_count) + " " + fngs
        auto_count += fngs.count(",") + 1
    pax_formatted = ", ".join(pax_full_list)
    pax_names = ", ".join(pax_names_list)

    if the_coq is None:
        the_coqs_formatted = ""
        the_coqs_names = ""
    else:
        the_coqs_formatted = get_pax(the_coq)
        the_coqs_full_list = [the_coqs_formatted]
        the_coqs_users = [get_user(c, region_record, client, logger) for c in the_coq]
        the_coqs_names_list = [user.user_name for user in the_coqs_users]
        the_coqs_formatted = ", " + ", ".join(the_coqs_full_list)
        the_coqs_names = ", " + ", ".join(the_coqs_names_list)

    # ao_name = get_channel_names([the_ao], logger, client)[0]
    q_user = get_user(the_q, region_record, client, logger)
    q_name = q_user.user_name
    q_url = q_user.avatar_url
    count = count or auto_count

    post_msg = f"""*Backblast! {title}*
*DATE*: {the_date}
*AO*: {event_org.name}
*Q*: <@{the_q}>{the_coqs_formatted}
*PAX*: {pax_formatted}
*FNGs*: {fngs_formatted}
*COUNT*: {count}"""

    custom_fields = {}
    for field, value in backblast_data.items():
        if (field[: len(actions.CUSTOM_FIELD_PREFIX)] == actions.CUSTOM_FIELD_PREFIX) and value:
            post_msg += f"\n*{field[len(actions.CUSTOM_FIELD_PREFIX) :]}*: {str(value)}"
            custom_fields[field[len(actions.CUSTOM_FIELD_PREFIX) :]] = value

    if file_list:
        custom_fields["files"] = file_list
        custom_fields["file_ids"] = file_ids

    if selected_options:
        for option in selected_options:
            custom_fields[option] = True

    msg_block = slack_orm.SectionBlock(label=post_msg)

    backblast_data.pop(actions.BACKBLAST_MOLESKIN, None)
    backblast_data.pop(actions.BACKBLAST_PAX, None)
    backblast_data[actions.BACKBLAST_FILE] = file_list
    backblast_data[actions.BACKBLAST_FILE + "_low_rez"] = low_rez_file_list
    backblast_data["file_ids"] = file_ids
    backblast_data[actions.BACKBLAST_OP] = user_id
    backblast_data["event_instance_id"] = event_instance_id

    if not event_instance_id:
        event_instance = DbManager.create_record(
            EventInstance(start_date=the_date, org_id=event_org.id, name=title, location_id=location_id)
        )
        event_instance_id = event_instance.id
        DbManager.create_record(
            Attendance(
                event_instance_id=event_instance_id,
                user_id=q_user.user_id,
                attendance_x_attendance_types=[Attendance_x_AttendanceType(attendance_type_id=2)],  # assign as Q
                is_planned=True,
            )
        )
        DbManager.create_record(
            EventType_x_EventInstance(event_instance_id=event_instance_id, event_type_id=event_type)
        )
        backblast_data["event_instance_id"] = event_instance_id

    edit_block = slack_orm.ActionsBlock(
        elements=[
            slack_orm.ButtonElement(
                label=":pencil: Edit this backblast",
                action=actions.BACKBLAST_EDIT_BUTTON,
                value=json.dumps(backblast_data),
            ),
            slack_orm.ButtonElement(
                label=":heavy_plus_sign: New backblast",
                action=actions.BACKBLAST_NEW_BUTTON,
                value="new",
            ),
        ]
    )

    if region_record.strava_enabled:
        edit_block.elements.append(
            slack_orm.ButtonElement(
                label=":runner: Connect to Strava",
                action=actions.BACKBLAST_STRAVA_BUTTON,
                value="strava",
            )
        )

    blocks = [msg_block.as_form_field(), moleskin]
    for url in low_rez_file_list or []:
        blocks.append(
            slack_orm.ImageBlock(
                alt_text=title,
                image_url=url,
            ).as_form_field()
        )
    blocks.append(edit_block.as_form_field())
    if "exclude_from_pax_vault" in selected_options:
        blocks.append(
            slack_orm.ContextBlock(
                element=slack_orm.ContextElement(
                    initial_value="*Note: stats from this event will not be reflected in the PAX Vault.*"
                )
            ).as_form_field()
        )

    moleskin_text = parse_rich_block(moleskin)
    moleskin_text_w_names = replace_user_channel_ids(
        moleskin_text, region_record, client, logger
    )  # check this for efficiency
    moleskin_w_names = replace_rich_text_user_channel(moleskin, region_record, client, logger)

    # Handle "Save and send later" option - save to DB but don't post to Slack
    if create_or_edit == "create" and send_options == "Save and send later":
        backblast_parsed = f"""Backblast! {title}
Date: {the_date}
AO: {event_org.name}
Q: {q_name} {the_coqs_names}
PAX: {pax_names}
FNGs: {fngs_formatted}
COUNT: {count}
{moleskin_text_w_names}
"""
        db_fields = {
            EventInstance.start_date: the_date,
            EventInstance.org_id: event_org.id,
            EventInstance.backblast_ts: None,  # Not posted yet
            EventInstance.backblast: backblast_parsed,
            EventInstance.backblast_rich: [msg_block.as_form_field(), moleskin],
            EventInstance.name: title,
            EventInstance.pax_count: count,
            EventInstance.fng_count: fng_count,
            EventInstance.meta: custom_fields,
            EventInstance.is_active: True,
        }
        DbManager.update_record(EventInstance, event_instance_id, fields=db_fields)
        DbManager.update_records(
            EventType_x_EventInstance,
            [EventType_x_EventInstance.event_instance_id == event_instance_id],
            fields={EventType_x_EventInstance.event_type_id: event_type},
        )

        attendance_types = [2 if u.slack_id == the_q else 3 if u.slack_id in (the_coq or []) else 1 for u in db_users]
        attendance_records = [
            Attendance(
                event_instance_id=event_instance_id,
                user_id=user.user_id,
                attendance_x_attendance_types=[Attendance_x_AttendanceType(attendance_type_id=attendance_type)],
                is_planned=False,
            )
            for user, attendance_type in zip(db_users, attendance_types, strict=False)
        ]
        DbManager.create_records(attendance_records)

        # Notify user that backblast was saved but not posted
        client.chat_postMessage(
            channel=user_id,
            text=f"Your backblast for *{title}* has been saved but not posted yet. "
            f"To post it later, use the /backblast command and select the event from your recent Qs.",
        )
        return

    if create_or_edit == "create":
        text = (f"{moleskin_text_w_names}\n\nUse the 'New Backblast' button to create a new backblast")[:1500]
        if destination_channel:
            res = client.chat_postMessage(
                channel=destination_channel,
                text=text,
                username=f"{q_name} (via F3 Nation)",
                icon_url=q_url,
                blocks=blocks,
                metadata={"event_type": "backblast", "event_payload": backblast_data},
            )
            action_text = "posted"
        else:
            res = client.chat_postMessage(
                channel=user_id,
                text="Your backblast has been saved to the database but a Slack channel has not been configured for your AO, so it cannot be posted to Slack. The Slack channel can be set by an admin in `/f3-nation-settings` -> Calendar Settings -> Manage AOs.",  # noqa: E501
            )
            action_text = "saved (no channel)"
        if (email_send and email_send == "yes") or (email_send is None and region_record.email_enabled == 1):
            moleskin_msg = moleskin_text_w_names

            if region_record.postie_format:
                subject = f"[{event_org.name}] {title}"
                moleskin_msg += f"\n\nTags: {event_org.name}, {pax_names}"
            else:
                subject = title

            email_msg = f"""Date: {the_date}
AO: {event_org.name}
Q: {q_name} {the_coqs_names}
PAX: {pax_names}
FNGs: {fngs_formatted}
COUNT: {count}
{moleskin_msg}
            """
            try:
                # Decrypt password
                fernet = Fernet(os.environ[constants.PASSWORD_ENCRYPT_KEY].encode())
                email_password_decrypted = fernet.decrypt(region_record.email_password.encode()).decode()
                sendmail.send(
                    subject=subject,
                    body=email_msg,
                    email_server=region_record.email_server,
                    email_server_port=region_record.email_server_port,
                    email_user=region_record.email_user,
                    email_password=email_password_decrypted,
                    email_to=region_record.email_to,
                    attachments=file_send_list,
                )
                logger.debug("\nEmail Sent! \n{}".format(email_msg))
            except Exception as sendmail_err:
                logger.error("Error with sendmail: {}".format(sendmail_err))
                logger.debug("\nEmail Sent! \n{}".format(email_msg))

    elif create_or_edit == "edit":
        text = (f"{moleskin_text_w_names}\n\nUse the 'New Backblast' button to create a new backblast")[:1500]
        try:
            res = client.chat_update(
                channel=message_channel,
                ts=message_ts,
                text=text,
                username=f"{q_name} (via F3 Nation)",
                icon_url=q_url,
                blocks=blocks,
                metadata={"event_type": "backblast", "event_payload": backblast_data},
            )
            logger.debug("\nBackblast updated in Slack! \n{}".format(post_msg))
        except Exception as e:
            logger.warning(f"Error updating backblast message in Slack, posting a new one: {e}")
            res = client.chat_postMessage(
                channel=destination_channel,
                text=text,
                username=f"{q_name} (via F3 Nation)",
                icon_url=q_url,
                blocks=blocks,
                metadata={"event_type": "backblast", "event_payload": backblast_data},
            )
        action_text = "edited"
    log_msg = f":page_facing_up: Backblast {action_text} for *{title}* on *{the_date}* by <@{slack_user_id or 'app'}>"
    if res and res.get("channel") and res.get("ts"):
        log_msg += f" <slack://channel?team={region_record.team_id}&id={res['channel']}&ts={res['ts']}|Link>\n"
    post_bot_log(
        client=client,
        region_record=region_record,
        text=log_msg,  # noqa: E501
        logger=logger,
    )

    # res_link = client.chat_getPermalink(channel=chan or message_channel, message_ts=res["ts"])

    backblast_parsed = f"""Backblast! {title}
Date: {the_date}
AO: {event_org.name}
Q: {q_name} {the_coqs_names}
PAX: {pax_names}
FNGs: {fngs_formatted}
COUNT: {count}
{moleskin_text_w_names}
"""
    rich_blocks: list = res["message"]["blocks"]
    rich_blocks.pop(-1)

    db_fields = {
        EventInstance.start_date: the_date,
        EventInstance.org_id: event_org.id,
        EventInstance.backblast_ts: res["ts"],
        EventInstance.backblast: backblast_parsed,
        EventInstance.backblast_rich: res["message"]["blocks"],
        EventInstance.name: title,
        EventInstance.pax_count: count,
        EventInstance.fng_count: fng_count,
        EventInstance.meta: custom_fields,
        EventInstance.location_id: location_id,
        EventInstance.is_active: True,
    }
    event: EventInstance = DbManager.get(EventInstance, event_instance_id, joinedloads="all")
    DbManager.update_record(EventInstance, event_instance_id, fields=db_fields)
    DbManager.update_records(
        EventType_x_EventInstance,
        [EventType_x_EventInstance.event_instance_id == event_instance_id],
        fields={EventType_x_EventInstance.event_type_id: event_type},
    )  # TODO: handle multiple event types

    attendance_types = [2 if u.slack_id == the_q else 3 if u.slack_id in (the_coq or []) else 1 for u in db_users]
    attendance_records = [
        Attendance(
            event_instance_id=event_instance_id,
            user_id=user.user_id,
            attendance_x_attendance_types=[Attendance_x_AttendanceType(attendance_type_id=attendance_type)],
            is_planned=False,
        )
        for user, attendance_type in zip(db_users, attendance_types, strict=False)
    ]

    DbManager.delete_records(
        Attendance,
        filters=[Attendance.event_instance_id == event_instance_id, not_(Attendance.is_planned)],
    )
    DbManager.create_records(attendance_records)

    # ── Downrange cross-posting ────────────────────────────────────────────────
    # Find PAX who have a home region different from the current region and cross-post
    # backblasts to those regions if they have cross-posting enabled.
    cross_post_msg = f""":airplane: *Downrange! {title}*
*DATE*: {the_date}
*REGION*: {region_record.workspace_name or event_org.name}
*AO*: {event_org.name}
*Q*: {q_name}{the_coqs_names}
*PAX*: {pax_names}
*FNGs*: {fngs_formatted}
*COUNT*: {count}"""
    for field, value in custom_fields.items():
        if field not in ("files", "file_ids", "downrange_posts") and not field.endswith("_low_rez") and value:
            cross_post_msg += f"\n*{field}*: {str(value)}"

    all_user_ids = [u.user_id for u in db_users if u.user_id]
    if all_user_ids:
        pax_user_records = DbManager.find_records(
            User,
            [User.id.in_(all_user_ids), User.home_region_id.isnot(None)],
        )
        foreign_region_ids = {
            u.home_region_id for u in pax_user_records if u.home_region_id and u.home_region_id != region_record.org_id
        }
        foreign_user_names: Dict[int, List[str]] = defaultdict(list)  # region_id -> list of f3_names
        for u in pax_user_records:
            if u.home_region_id and u.home_region_id != region_record.org_id:
                foreign_user_names[u.home_region_id].append(u.f3_name)

        existing_dr_posts = safe_get(event.meta if event else {}, "downrange_posts") or []
        existing_by_team = {p["team_id"]: p for p in existing_dr_posts}
        new_dr_posts = list(existing_by_team.values())  # preserve existing; updated in-place below

        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = ssl.CERT_NONE

        for home_region_id in foreign_region_ids:
            ox = DbManager.find_first_record(Org_x_SlackSpace, [Org_x_SlackSpace.org_id == home_region_id])
            if not ox:
                continue
            dr_slack_space = DbManager.get(SlackSpace, ox.slack_space_id)
            if not dr_slack_space or not dr_slack_space.bot_token:
                continue

            dr_settings = REGION_RECORDS.get(dr_slack_space.team_id)
            if not dr_settings and dr_slack_space.settings:
                try:
                    dr_settings = SlackSettings(**dr_slack_space.settings)
                except Exception:
                    continue

            if not dr_settings:
                continue
            if dr_settings.downrange_channel_posting != "enabled" or not dr_settings.downrange_channel:
                continue

            cross_blocks = [
                slack_orm.SectionBlock(label=cross_post_msg).as_form_field(),
                moleskin_w_names,
            ]

            for url in low_rez_file_list or []:
                cross_blocks.append(
                    slack_orm.ImageBlock(
                        alt_text=title,
                        image_url=url,
                    ).as_form_field()
                )

            cross_blocks.append(
                slack_orm.ContextBlock(
                    element=slack_orm.ContextElement(
                        initial_value=f"Cross-posted from *{event_org.name}* for PAX: {', '.join(foreign_user_names.get(home_region_id) or [])}"  # noqa: E501
                    )
                ).as_form_field()
            )

            try:
                dr_client = WebClient(token=dr_slack_space.bot_token, ssl=ssl_ctx)
                existing_post = existing_by_team.get(dr_slack_space.team_id)

                if create_or_edit == "edit" and existing_post:
                    dr_client.chat_update(
                        channel=existing_post["channel"],
                        ts=existing_post["ts"],
                        text=cross_post_msg[:1500],
                        username=f"{q_name} (via F3 Nation)",
                        icon_url=q_url,
                        blocks=cross_blocks,
                    )
                else:
                    dr_res = dr_client.chat_postMessage(
                        channel=dr_settings.downrange_channel,
                        text=cross_post_msg[:1500],
                        username=f"{q_name} (via F3 Nation)",
                        icon_url=q_url,
                        blocks=cross_blocks,
                    )
                    new_post_entry = {
                        "team_id": dr_slack_space.team_id,
                        "channel": dr_settings.downrange_channel,
                        "ts": dr_res["ts"],
                    }
                    idx = next((i for i, p in enumerate(new_dr_posts) if p["team_id"] == dr_slack_space.team_id), None)
                    if idx is not None:
                        new_dr_posts[idx] = new_post_entry
                    else:
                        new_dr_posts.append(new_post_entry)
            except Exception as e:
                logger.warning(f"Downrange cross-post failed for team {dr_slack_space.team_id}: {e}")
                time.sleep(1)

        if new_dr_posts:
            updated_meta = dict(custom_fields)
            updated_meta["downrange_posts"] = new_dr_posts
            DbManager.update_record(EventInstance, event_instance_id, fields={EventInstance.meta: updated_meta})


def handle_backblast_edit_button(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    user_id = safe_get(body, "user_id") or safe_get(body, "user", "id")
    # channel_id = safe_get(body, "channel_id") or safe_get(body, "channel", "id")

    if constants.ALL_USERS_ARE_ADMINS:
        user_is_admin = True
    else:
        slack_user = get_user(user_id, region_record, client, logger)
        admin_users = get_admin_users(region_record.org_id, region_record.team_id)
        user_is_admin = any(u[0].id == slack_user.user_id for u in admin_users)

    backblast_data = safe_get(body, "message", "metadata", "event_payload") or json.loads(
        safe_get(body, "actions", 0, "value") or "{}"
    )
    if region_record.editing_locked == 1:
        allow_edit: bool = (
            user_is_admin
            or (user_id == backblast_data[actions.BACKBLAST_Q])
            or (user_id in (safe_get(backblast_data, actions.BACKBLAST_COQ) or []))
            or (user_id in backblast_data[actions.BACKBLAST_OP])
        )
    else:
        allow_edit = True

    if allow_edit:
        build_backblast_form(
            body=body,
            client=client,
            logger=logger,
            context=context,
            region_record=region_record,
        )
    else:
        form = slack_orm.BlockView(
            blocks=[
                slack_orm.SectionBlock(
                    label="Editing this backblast is only allowed for the Q(s), the original poster, or your local region admins.",  # noqa
                )
            ]
        )
        form.update_modal(
            client=client,
            view_id=safe_get(body, actions.LOADING_ID),
            callback_id=actions.BACKBLAST_EDIT_CALLBACK_ID,
            title_text="Backblast Edit",
            submit_button_text="None",
        )


def handle_legacy_edit_button(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    form = slack_orm.BlockView(
        blocks=[
            slack_orm.SectionBlock(
                label="This backblast was created before migration to F3 Nation. To edit the backblast or attendance details, have an admin go to the calendar, use the start date filter to go back, and hit 'Edit Backblast' on the appropriate event.",  # noqa
            ),
            slack_orm.ActionsBlock(
                elements=[
                    slack_orm.ButtonElement(
                        label="Open Calendar",
                        action=actions.OPEN_CALENDAR_BUTTON,
                    ),
                ]
            ),
        ]
    )
    form.update_modal(
        client=client,
        view_id=safe_get(body, actions.LOADING_ID),
        callback_id=actions.BACKBLAST_EDIT_CALLBACK_ID,
        title_text="Legacy Backblast",
        submit_button_text="None",
    )
