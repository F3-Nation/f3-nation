import os
import ssl
import sys
from datetime import datetime, timedelta
from logging import Logger

import pytz
from f3_data_models.utils import DbManager

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from dataclasses import dataclass, field
from typing import List

from f3_data_models.models import (
    Attendance,
    Attendance_x_AttendanceType,
    EventInstance,
    EventType,
    EventType_x_EventInstance,
    Org,
    Org_x_SlackSpace,
    Series_Exception,
    SlackSpace,
    SlackUser,
    User,
)
from f3_data_models.utils import get_session
from slack_sdk.web import WebClient
from sqlalchemy import and_, func, select
from sqlalchemy.orm import aliased

from utilities.database.orm import SlackSettings
from utilities.helper_functions import current_date_cst, safe_get
from utilities.slack import actions, orm

MSG_TEMPLATE = "Hey there, {q_name}! I hope that the {event_name} on {event_date} at {event_ao} went well! I have not seen a backblast posted for this event yet... Please click the button below to fill out the backblast so we can track those stats!"  # noqa


@dataclass
class BackblastItem:
    event: EventInstance
    event_type: EventType
    org: Org
    parent_org: Org
    q_name: str
    slack_user_id: str
    slack_settings: SlackSettings


@dataclass
class BackblastList:
    items: List[BackblastItem] = field(default_factory=list)

    def pull_data(self):
        session = get_session()
        ParentOrg = aliased(Org)

        firstq_subquery = (
            select(
                Attendance.event_instance_id,
                Attendance.user_id,
                func.row_number()
                .over(partition_by=Attendance.event_instance_id, order_by=Attendance.created)
                .label("rn"),
            )
            .select_from(Attendance)
            .join(Attendance_x_AttendanceType, Attendance.id == Attendance_x_AttendanceType.attendance_id)
            .filter(Attendance_x_AttendanceType.attendance_type_id == 2)
            .alias()
        )

        query = (
            session.query(
                EventInstance,
                EventType,
                Org,
                ParentOrg,
                User.f3_name.label("q_name"),
                SlackUser.slack_id,
                SlackSpace.settings,
            )
            .select_from(EventInstance)
            .join(Org, Org.id == EventInstance.org_id)
            .join(EventType_x_EventInstance, EventType_x_EventInstance.event_instance_id == EventInstance.id)
            .join(EventType, EventType.id == EventType_x_EventInstance.event_type_id)
            .join(ParentOrg, Org.parent_id == ParentOrg.id)
            .join(Org_x_SlackSpace, Org_x_SlackSpace.org_id == ParentOrg.id)
            .join(SlackSpace, Org_x_SlackSpace.slack_space_id == SlackSpace.id)
            .join(
                firstq_subquery,
                and_(
                    EventInstance.id == firstq_subquery.c.event_instance_id,
                    firstq_subquery.c.rn == 1,
                ),
            )
            .outerjoin(User, User.id == firstq_subquery.c.user_id)
            .outerjoin(SlackUser, and_(User.id == SlackUser.user_id, SlackUser.slack_team_id == SlackSpace.team_id))
            .filter(
                EventInstance.start_date < current_date_cst(),  # + timedelta(days=1),  # eventually configurable
                EventInstance.start_date >= (current_date_cst() - timedelta(days=5)),  # eventually configurable
                EventInstance.backblast_ts.is_(None),  # not already sent
                EventInstance.is_active,  # not canceled
            )
            .order_by(ParentOrg.name, Org.name, EventInstance.start_time)
        )
        records = query.all()
        session.expunge_all()
        self.items = [
            BackblastItem(
                event=r[0],
                event_type=r[1],
                org=r[2],
                parent_org=r[3],
                q_name=r[4],
                slack_user_id=r[5],
                slack_settings=SlackSettings(**r[6]),
            )
            for r in records
        ]
        session.close()


def send_backblast_reminders(force=False):
    # get the current time in US/Central timezone
    current_time = datetime.now(pytz.timezone("US/Central"))
    # check if the current time is between 5:00 PM and 6:00 PM, eventually configurable
    if current_time.hour == 17 or force:
        backblast_list = BackblastList()
        backblast_list.pull_data()

        for backblast in backblast_list.items:
            # TODO: add some handling for missing stuff
            msg = MSG_TEMPLATE.format(
                q_name=backblast.q_name,
                event_name=backblast.event_type.name,
                event_date=backblast.event.start_date.strftime("%m/%d"),
                event_ao=backblast.org.name,
            )

            slack_bot_token = backblast.slack_settings.bot_token
            backblast_reminder_days = backblast.slack_settings.backblast_reminder_days
            if backblast_reminder_days is None:
                backblast_reminder_days = 5

            if (
                slack_bot_token
                and backblast.slack_user_id
                and not safe_get(backblast.event.meta, "backblast_reminder_dismissed")
                and backblast.event.series_exception != Series_Exception.closed
            ):
                if (
                    backblast_reminder_days > 0
                    and (current_date_cst() - backblast.event.start_date).days <= backblast_reminder_days
                ):
                    ssl_context = ssl.create_default_context()
                    ssl_context.check_hostname = False
                    ssl_context.verify_mode = ssl.CERT_NONE
                    slack_client = WebClient(slack_bot_token, ssl=ssl_context)
                    blocks = [
                        orm.SectionBlock(label=msg),
                        orm.ActionsBlock(
                            elements=[
                                orm.ButtonElement(
                                    label="Fill Out Backblast",
                                    value=str(backblast.event.id),
                                    style="primary",
                                    action=actions.MSG_EVENT_BACKBLAST_BUTTON,
                                ),
                                orm.ButtonElement(
                                    label="Already Posted",
                                    value=str(backblast.event.id),
                                    action=actions.MSG_EVENT_BACKBLAST_ALREADY_BUTTON,
                                ),
                            ]
                        ),
                    ]
                    blocks = [b.as_form_field() for b in blocks]
                    try:
                        slack_client.chat_postMessage(channel=backblast.slack_user_id, text=msg, blocks=blocks)
                    except Exception as e:
                        print(f"Error sending backblast reminder to {backblast.slack_user_id}: {e}")
                        continue


def handle_backblast_reminder_dismiss(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    event_id = safe_get(body, "actions", 0, "value")
    if not event_id:
        logger.error("No event ID found in the action payload.")
        return

    try:
        event_instance = DbManager.get(EventInstance, event_id)
    except Exception as e:
        logger.error(f"Error fetching event with ID {event_id}: {e}")
        return

    meta = event_instance.meta or {}
    meta["backblast_reminder_dismissed"] = True
    DbManager.update_record(EventInstance, event_id, {EventInstance.meta: meta})

    # update the message to reflect dismissal
    try:
        client.chat_update(
            channel=body["channel"]["id"],
            ts=body["message"]["ts"],
            text="Backblast reminder dismissed.",
            blocks=[
                orm.SectionBlock(
                    label="Backblast reminder dismissed. To avoid confusion in the future, select your Q from the backblast dropdown vs. using the 'unscheduled event' option."  # noqa
                ).as_form_field(),
                orm.ImageBlock(
                    image_url="https://storage.googleapis.com/backblast-images/BackblastSelectExample.png",
                    alt_text="Select Q Example",
                ).as_form_field(),
            ],
        )
    except Exception as e:
        logger.error(f"Error updating message for event ID {event_id}: {e}")
        return


if __name__ == "__main__":
    send_backblast_reminders(force=True)
