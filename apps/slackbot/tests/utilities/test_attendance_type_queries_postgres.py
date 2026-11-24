"""Shared queries that find an event's Q and Co-Qs pick the leaders, not the PAX."""

import datetime
from datetime import date, timedelta

import pytest
from f3_data_models import utils as data_model_utils
from f3_data_models.models import Attendance, Attendance_Type, EventInstance

from tests import postgres_fixture
from tests.attendance_type_db import AO_ID, CO_Q_USER, PAX_USER, Q_USER, REGION_ID, TEAM_ID, create_schema, seed_event
from utilities.database import special_queries

pytestmark = postgres_fixture.requires_postgres
isolated_postgres = postgres_fixture.isolated_postgres


@pytest.fixture
def postgres_schema():
    return create_schema


@pytest.fixture
def db(isolated_postgres, monkeypatch):
    """The disposable database, with special_queries' own `get_session` import pointed at it."""
    monkeypatch.setattr(special_queries, "get_session", data_model_utils.get_session)
    return isolated_postgres


@pytest.mark.parametrize("open_q_only", [False, True])
def test_home_schedule_lists_leaders_as_planned_qs(db, open_q_only):
    seed_event(db, start_date=date.today() + timedelta(days=1))
    # A second event with only a PAX is the "open Q" event.
    seed_event(db, start_date=date.today() + timedelta(days=2), event_id=101, leaders=False)

    rows = special_queries.home_schedule_query(
        user_id=PAX_USER, filters=[EventInstance.org_id == AO_ID], open_q_only=open_q_only
    )

    planned = {row.event.id: sorted((row.planned_qs or "").split(",")) if row.planned_qs else [] for row in rows}
    if open_q_only:
        assert planned == {101: []}
    else:
        assert planned == {100: ["TheCoQ", "TheQ"], 101: []}


@pytest.mark.parametrize(("user_id", "expected_user_q"), [(Q_USER, 1), (CO_Q_USER, 1), (PAX_USER, 0)])
def test_home_schedule_marks_only_leaders_as_user_q(db, user_id, expected_user_q):
    seed_event(db, start_date=date.today() + timedelta(days=1))

    for only_users_events in (False, True):
        rows = special_queries.home_schedule_query(
            user_id=user_id, filters=[EventInstance.org_id == AO_ID], only_users_events=only_users_events
        )
        assert [(row.event.id, row.user_attending, row.user_q) for row in rows] == [(100, 1, expected_user_q)]


def test_missing_backblasts_lists_only_leader_slack_ids(db):
    seed_event(db, start_date=date.today() - timedelta(days=1))

    rows = special_queries.missing_backblasts_query(region_org_id=REGION_ID, slack_team_id=TEAM_ID)

    assert [(row.event.id, sorted(row.q_slack_ids)) for row in rows] == [(100, ["U10", "U11"])]


def test_events_without_leader_types_skip_events_with_a_leader(db):
    seed_event(db, start_date=date.today() + timedelta(days=1))
    seed_event(db, start_date=date.today() + timedelta(days=2), event_id=101, leaders=False)

    events = special_queries.event_instances_without_attendance_types(
        excluded_attendance_types=[Attendance_Type.q, Attendance_Type.co_q],
        event_filter=[EventInstance.org_id == AO_ID],
    )

    assert [event.id for event in events] == [101]


def test_event_attendance_query_filters_on_the_attendance_type_column(db):
    seed_event(db, start_date=date.today() + timedelta(days=1))
    seed_event(db, start_date=date.today() + timedelta(days=2), event_id=101, leaders=False)

    def events_for(user_id):
        return [
            event.id
            for event in special_queries.event_attendance_query(
                attendance_filter=[
                    Attendance.user_id == user_id,
                    Attendance.attendance_type.in_([Attendance_Type.q, Attendance_Type.co_q]),
                ],
                event_filter=[EventInstance.start_date >= datetime.date.today()],
            )
        ]

    assert events_for(Q_USER) == [100]
    assert events_for(PAX_USER) == []
