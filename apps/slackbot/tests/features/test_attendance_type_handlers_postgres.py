"""Slack handlers that find an event's Q and Co-Qs read `attendance.attendance_type`.

The database holds one event with a Q, a Co-Q and a PAX (see `tests.attendance_type_db`),
typed only by the column, and each test checks the handler treats the leaders and the
PAX differently.
"""

import json
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from f3_data_models import utils as data_model_utils
from f3_data_models.models import Attendance_Type

from features import backblast
from features.calendar import event_preblast, home, nearby_events
from tests import postgres_fixture
from tests.attendance_type_db import (
    CO_Q_USER,
    PAX_USER,
    Q_USER,
    REGION_ID,
    SLACK_IDS,
    TEAM_ID,
    create_schema,
    planned_attendance,
    seed_event,
)
from utilities.database import special_queries
from utilities.slack import actions

pytestmark = postgres_fixture.requires_postgres
isolated_postgres = postgres_fixture.isolated_postgres

USER_BY_SLACK_ID = {slack_id: user_id for user_id, slack_id in SLACK_IDS.items()}


@pytest.fixture
def postgres_schema():
    return create_schema


@pytest.fixture
def db(isolated_postgres, monkeypatch):
    monkeypatch.setattr(special_queries, "get_session", data_model_utils.get_session)
    for module in (backblast, event_preblast, home, nearby_events):
        monkeypatch.setattr(
            module,
            "get_user",
            lambda slack_id, *args, **kwargs: SimpleNamespace(user_id=USER_BY_SLACK_ID[slack_id], slack_id=slack_id),
        )
    return isolated_postgres


@pytest.fixture
def region_record():
    return SimpleNamespace(org_id=REGION_ID, team_id=TEAM_ID, migration_date=None)


def _sent(client) -> str:
    return str(client.mock_calls)


@pytest.mark.parametrize(("user_id", "allowed"), [(Q_USER, True), (CO_Q_USER, True), (PAX_USER, False)])
def test_fill_backblast_button_opens_the_form_only_for_a_leader(db, region_record, user_id, allowed):
    seed_event(db, start_date=date.today() - timedelta(days=1))
    body = {
        "user": {"id": SLACK_IDS[user_id]},
        "actions": [{"action_id": actions.PREBLAST_FILL_BACKBLAST_BUTTON, "value": "100"}],
    }

    with (
        patch.object(backblast, "get_admin_users", return_value=[]),
        patch.object(backblast, "build_backblast_form") as build_form,
    ):
        backblast.backblast_middleware(body, MagicMock(), MagicMock(), {}, region_record)

    assert build_form.called is allowed


@pytest.mark.parametrize(("user_id", "listed"), [(Q_USER, True), (CO_Q_USER, True), (PAX_USER, False)])
def test_backblast_picker_lists_past_events_the_user_led(db, region_record, user_id, listed):
    seed_event(db, start_date=date.today() - timedelta(days=1))
    client = MagicMock()

    backblast.backblast_middleware({"user": {"id": SLACK_IDS[user_id]}}, client, MagicMock(), {}, region_record)

    assert (f"{actions.BACKBLAST_FILL_BUTTON}_100" in _sent(client)) is listed


def test_missing_backblast_notify_q_messages_only_the_leaders(db, region_record):
    seed_event(db, start_date=date.today() - timedelta(days=1))
    client = MagicMock()
    body = {
        "user": {"id": SLACK_IDS[PAX_USER]},
        "view": {"id": "V1"},
        "actions": [
            {
                "action_id": f"{actions.MISSING_BACKBLASTS_EVENT}_100",
                "selected_option": {"value": "Notify Q"},
            }
        ],
    }

    with patch.object(backblast, "build_missing_backblasts_form"):
        backblast.handle_missing_backblasts_overflow(body, client, MagicMock(), {}, region_record)

    channels = sorted(call.kwargs["channel"] for call in client.chat_postMessage.call_args_list)
    assert channels == [SLACK_IDS[Q_USER], SLACK_IDS[CO_Q_USER]]


@pytest.mark.parametrize(("user_id", "listed"), [(Q_USER, True), (CO_Q_USER, True), (PAX_USER, False)])
def test_preblast_picker_lists_upcoming_events_the_user_leads(db, region_record, user_id, listed):
    seed_event(db, start_date=date.today() + timedelta(days=1))
    client = MagicMock()

    event_preblast.build_event_preblast_select_form(
        {"user": {"id": SLACK_IDS[user_id]}}, client, MagicMock(), {}, region_record
    )

    assert (f"{actions.EVENT_PREBLAST_FILL_BUTTON}_100" in _sent(client)) is listed


def _home_action(user_id: int, action: str) -> dict:
    return {
        "user": {"id": SLACK_IDS[user_id]},
        "view": {"id": "V1"},
        "actions": [{"action_id": "event_100", "selected_option": {"value": action}}],
    }


@pytest.fixture
def home_refresh():
    with (
        patch.object(home, "build_home_form"),
        patch.object(home, "build_preblast_info") as preblast_info,
    ):
        preblast_info.return_value = SimpleNamespace(event_record=SimpleNamespace(preblast_ts=None))
        yield


def test_home_take_q_makes_a_pax_the_q(db, region_record, home_refresh):
    seed_event(db, start_date=date.today() + timedelta(days=1), leaders=False)

    home.handle_home_event(_home_action(PAX_USER, "Take Q"), MagicMock(), MagicMock(), {}, region_record)

    assert planned_attendance(db) == {PAX_USER: Attendance_Type.q}


def test_home_take_q_by_the_q_changes_nothing(db, region_record, home_refresh):
    # With link rows present, adding the Q link again would violate the link table's primary key.
    seed_event(db, start_date=date.today() + timedelta(days=1), with_links=True)

    home.handle_home_event(_home_action(Q_USER, "Take Q"), MagicMock(), MagicMock(), {}, region_record)

    assert planned_attendance(db) == {
        Q_USER: Attendance_Type.q,
        CO_Q_USER: Attendance_Type.co_q,
        PAX_USER: Attendance_Type.pax,
    }


@pytest.mark.parametrize("user_id", [PAX_USER, Q_USER, CO_Q_USER])
def test_home_un_hc_removes_only_a_pax_record(db, region_record, home_refresh, user_id):
    seed_event(db, start_date=date.today() + timedelta(days=1))
    expected = {
        Q_USER: Attendance_Type.q,
        CO_Q_USER: Attendance_Type.co_q,
        PAX_USER: Attendance_Type.pax,
    }
    if user_id == PAX_USER:
        del expected[PAX_USER]

    home.handle_home_event(_home_action(user_id, "Un-HC"), MagicMock(), MagicMock(), {}, region_record)

    assert planned_attendance(db) == expected


@pytest.mark.parametrize(
    ("new_q", "expected"),
    [
        # The old leaders' records are removed; the PAX is kept and only re-created if newly assigned.
        (CO_Q_USER, {CO_Q_USER: Attendance_Type.q, PAX_USER: Attendance_Type.pax}),
        (PAX_USER, {PAX_USER: Attendance_Type.q}),
    ],
)
def test_assign_q_replaces_the_leaders_and_keeps_the_pax(db, region_record, new_q, expected):
    seed_event(db, start_date=date.today() + timedelta(days=1))
    body = {
        "user": {"id": SLACK_IDS[PAX_USER]},
        "view": {
            "private_metadata": json.dumps({"event_instance_id": 100}),
            "blocks": [],
            "state": {
                "values": {
                    actions.CALENDAR_HOME_ASSIGN_Q_USER: {
                        actions.CALENDAR_HOME_ASSIGN_Q_USER: {
                            "type": "multi_users_select",
                            "selected_users": [SLACK_IDS[new_q]],
                        }
                    },
                    actions.CALENDAR_HOME_ASSIGN_Q_CO_QS: {
                        actions.CALENDAR_HOME_ASSIGN_Q_CO_QS: {"type": "multi_users_select", "selected_users": []}
                    },
                }
            },
        },
    }

    home.handle_assign_q_form(body, MagicMock(), MagicMock(), {}, region_record)

    assert planned_attendance(db) == expected


@pytest.mark.parametrize("user_id", [PAX_USER, Q_USER])
def test_nearby_events_un_hc_removes_only_a_pax_record(db, region_record, user_id):
    seed_event(db, start_date=date.today() + timedelta(days=1))
    expected = {
        Q_USER: Attendance_Type.q,
        CO_Q_USER: Attendance_Type.co_q,
        PAX_USER: Attendance_Type.pax,
    }
    if user_id == PAX_USER:
        del expected[PAX_USER]
    body = {
        "user": {"id": SLACK_IDS[user_id]},
        "actions": [{"action_id": actions.NEARBY_EVENTS_UN_HC, "value": json.dumps({"event_instance_id": 100})}],
    }

    with patch.object(nearby_events, "build_nearby_events_modal"):
        nearby_events.handle_nearby_events_hc_action(body, MagicMock(), MagicMock(), {}, region_record)

    assert planned_attendance(db) == expected
