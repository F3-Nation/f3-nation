import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy.dialects import postgresql

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from features import f3versary_announcements
from utilities import constants
from utilities.database.orm import SlackSettings
from utilities.slack import actions

REAL_REGION_AUTH = f3versary_announcements._is_authorized_region_admin


@pytest.fixture(autouse=True)
def authorize_region_admin(monkeypatch):
    monkeypatch.setattr(f3versary_announcements, "_is_authorized_region_admin", lambda *args: True)


def selected_values(**overrides):
    values = {
        actions.F3VERSARY_ANNOUNCEMENTS_ENABLED: ["enable"],
        actions.F3VERSARY_ANNOUNCEMENTS_CHANNEL: "C1",
        actions.F3VERSARY_ANNOUNCEMENTS_LEAD_DAYS: "14",
    }
    values.update(overrides)
    return values


def test_region_admin_check_uses_selected_server_side_region(monkeypatch):
    monkeypatch.setattr(f3versary_announcements, "ALL_USERS_ARE_ADMINS", False)
    monkeypatch.setattr(f3versary_announcements, "get_user", lambda *args: SimpleNamespace(user_id=1))
    get_admin_users = MagicMock(return_value=[(SimpleNamespace(id=2), None)])
    monkeypatch.setattr(f3versary_announcements, "get_admin_users", get_admin_users)
    region_record = SlackSettings(team_id="T1", org_id=6)
    body = {"user": {"id": "U1"}, "org_id": 7}

    assert REAL_REGION_AUTH(body, MagicMock(), MagicMock(), region_record) is False
    get_admin_users.assert_called_once_with(6, "T1")
    get_admin_users.return_value = [(SimpleNamespace(id=1), None)]
    assert REAL_REGION_AUTH(body, MagicMock(), MagicMock(), region_record) is True


def test_settings_upsert_targets_only_independent_region_table(monkeypatch):
    session = MagicMock()
    session.__enter__.return_value = session
    session.query.return_value.join.return_value.filter.return_value.one_or_none.return_value = (10,)
    monkeypatch.setattr(f3versary_announcements, "get_session", lambda: session)
    region_record = SlackSettings(team_id="T1", org_id=6)

    assert f3versary_announcements._save_f3versary_settings(region_record, True, "C1", 14) is True

    session.execute.assert_called_once()
    statement = session.execute.call_args.args[0]
    compiled = statement.compile(dialect=postgresql.dialect())
    sql = str(compiled).lower()
    assert sql.startswith("insert into f3versary_announcement_settings")
    assert "on conflict (slack_space_id, org_id) do update" in sql
    assert "slack_spaces.settings" not in sql
    assert compiled.params["slack_space_id"] == 10
    assert compiled.params["org_id"] == 6
    assert compiled.params["enabled"] is True
    assert compiled.params["channel"] == "C1"
    assert compiled.params["lead_days"] == 14
    session.commit.assert_called_once()


def test_unlinked_region_never_reads_or_writes_settings(monkeypatch):
    session = MagicMock()
    session.__enter__.return_value = session
    session.query.return_value.join.return_value.filter.return_value.one_or_none.return_value = None
    monkeypatch.setattr(f3versary_announcements, "get_session", lambda: session)

    assert f3versary_announcements._load_f3versary_settings(SlackSettings(team_id="T1", org_id=6)) is None
    assert (
        f3versary_announcements._save_f3versary_settings(SlackSettings(team_id="T1", org_id=6), True, "C1", 14) is False
    )
    session.execute.assert_not_called()
    session.commit.assert_not_called()


def test_missing_region_id_fails_closed_before_database_access(monkeypatch):
    get_session = MagicMock()
    monkeypatch.setattr(f3versary_announcements, "get_session", get_session)

    assert f3versary_announcements._load_f3versary_settings(SlackSettings(team_id="T1")) is None
    assert f3versary_announcements._save_f3versary_settings(SlackSettings(team_id="T1"), True, "C1", 14) is False
    get_session.assert_called()
    get_session.return_value.__enter__.return_value.query.assert_not_called()


def test_two_regions_in_one_workspace_use_distinct_setting_rows(monkeypatch):
    session = MagicMock()
    session.__enter__.return_value = session
    session.query.return_value.join.return_value.filter.return_value.one_or_none.return_value = (10,)
    monkeypatch.setattr(f3versary_announcements, "get_session", lambda: session)

    assert f3versary_announcements._save_f3versary_settings(SlackSettings(team_id="T1", org_id=6), True, "C6", 0)
    assert f3versary_announcements._save_f3versary_settings(SlackSettings(team_id="T1", org_id=7), False, "C7", 30)

    first, second = [
        call.args[0].compile(dialect=postgresql.dialect()).params for call in session.execute.call_args_list
    ]
    assert (first["slack_space_id"], first["org_id"], first["enabled"], first["channel"], first["lead_days"]) == (
        10,
        6,
        True,
        "C6",
        0,
    )
    assert (second["slack_space_id"], second["org_id"], second["enabled"], second["channel"], second["lead_days"]) == (
        10,
        7,
        False,
        "C7",
        30,
    )


def test_form_read_prefers_region_row_over_stale_cached_document(monkeypatch):
    session = MagicMock()
    session.__enter__.return_value = session
    linked_query = MagicMock()
    linked_query.join.return_value.filter.return_value.one_or_none.return_value = (10,)
    row_query = MagicMock()
    row_query.filter.return_value.one_or_none.return_value = SimpleNamespace(
        enabled=True, channel="C-new", lead_days=14
    )
    session.query.side_effect = [linked_query, row_query]
    monkeypatch.setattr(f3versary_announcements, "get_session", lambda: session)
    stale_record = SlackSettings(
        team_id="T1",
        org_id=6,
        f3versary_announcements_enabled=False,
        f3versary_announcements_channel="C-old",
        f3versary_announcements_lead_days=30,
    )

    assert f3versary_announcements._load_f3versary_settings(stale_record) == {
        "enabled": True,
        "channel": "C-new",
        "lead_days": 14,
    }
    assert session.query.call_count == 2


@pytest.mark.parametrize("lead_days", ["-1", "31", "1.5", "not-a-number", None])
def test_invalid_lead_days_do_not_save(monkeypatch, lead_days):
    region_record = SlackSettings(team_id="T1", org_id=6)
    update_view = MagicMock()
    update_db = MagicMock()
    monkeypatch.setattr(
        f3versary_announcements.F3VERSARY_ANNOUNCEMENTS_FORM,
        "get_selected_values",
        lambda body: selected_values(**{actions.F3VERSARY_ANNOUNCEMENTS_LEAD_DAYS: lead_days}),
    )
    monkeypatch.setattr(f3versary_announcements, "update_submission_wait_view", update_view)
    monkeypatch.setattr(f3versary_announcements, "_save_f3versary_settings", update_db)

    f3versary_announcements.handle_f3versary_announcements_edit(
        {"view": {"id": "V1"}}, MagicMock(), MagicMock(), {}, region_record
    )

    update_db.assert_not_called()
    assert update_view.call_args.kwargs["level"] == constants.AlertLevel.ERROR
    assert "whole number from 0 through 30" in update_view.call_args.kwargs["text"]


def test_enabled_form_requires_a_channel(monkeypatch):
    region_record = SlackSettings(team_id="T1", org_id=6)
    update_view = MagicMock()
    update_db = MagicMock()
    monkeypatch.setattr(
        f3versary_announcements.F3VERSARY_ANNOUNCEMENTS_FORM,
        "get_selected_values",
        lambda body: selected_values(**{actions.F3VERSARY_ANNOUNCEMENTS_CHANNEL: None}),
    )
    monkeypatch.setattr(f3versary_announcements, "update_submission_wait_view", update_view)
    monkeypatch.setattr(f3versary_announcements, "_save_f3versary_settings", update_db)

    f3versary_announcements.handle_f3versary_announcements_edit(
        {"view": {"id": "V1"}}, MagicMock(), MagicMock(), {}, region_record
    )

    update_db.assert_not_called()
    assert update_view.call_args.kwargs["level"] == constants.AlertLevel.ERROR
    assert "destination channel" in update_view.call_args.kwargs["text"]


def test_unauthorized_submission_cannot_change_region_setting(monkeypatch):
    region_record = SlackSettings(team_id="T1", org_id=6)
    update_view = MagicMock()
    update_db = MagicMock()
    monkeypatch.setattr(f3versary_announcements, "_is_authorized_region_admin", lambda *args: False)
    monkeypatch.setattr(f3versary_announcements, "_save_f3versary_settings", update_db)
    monkeypatch.setattr(f3versary_announcements, "update_submission_wait_view", update_view)

    f3versary_announcements.handle_f3versary_announcements_edit(
        {"view": {"id": "V1"}}, MagicMock(), MagicMock(), {}, region_record
    )

    update_db.assert_not_called()
    assert update_view.call_args.kwargs["level"] == constants.AlertLevel.ERROR


def test_unlinked_region_submission_reports_failure_without_success(monkeypatch):
    region_record = SlackSettings(team_id="T1", org_id=6)
    update_view = MagicMock()
    monkeypatch.setattr(
        f3versary_announcements.F3VERSARY_ANNOUNCEMENTS_FORM,
        "get_selected_values",
        lambda body: selected_values(),
    )
    monkeypatch.setattr(f3versary_announcements, "_save_f3versary_settings", lambda *args: False)
    monkeypatch.setattr(f3versary_announcements, "update_submission_wait_view", update_view)

    f3versary_announcements.handle_f3versary_announcements_edit(
        {"view": {"id": "V1"}}, MagicMock(), MagicMock(), {}, region_record
    )

    assert update_view.call_args.kwargs["level"] == constants.AlertLevel.ERROR
    assert "No settings were saved" in update_view.call_args.kwargs["text"]


def test_valid_settings_save_without_mutating_cached_workspace_document(monkeypatch):
    region_record = SlackSettings(
        team_id="T1",
        org_id=6,
        f3versary_announcements_enabled=False,
        f3versary_announcements_channel="C-stale",
        f3versary_announcements_lead_days=0,
        f3versary_announcements_last_processed_date="2026-09-01",
    )
    update_view = MagicMock()
    update_db = MagicMock(return_value=True)
    monkeypatch.setattr(
        f3versary_announcements.F3VERSARY_ANNOUNCEMENTS_FORM,
        "get_selected_values",
        lambda body: selected_values(**{actions.F3VERSARY_ANNOUNCEMENTS_LEAD_DAYS: "30"}),
    )
    monkeypatch.setattr(f3versary_announcements, "update_submission_wait_view", update_view)
    monkeypatch.setattr(f3versary_announcements, "_save_f3versary_settings", update_db)

    f3versary_announcements.handle_f3versary_announcements_edit(
        {"submission_view_id": "V2"}, MagicMock(), MagicMock(), {}, region_record
    )

    update_db.assert_called_once()
    assert update_db.call_args.args == (region_record, True, "C1", 30)
    assert region_record.f3versary_announcements_enabled is False
    assert region_record.f3versary_announcements_channel == "C-stale"
    assert region_record.f3versary_announcements_lead_days == 0
    assert region_record.f3versary_announcements_last_processed_date == "2026-09-01"
    assert update_view.call_args.kwargs["level"] == constants.AlertLevel.SUCCESS


def test_disabled_settings_can_save_without_a_channel(monkeypatch):
    region_record = SlackSettings(team_id="T1", org_id=6)
    update_db = MagicMock(return_value=True)
    monkeypatch.setattr(
        f3versary_announcements.F3VERSARY_ANNOUNCEMENTS_FORM,
        "get_selected_values",
        lambda body: selected_values(
            **{
                actions.F3VERSARY_ANNOUNCEMENTS_ENABLED: [],
                actions.F3VERSARY_ANNOUNCEMENTS_CHANNEL: None,
                actions.F3VERSARY_ANNOUNCEMENTS_LEAD_DAYS: "0",
            }
        ),
    )
    monkeypatch.setattr(f3versary_announcements, "update_submission_wait_view", MagicMock())
    monkeypatch.setattr(f3versary_announcements, "_save_f3versary_settings", update_db)

    f3versary_announcements.handle_f3versary_announcements_edit(
        {"view": {"id": "V3"}}, MagicMock(), MagicMock(), {}, region_record
    )

    update_db.assert_called_once()
    assert update_db.call_args.args == (region_record, False, None, 0)


def test_form_defaults_lead_days_to_fourteen(monkeypatch):
    region_record = SlackSettings(team_id="T1", org_id=6)
    form = MagicMock()
    monkeypatch.setattr(f3versary_announcements.copy, "deepcopy", lambda value: form)
    monkeypatch.setattr(
        f3versary_announcements,
        "_load_f3versary_settings",
        lambda region: {"enabled": False, "channel": None, "lead_days": 14},
    )

    f3versary_announcements.build_f3versary_announcements_form(
        {"trigger_id": "TRIGGER"}, MagicMock(), MagicMock(), {}, region_record
    )

    initial_values = form.set_initial_values.call_args.args[0]
    assert initial_values[actions.F3VERSARY_ANNOUNCEMENTS_ENABLED] == []
    assert initial_values[actions.F3VERSARY_ANNOUNCEMENTS_LEAD_DAYS] == "14"
    form.post_modal.assert_called_once()


def test_enabled_form_selects_checkbox_on_reopen(monkeypatch):
    region_record = SlackSettings(team_id="T1", org_id=6, f3versary_announcements_enabled=False)
    form = MagicMock()
    monkeypatch.setattr(f3versary_announcements.copy, "deepcopy", lambda value: form)
    monkeypatch.setattr(
        f3versary_announcements,
        "_load_f3versary_settings",
        lambda region: {"enabled": True, "channel": "C1", "lead_days": 30},
    )

    f3versary_announcements.build_f3versary_announcements_form(
        {"trigger_id": "TRIGGER"}, MagicMock(), MagicMock(), {}, region_record
    )

    initial_values = form.set_initial_values.call_args.args[0]
    assert initial_values[actions.F3VERSARY_ANNOUNCEMENTS_ENABLED] == ["enable"]
    assert initial_values[actions.F3VERSARY_ANNOUNCEMENTS_CHANNEL] == "C1"
    assert initial_values[actions.F3VERSARY_ANNOUNCEMENTS_LEAD_DAYS] == "30"


def test_enabled_checkbox_serializes_initial_option():
    form = f3versary_announcements.copy.deepcopy(f3versary_announcements.F3VERSARY_ANNOUNCEMENTS_FORM)
    action = actions.F3VERSARY_ANNOUNCEMENTS_ENABLED
    form.set_initial_values({action: ["enable"]})

    checkbox = next(block["element"] for block in form.as_form_field() if block.get("block_id") == action)
    assert [option["value"] for option in checkbox["initial_options"]] == ["enable"]


def test_enabled_submission_reads_actual_checkbox_payload(monkeypatch):
    region_record = SlackSettings(team_id="T1", org_id=6)
    update_db = MagicMock(return_value=True)
    monkeypatch.setattr(f3versary_announcements, "_save_f3versary_settings", update_db)
    monkeypatch.setattr(f3versary_announcements, "update_submission_wait_view", MagicMock())
    enabled_action = actions.F3VERSARY_ANNOUNCEMENTS_ENABLED
    channel_action = actions.F3VERSARY_ANNOUNCEMENTS_CHANNEL
    lead_days_action = actions.F3VERSARY_ANNOUNCEMENTS_LEAD_DAYS
    body = {
        "view": {
            "id": "V1",
            "blocks": [],
            "state": {
                "values": {
                    enabled_action: {enabled_action: {"selected_options": [{"value": "enable"}]}},
                    channel_action: {channel_action: {"selected_conversation": "C1"}},
                    lead_days_action: {lead_days_action: {"value": "14"}},
                }
            },
        }
    }

    f3versary_announcements.handle_f3versary_announcements_edit(body, MagicMock(), MagicMock(), {}, region_record)

    assert update_db.call_args.args == (region_record, True, "C1", 14)


def test_enable_checkbox_is_optional_so_it_can_be_cleared():
    assert f3versary_announcements.F3VERSARY_ANNOUNCEMENTS_FORM.blocks[0].optional is True
