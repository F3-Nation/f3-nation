"""Scheduled scripts that find Qs read `attendance.attendance_type`.

The database holds events with a Q, a Co-Q and a PAX (see `tests.attendance_type_db`),
typed only by the column. The PAX signed up first, so a query that picks "the first
attendee" without its type filter picks the PAX.
"""

from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from f3_data_models import utils as data_model_utils
from f3_data_models.models import Attendance_Type

from scripts import backblast_reminders, kotter_reports, preblast_reminders, q_lineups
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

pytestmark = postgres_fixture.requires_postgres
isolated_postgres = postgres_fixture.isolated_postgres

TODAY = date(2026, 11, 24)


@pytest.fixture
def postgres_schema():
    return create_schema


@pytest.fixture
def db(isolated_postgres, monkeypatch):
    for module in (backblast_reminders, kotter_reports, preblast_reminders):
        monkeypatch.setattr(module, "get_session", data_model_utils.get_session)
    for module in (backblast_reminders, q_lineups):
        monkeypatch.setattr(module, "current_date_cst", lambda: TODAY)
    return isolated_postgres


def test_backblast_reminder_goes_to_the_q(db):
    seed_event(db, start_date=TODAY - timedelta(days=1))

    reminders = backblast_reminders.BackblastList()
    reminders.pull_data()

    assert [(item.event.id, item.q_name, item.slack_user_id) for item in reminders.items] == [
        (100, "TheQ", SLACK_IDS[Q_USER])
    ]


def _kotter_config():
    return kotter_reports.KotterConfig(
        enabled=True,
        org_id=REGION_ID,
        team_id=TEAM_ID,
        recipient_users=[],
        include_admins=False,
        include_site_qs=False,
        send_mode="group",
        split_site_qs=False,
        day=0,
        hour_cst=8,
        no_post_weeks=4,
        remove_weeks=None,
        home_ao_weeks=8,
        no_q_weeks=12,
        no_q_posts=4,
    )


def test_kotter_counts_q_and_co_q_records_as_qs(db):
    # Five weeks ago all three posted, as Q, Co-Q and PAX. In the last four weeks only the PAX posted.
    seed_event(db, start_date=TODAY - timedelta(weeks=5), is_planned=False)
    for week in range(1, 5):
        seed_event(db, start_date=TODAY - timedelta(weeks=week), event_id=100 + week, leaders=False, is_planned=False)

    rows = {row.user_id: row for row in kotter_reports.get_kotter_rows(_kotter_config(), today=TODAY)}

    five_weeks_ago = TODAY - timedelta(weeks=5)
    assert {user_id: (row.reasons, row.recent_q_count, row.last_q_date) for user_id, row in rows.items()} == {
        Q_USER: (["inactive"], 1, five_weeks_ago),
        CO_Q_USER: (["inactive"], 1, five_weeks_ago),
        PAX_USER: (["posting_not_qing"], 0, None),
    }


def test_lineup_signup_makes_a_pax_the_q(db, monkeypatch):
    seed_event(db, start_date=TODAY + timedelta(days=1), leaders=False)
    monkeypatch.setattr(q_lineups, "get_user", lambda *_a, **_k: SimpleNamespace(user_id=PAX_USER))
    client = MagicMock()
    body = {
        "actions": [{"value": "100"}],
        "user": {"id": SLACK_IDS[PAX_USER]},
        "channel": {"id": "C1"},
        "message": {"ts": "1.0"},
    }

    q_lineups.handle_lineup_signup(body, client, MagicMock(), {}, SimpleNamespace(team_id=TEAM_ID))

    assert planned_attendance(db) == {PAX_USER: Attendance_Type.q}
    client.chat_postEphemeral.assert_not_called()


def test_lineup_signup_refuses_when_the_event_has_a_q(db, monkeypatch):
    seed_event(db, start_date=TODAY + timedelta(days=1))
    monkeypatch.setattr(q_lineups, "get_user", lambda *_a, **_k: SimpleNamespace(user_id=PAX_USER))
    client = MagicMock()
    body = {
        "actions": [{"value": "100"}],
        "user": {"id": SLACK_IDS[PAX_USER]},
        "channel": {"id": "C1"},
        "message": {"ts": "1.0"},
    }

    q_lineups.handle_lineup_signup(body, client, MagicMock(), {}, SimpleNamespace(team_id=TEAM_ID))

    assert "TheQ already signed up" in client.chat_postEphemeral.call_args.kwargs["text"]
    assert planned_attendance(db) == {
        Q_USER: Attendance_Type.q,
        CO_Q_USER: Attendance_Type.co_q,
        PAX_USER: Attendance_Type.pax,
    }
