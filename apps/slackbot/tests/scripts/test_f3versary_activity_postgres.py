from datetime import date, time

import pytest
from f3_data_models.models import Attendance, Base, EventInstance, Org, Org_Type, User
from sqlalchemy import text
from sqlalchemy.orm import Session

from scripts import f3versary_announcements
from tests import postgres_fixture

pytestmark = postgres_fixture.requires_postgres
isolated_postgres = postgres_fixture.isolated_postgres


@pytest.fixture(autouse=True)
def bind_candidate_database(monkeypatch, isolated_postgres):
    monkeypatch.setattr(f3versary_announcements, "get_session", lambda: Session(isolated_postgres))


@pytest.fixture
def postgres_schema():
    def create(engine):
        with engine.begin() as connection:
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS citext"))
            connection.execute(text("CREATE SCHEMA IF NOT EXISTS slackbot"))
        Base.metadata.create_all(engine)

    return create


def _seed(engine, recent_date, *, planned=False, active=True, home_region=1, override_only=False):
    with Session(engine) as session:
        session.add_all(
            [Org(id=i, name=f"Synthetic region {i}", org_type=Org_Type.region, is_active=True) for i in (1, 2)]
        )
        session.flush()
        session.add(
            User(
                id=1,
                f3_name="Synthetic PAX",
                email="activity-test@example.com",
                home_region_id=home_region,
                meta={"start_date_override": "2020-09-15"} if override_only else {},
            )
        )
        session.flush()
        if not override_only:
            session.add(
                EventInstance(
                    id=1,
                    org_id=2,
                    start_date=date(2020, 9, 15),
                    end_date=date(2020, 9, 15),
                    start_time=time(5, 30),
                    end_time=time(6, 15),
                    name="Historical",
                    is_active=True,
                )
            )
            session.flush()
            session.add(Attendance(event_instance_id=1, user_id=1, is_planned=False))
        if recent_date is not None:
            session.add(
                EventInstance(
                    id=2,
                    org_id=2,
                    start_date=recent_date,
                    end_date=recent_date,
                    start_time=time(5, 30),
                    end_time=time(6, 15),
                    name="Recent",
                    is_active=active,
                )
            )
            session.flush()
            session.add(Attendance(event_instance_id=2, user_id=1, is_planned=planned))
        session.commit()


def _config(days=90):
    return f3versary_announcements.F3versaryConfig(
        enabled=True, org_id=1, team_id="T1", channel="C1", lead_days=14, last_processed_date=None, activity_days=days
    )


@pytest.mark.parametrize(
    "recent_date, expected",
    [(date(2026, 6, 3), [1]), (date(2026, 6, 2), []), (date(2026, 9, 1), [1]), (date(2026, 9, 2), []), (None, [])],
)
def test_activity_window_uses_processing_date_and_counts_other_regions(isolated_postgres, recent_date, expected):
    _seed(isolated_postgres, recent_date)
    result = f3versary_announcements.get_f3versary_candidates(_config(), date(2026, 9, 15), date(2026, 9, 1))
    assert [pax.user_id for pax in result] == expected
    if result:
        assert result[0].effective_start_date == date(2020, 9, 15)
        assert result[0].completed_years == 6


@pytest.mark.parametrize("planned, active", [(True, True), (False, False), (False, True)])
def test_only_actual_attendance_at_active_events_qualifies(isolated_postgres, planned, active):
    _seed(isolated_postgres, date(2026, 8, 31), planned=planned, active=active)
    result = f3versary_announcements.get_f3versary_candidates(_config(), date(2026, 9, 15))
    assert [pax.user_id for pax in result] == ([1] if not planned and active else [])


@pytest.mark.parametrize("days, expected", [(0, [1]), (30, []), (60, []), (90, []), (180, [1]), (360, [1])])
def test_selected_window_changes_eligibility(isolated_postgres, days, expected):
    _seed(isolated_postgres, date(2026, 5, 1))
    result = f3versary_announcements.get_f3versary_candidates(_config(days), date(2026, 9, 15))
    assert [pax.user_id for pax in result] == expected


@pytest.mark.parametrize("days, expected", [(0, [1]), (90, [])])
def test_profile_override_alone_needs_attendance_unless_no_requirement(isolated_postgres, days, expected):
    _seed(isolated_postgres, None, override_only=True)
    result = f3versary_announcements.get_f3versary_candidates(_config(days), date(2026, 9, 15))
    assert [pax.user_id for pax in result] == expected


def test_other_home_region_is_excluded_even_with_recent_attendance(isolated_postgres):
    _seed(isolated_postgres, date(2026, 8, 31), home_region=2)
    assert f3versary_announcements.get_f3versary_candidates(_config(), date(2026, 9, 15)) == []


@pytest.mark.parametrize("days", [0, 30, 60, 90, 180, 360])
def test_settings_submission_persists_and_reopens_without_overwriting_other_keys(isolated_postgres, monkeypatch, days):
    from unittest.mock import MagicMock

    from f3_data_models.models import Org_x_SlackSpace, SlackSpace

    from features import f3versary_announcements as settings_feature
    from utilities.database.orm import SlackSettings
    from utilities.slack import actions

    _seed(isolated_postgres, None, override_only=True)
    with Session(isolated_postgres) as session:
        session.add(
            SlackSpace(
                id=10,
                team_id="T1",
                workspace_name="Synthetic workspace",
                settings={"unrelated_key": "preserve", "f3versary_announcements_last_processed_date": "2026-08-31"},
            )
        )
        session.flush()
        session.add(Org_x_SlackSpace(org_id=1, slack_space_id=10))
        session.commit()
    monkeypatch.setattr(settings_feature, "get_session", lambda: Session(isolated_postgres))
    monkeypatch.setattr(settings_feature, "_is_authorized_region_admin", lambda *args: True)
    monkeypatch.setattr(settings_feature, "update_local_region_records", lambda: None)
    monkeypatch.setattr(settings_feature, "update_submission_wait_view", MagicMock())
    region = SlackSettings(team_id="T1", org_id=1)
    selected = {
        actions.F3VERSARY_ANNOUNCEMENTS_ENABLED: {"selected_options": [{"value": "enable"}]},
        actions.F3VERSARY_ANNOUNCEMENTS_CHANNEL: {"selected_conversation": "C1"},
        actions.F3VERSARY_ANNOUNCEMENTS_LEAD_DAYS: {"value": "14"},
        actions.F3VERSARY_ANNOUNCEMENTS_ACTIVITY_DAYS: {"selected_option": {"value": str(days)}},
    }
    body = {"view": {"id": "V1", "blocks": [], "state": {"values": {k: {k: v} for k, v in selected.items()}}}}
    settings_feature.handle_f3versary_announcements_edit(body, MagicMock(), MagicMock(), {}, region)
    with Session(isolated_postgres) as session:
        settings = session.get(SlackSpace, 10).settings
    assert settings == {
        "unrelated_key": "preserve",
        "f3versary_announcements_last_processed_date": "2026-08-31",
        "f3versary_announcements_enabled": True,
        "f3versary_announcements_channel": "C1",
        "f3versary_announcements_lead_days": 14,
        "f3versary_announcements_activity_days": days,
    }
    client = MagicMock()
    settings_feature.build_f3versary_announcements_form({"trigger_id": "TRIGGER"}, client, MagicMock(), {}, region)
    blocks = client.views_push.call_args.kwargs["view"]["blocks"]
    dropdown = next(
        block["element"] for block in blocks if block.get("block_id") == actions.F3VERSARY_ANNOUNCEMENTS_ACTIVITY_DAYS
    )
    assert dropdown["initial_option"]["value"] == str(days)
