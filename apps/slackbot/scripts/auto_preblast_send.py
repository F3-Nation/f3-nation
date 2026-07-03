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
from sqlalchemy import and_, func, select
from sqlalchemy.orm import aliased

from features.calendar import event_preblast
from utilities.database.orm import SlackSettings
from utilities.helper_functions import current_date_cst, safe_get


@dataclass
class PreblastItem:
    event: EventInstance
    event_type: EventType
    org: Org
    parent_org: Org
    q_name: str
    slack_user_id: str
    q_avatar_url: str
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
                User.f3_name.label("q_name"),
                SlackUser.slack_id,
                User.avatar_url.label("q_avatar_url"),
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
                slack_settings=SlackSettings(**r[7]),
            )
            for r in records
        ]
        session.expunge_all()
        session.close()


def send_automated_preblasts(force: bool = False):
    # get the current time in US/Central timezone
    current_time = datetime.now(pytz.timezone("US/Central"))
    preblast_list = PreblastList()
    preblast_list.pull_data(
        filters=[
            EventInstance.start_date == current_date_cst() + timedelta(days=1),  # eventually configurable
            EventInstance.preblast_ts.is_(None),  # not already sent
            EventInstance.is_active,  # not canceled
        ]
    )

    for preblast in preblast_list.items:
        # Respect per-event opt-out
        if safe_get((preblast.event.meta or {}), "do_not_send_auto_preblasts"):
            continue

        automated_option = safe_get(preblast.slack_settings.__dict__, "automated_preblast_option") or "disable"
        automated_hour = safe_get(preblast.slack_settings.__dict__, "automated_preblast_hour_cst")
        scheduled_hour = safe_get(preblast.slack_settings.__dict__, "scheduled_preblast_hour_cst") or automated_hour

        # Skip if feature is disabled
        if automated_option == "disable":
            continue

        # If an hour is configured, require match to current hour
        if preblast.event.preblast:
            # If the preblast text is already set, the Q already scheduled it
            if scheduled_hour is not None and scheduled_hour != current_time.hour and not force:
                continue
        else:
            # If not, then use the automated preblast hour
            if automated_hour is not None and automated_hour != current_time.hour and not force:
                continue

        # Respect option semantics around Q assignment
        if automated_option == "q_only" and not preblast.q_name:
            continue

        # Do not send for closed events
        if preblast.event.series_exception == Series_Exception.closed:
            continue

        try:
            ssl_context = ssl.create_default_context()
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE
            slack_client = WebClient(preblast.slack_settings.bot_token, ssl=ssl_context)
            event_preblast.send_preblast(
                event_instance_id=preblast.event.id,
                region_record=preblast.slack_settings,
                client=slack_client,
            )
        except Exception as e:
            print(f"Error sending preblast for event {preblast.event.id}: {e}")
            continue


if __name__ == "__main__":
    send_automated_preblasts(force=True)
