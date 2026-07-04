import os
import ssl
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import List

import pytz
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
from sqlalchemy import String, and_, func, or_, select
from sqlalchemy.orm import aliased

from features.calendar.event_instance import META_DO_NOT_SEND_AUTO_PREBLASTS
from utilities.database.orm import SlackSettings
from utilities.helper_functions import current_date_cst, safe_get
from utilities.slack import actions, orm

MSG_TEMPLATE = "Hey there, {q_name}! I see you have an upcoming {event_name} Q on {event_date} at {event_ao}. Please click the button below to fill out the preblast form below to let everyone know what to expect. Thanks for leading!"  # noqa
MSG_TEMPLATE_NOT_ABLE = " If you're not able to complete the form, I'll still send one out on your behalf."  # noqa


@dataclass
class PreblastItem:
    event: EventInstance
    event_type: EventType
    org: Org
    parent_org: Org
    q_name: str
    slack_user_id: str
    q_avatar_url: str
    slack_avatar_url: str
    slack_settings: SlackSettings


@dataclass
class PreblastList:
    items: List[PreblastItem] = field(default_factory=list)

    def pull_data(self, filters: List):
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
                func.coalesce(SlackUser.user_name, User.f3_name).label("q_name"),
                SlackUser.slack_id,
                func.coalesce(User.avatar_url, SlackUser.avatar_url).label("q_avatar_url"),
                SlackUser.avatar_url.label("slack_avatar_url"),
                SlackSpace.settings,
            )
            .select_from(EventInstance)
            .join(Org, Org.id == EventInstance.org_id)
            .join(EventType_x_EventInstance, EventType_x_EventInstance.event_instance_id == EventInstance.id)
            .join(EventType, EventType.id == EventType_x_EventInstance.event_type_id)
            .join(ParentOrg, Org.parent_id == ParentOrg.id)
            .outerjoin(
                firstq_subquery,
                and_(EventInstance.id == firstq_subquery.c.event_instance_id, firstq_subquery.c.rn == 1),
            )
            .outerjoin(User, User.id == firstq_subquery.c.user_id)
            .join(Org_x_SlackSpace, ParentOrg.id == Org_x_SlackSpace.org_id)
            .join(SlackSpace, Org_x_SlackSpace.slack_space_id == SlackSpace.id)
            .outerjoin(SlackUser, and_(User.id == SlackUser.user_id, SlackUser.slack_team_id == SlackSpace.team_id))
            .filter(*filters)
            .order_by(ParentOrg.name, Org.name, EventInstance.start_time)
        )
        records = query.all()
        self.items = [
            PreblastItem(
                event=r[0],
                event_type=r[1],
                org=r[2],
                parent_org=r[3],
                q_name=r[4],
                slack_user_id=r[5],
                q_avatar_url=r[6],
                slack_avatar_url=r[7],
                slack_settings=SlackSettings(**r[8]),
            )
            for r in records
        ]
        session.expunge_all()
        session.close()


def send_preblast_reminders(force: bool = False):
    # get the current time in US/Central timezone
    current_time = datetime.now(pytz.timezone("US/Central"))
    preblast_list = PreblastList()
    preblast_list.pull_data(
        filters=[
            EventInstance.start_date == current_date_cst() + timedelta(days=1),  # eventually configurable
            EventInstance.preblast_ts.is_(None),  # not already sent
            or_(
                EventInstance.preblast_rich.is_(None), EventInstance.preblast_rich.cast(String) == "null"
            ),  # not already set
            EventInstance.is_active,  # not canceled
            or_(EventInstance.series_exception.is_(None), EventInstance.series_exception != Series_Exception.closed),  # noqa: E501
        ]
    )
    preblast_list.items = [item for item in preblast_list.items if item.q_name is not None]
    print(f"Found {len(preblast_list.items)} preblast reminders to send.")

    for preblast in preblast_list.items:
        # check per-region configured reminder hour, defaulting to 10am CST
        reminder_hour = preblast.slack_settings.preblast_reminder_hour_cst
        if reminder_hour is None:
            reminder_hour = 10
        if current_time.hour != reminder_hour and not force:
            continue
        # TODO: add some handling for missing stuff
        msg = MSG_TEMPLATE.format(
            q_name=preblast.q_name,
            event_name=preblast.event_type.name,
            event_date=preblast.event.start_date.strftime("%m/%d"),
            event_ao=preblast.org.name,
        )
        if not (
            safe_get(preblast.event.meta, META_DO_NOT_SEND_AUTO_PREBLASTS)
            or preblast.slack_settings.automated_preblast_option == "disable"
        ):
            msg += MSG_TEMPLATE_NOT_ABLE

        slack_bot_token = preblast.slack_settings.bot_token
        if slack_bot_token and preblast.slack_user_id:
            ssl_context = ssl.create_default_context()
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE
            slack_client = WebClient(slack_bot_token, ssl=ssl_context)
            blocks: List[orm.BaseBlock] = [
                orm.SectionBlock(label=msg),
                orm.ActionsBlock(
                    elements=[
                        orm.ButtonElement(
                            label="Fill Out Preblast",
                            value=str(preblast.event.id),
                            style="primary",
                            action=actions.MSG_EVENT_PREBLAST_BUTTON,
                        ),
                    ],
                ),
            ]
            blocks = [b.as_form_field() for b in blocks]
            try:
                slack_client.chat_postMessage(channel=preblast.slack_user_id, text=msg, blocks=blocks)
            except Exception as e:
                print(f"Error sending preblast reminder to {preblast.q_name} ({preblast.slack_user_id}): {e}")
                continue


if __name__ == "__main__":
    send_preblast_reminders(force=True)
