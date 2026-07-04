import os
import ssl
import sys
from logging import Logger

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from datetime import date, datetime, timedelta
from typing import Dict, List

import pytz
from f3_data_models.models import (
    Attendance,
    Attendance_x_AttendanceType,
    EventInstance,
    Org,
    Series_Exception,
    SlackSpace,
)
from f3_data_models.utils import DbManager
from slack_sdk import WebClient
from slack_sdk.models.metadata import Metadata
from sqlalchemy import or_

from scripts.preblast_reminders import PreblastItem, PreblastList
from utilities.database.orm import SlackSettings
from utilities.helper_functions import (
    current_date_cst,
    get_user,
    safe_convert,
    safe_get,
)
from utilities.slack import actions
from utilities.slack.orm import (
    ActionsBlock,
    BaseBlock,
    ButtonElement,
    DividerBlock,
    ImageBlock,
    SectionBlock,
)


def send_lineups(force: bool = False):
    # get the current time in US/Central timezone
    current_time = datetime.now(pytz.timezone("US/Central"))
    slack_spaces = DbManager.find_records(SlackSpace, filters=[True])
    slack_settings_list: List[SlackSettings] = [
        SlackSettings(**s.settings) for s in slack_spaces if safe_get(s.settings, "org_id")
    ]

    # find all slack settings where send_q_lineups is True and the current time matches the configured day and hour
    include_region_orgs = {
        r.org_id: r
        for r in slack_settings_list
        if r.send_q_lineups
        and (
            (
                (r.send_q_lineups_day or 6) == current_time.weekday()
                and (r.send_q_lineups_hour_cst or 17) == current_time.hour
            )
            or force
        )
    }

    if include_region_orgs:
        # Figure out current and next weeks based on current start of day
        # I have the week start on Monday and end on Sunday - if this is run on Sunday, "current" week will start tomorrow # noqa
        current_date = current_date_cst()
        start_of_next_week = current_date + timedelta(days=7 - current_date.weekday())
        end_of_next_week = start_of_next_week + timedelta(days=6)
        event_list = PreblastList()
        event_list.pull_data(
            filters=[
                EventInstance.start_date >= start_of_next_week,
                EventInstance.start_date <= end_of_next_week,
                EventInstance.is_active,  # not canceled
                or_(Org.id.in_(include_region_orgs), Org.parent_id.in_(include_region_orgs)),
                # may want to filter out pre-events?
            ]
        )

        # Build the event organization list
        event_org_list: Dict[int, List[PreblastItem]] = {}
        for event in event_list.items:
            event_org_list.setdefault(event.org.id, []).append(event)

        for region_id, slack_settings in include_region_orgs.items():
            if slack_settings.send_q_lineups_method == "yes_per_ao":
                # Send per AO
                for org_id in event_org_list:
                    org_events = event_org_list[org_id]
                    org_record = org_events[0].org
                    if org_record.parent_id == region_id:
                        blocks = [
                            SectionBlock(
                                label=f"*Hello HIMs of {org_record.name}! Here is your Q lineup for the week*"
                            ).as_form_field(),
                            DividerBlock().as_form_field(),
                        ]
                        blocks.extend(build_lineup_blocks(org_events, org_record))
                        try:
                            send_q_lineup_message(
                                org_record,
                                blocks,
                                slack_settings,
                                start_of_next_week,
                                end_of_next_week,
                            )
                        except Exception:
                            print(f"Error sending Q lineup for AO {org_record.name} ({org_record.id})")
                            continue
            elif slack_settings.send_q_lineups_method == "yes_for_all":
                # Send combined for region
                region_record = DbManager.get(Org, region_id)
                blocks: List[dict] = [
                    SectionBlock(
                        label=f"*Hello HIMs of {region_record.name}! Here are your Q lineups for the week*\n\n"
                    ).as_form_field()
                ]
                for org_id in event_org_list:
                    org_events = event_org_list[org_id]
                    org_record = org_events[0].org
                    if org_record.parent_id == region_id:
                        blocks.extend(
                            [
                                SectionBlock(label=f"*{org_record.name}:*").as_form_field(),
                                DividerBlock().as_form_field(),
                            ]
                        )
                        blocks.extend(build_lineup_blocks(org_events, org_record))
                try:
                    send_q_lineup_message(
                        region_record,
                        blocks,
                        slack_settings,
                        start_of_next_week,
                        end_of_next_week,
                    )
                except Exception as e:
                    print(f"Error sending Q lineup for region {region_record.name} ({region_record.id}): {e}")
                    continue


def build_lineup_blocks(org_events: List[PreblastItem], org: Org) -> List[dict]:
    org_events.sort(
        key=lambda x: (
            x.event.start_date
            + timedelta(hours=safe_convert(x.event.start_time[:2] if x.event.start_time else "0", int))
        )
    )
    blocks: List[BaseBlock] = []

    for event in org_events:
        if event.event.series_exception == Series_Exception.closed:
            label = f"*{event.event.start_date.strftime('%A, %m/%d')}*\n{event.event_type.name} {event.event.start_time}\n*CLOSED.*"  # noqa
            accessory = None
        if event.q_name:
            q_label = f"@{event.q_name}"  # f"<@{event.slack_user_id}>" if event.slack_user_id else
            label = f"*{event.event.start_date.strftime('%A, %m/%d')}*\n{event.event_type.name} {event.event.start_time}\n{q_label}"  # noqa
            image_url = (
                event.slack_avatar_url
                or event.q_avatar_url
                or "https://www.publicdomainpictures.net/pictures/40000/t2/question-mark.jpg"
            )
            accessory = ImageBlock(
                image_url=image_url,
                alt_text="Q Lineup",
            )
        else:
            label = f"*{event.event.start_date.strftime('%A, %m/%d')}*\n{event.event_type.name} {event.event.start_time}\n*OPEN!*"  # noqa
            # image_url = "https://www.publicdomainpictures.net/pictures/40000/t2/question-mark.jpg"
            accessory = ButtonElement(
                label=":calendar: Sign Up to Lead!",
                action=f"{actions.LINEUP_SIGNUP_BUTTON}_{event.event.id}",
                value=str(event.event.id),
                style="primary",
            )
        blocks.append(
            SectionBlock(
                label=label,
                element=accessory,
            )
        )
    # blocks.append(
    #     ActionsBlock(
    #         elements=[
    #             ButtonElement(
    #                 label=":calendar: Open Calendar",
    #                 action=actions.OPEN_CALENDAR_MSG_BUTTON,
    #             )
    #         ]
    #     )
    # )
    return [b.as_form_field() for b in blocks]


HEADER_BLOCKS: List[BaseBlock] = [
    SectionBlock(label="Here is your Q lineup for the week\n\n*Weekly Q Lineup:*"),
    DividerBlock(),
]


def send_q_lineup_message(
    org: Org,
    blocks: List[dict],
    slack_settings: SlackSettings,
    week_start: date = None,
    week_end: date = None,
    update_channel_id: str = None,
    update_ts: str = None,
):
    calendar_button_block = ActionsBlock(
        elements=[
            ButtonElement(
                label=":calendar: Open Calendar",
                action=actions.OPEN_CALENDAR_MSG_BUTTON,
            )
        ]
    ).as_form_field()
    blocks.append(calendar_button_block)

    slack_bot_token = slack_settings.bot_token
    metadata = Metadata(
        event_type="q_lineup", event_payload={"send_q_lineups_method": slack_settings.send_q_lineups_method}
    )
    if week_start and week_end:
        metadata.event_payload["week_start"] = week_start.strftime("%y-%m-%d")
        metadata.event_payload["week_end"] = week_end.strftime("%y-%m-%d")
    if slack_bot_token:
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        slack_client = WebClient(slack_bot_token, ssl=ssl_context)
        if update_channel_id:
            channel_id = update_channel_id
        if slack_settings.send_q_lineups_method == "yes_per_ao" and safe_get(org.meta, "slack_channel_id"):
            channel_id = org.meta.get("slack_channel_id")
        elif slack_settings.send_q_lineups_method == "yes_for_all" and slack_settings.send_q_lineups_channel:
            channel_id = slack_settings.send_q_lineups_channel
        else:
            channel_id = None
        for attempt in range(2):
            try:
                if channel_id:
                    if update_channel_id and update_ts:
                        # Update the existing message
                        slack_client.chat_update(
                            channel=channel_id,
                            ts=update_ts,
                            text="Q Lineup",
                            blocks=blocks,
                            metadata=metadata,
                        )
                    else:
                        resp = slack_client.chat_postMessage(
                            channel=channel_id,
                            text="Q Lineup",
                            blocks=blocks,
                            metadata=metadata,
                        )
                        org.meta = org.meta or {}
                        org.meta["q_lineup_ts"] = resp["ts"]
                        DbManager.update_record(Org, org.id, {Org.meta: org.meta})
                break  # successfully sent, break out of retry loop
            except Exception as e:
                if channel_id and attempt == 0:
                    print(f"Error sending message to channel {channel_id}, trying to join channel and resend: {e}")
                    slack_client.conversations_join(channel=channel_id)
                else:
                    print(f"Error sending Q lineup message for org {org.name} ({org.id}): {e}")
                    break  # ran out of tries, break out of retry loop


def handle_lineup_signup(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    event_instance_id = int(body["actions"][0]["value"])
    slack_user_id = body["user"]["id"]
    slack_channel_id = body["channel"]["id"]
    user_id = get_user(slack_user_id, region_record, client, logger).user_id

    metadata = safe_get(body, "message", "metadata", "event_payload")
    week_start = safe_get(metadata, "week_start")
    week_end = safe_get(metadata, "week_end")
    send_q_lineup_method = safe_get(metadata, "send_q_lineups_method")
    if week_start and week_end:
        this_week_start = datetime.strptime(week_start, "%y-%m-%d").date()
        this_week_end = datetime.strptime(week_end, "%y-%m-%d").date()
    else:
        # Default to the current week
        tomorrow_day_of_week = (current_date_cst() + timedelta(days=1)).weekday()
        this_week_start = current_date_cst() + timedelta(days=-tomorrow_day_of_week)
        this_week_end = current_date_cst() + timedelta(days=7 - tomorrow_day_of_week)

    preblast_info = PreblastList()
    preblast_info.pull_data(filters=[EventInstance.id == event_instance_id])
    event_info: PreblastItem = safe_get(preblast_info.items, 0)
    # Check if a user is already signed up for the event
    attendance_record = DbManager.find_records(
        Attendance,
        filters=[Attendance.event_instance_id == event_instance_id, Attendance.user_id == user_id],
        joinedloads=[Attendance.attendance_x_attendance_types],
    )
    if event_info.q_name:
        client.chat_postEphemeral(
            user=slack_user_id,
            channel=slack_channel_id,
            text=f"Sorry, {event_info.q_name} already signed up for this event.",
        )
    else:
        if attendance_record:
            if 2 not in attendance_record[0].attendance_x_attendance_types:
                DbManager.create_record(
                    Attendance_x_AttendanceType(attendance_id=attendance_record[0].id, attendance_type_id=2)
                )
        else:
            DbManager.create_record(
                Attendance(
                    event_instance_id=event_instance_id,
                    user_id=user_id,
                    attendance_x_attendance_types=[Attendance_x_AttendanceType(attendance_type_id=2)],
                    is_planned=True,
                )
            )
    # Update the Q Lineup
    if send_q_lineup_method == "yes_per_ao":
        org_info = PreblastList()
        org_info.pull_data(
            filters=[
                EventInstance.org_id == event_info.org.id,
                EventInstance.start_date >= this_week_start,
                EventInstance.start_date <= this_week_end,
                EventInstance.is_active,
            ],
        )
        blocks = build_lineup_blocks(org_info.items, event_info.org)
        send_q_lineup_message(
            event_info.org,
            blocks,
            region_record,
            week_start=this_week_start,
            week_end=this_week_end,
            update_channel_id=slack_channel_id,
            update_ts=body["message"]["ts"],
        )
    elif send_q_lineup_method == "yes_for_all":
        org_info = PreblastList()
        org_info.pull_data(
            filters=[
                Org.parent_id == event_info.org.parent_id,
                EventInstance.start_date >= this_week_start,
                EventInstance.start_date <= this_week_end,
                EventInstance.is_active,
            ],
        )
        blocks = [
            SectionBlock(label="*Here are your Q lineups for the week*\n\n").as_form_field(),
        ]
        for org in {e.org for e in org_info.items}:
            blocks.append(DividerBlock().as_form_field())
            blocks.append(SectionBlock(label=f"*{org.name}:*").as_form_field())
            events = [e for e in org_info.items if e.org.id == org.id]
            blocks.extend(build_lineup_blocks(events, org))
        send_q_lineup_message(
            event_info.org,
            blocks,
            region_record,
            week_start=this_week_start,
            week_end=this_week_end,
            update_channel_id=slack_channel_id,
            update_ts=body["message"]["ts"],
        )


if __name__ == "__main__":
    send_lineups(force=True)
