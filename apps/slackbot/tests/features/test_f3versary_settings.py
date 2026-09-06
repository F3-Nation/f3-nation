import os
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from features import f3versary_announcements
from utilities import constants
from utilities.database.orm import SlackSettings
from utilities.slack import actions


def selected_values(**overrides):
    values = {
        actions.F3VERSARY_ANNOUNCEMENTS_ENABLED: "enable",
        actions.F3VERSARY_ANNOUNCEMENTS_CHANNEL: "C1",
        actions.F3VERSARY_ANNOUNCEMENTS_LEAD_DAYS: "14",
    }
    values.update(overrides)
    return values


@pytest.mark.parametrize("lead_days", ["-1", "31", "1.5", "not-a-number", None])
def test_invalid_lead_days_do_not_save(monkeypatch, lead_days):
    region_record = SlackSettings(team_id="T1")
    update_view = MagicMock()
    update_db = MagicMock()
    monkeypatch.setattr(
        f3versary_announcements.F3VERSARY_ANNOUNCEMENTS_FORM,
        "get_selected_values",
        lambda body: selected_values(**{actions.F3VERSARY_ANNOUNCEMENTS_LEAD_DAYS: lead_days}),
    )
    monkeypatch.setattr(f3versary_announcements, "update_submission_wait_view", update_view)
    monkeypatch.setattr(f3versary_announcements.DbManager, "update_records", update_db)

    f3versary_announcements.handle_f3versary_announcements_edit(
        {"view": {"id": "V1"}}, MagicMock(), MagicMock(), {}, region_record
    )

    update_db.assert_not_called()
    assert update_view.call_args.kwargs["level"] == constants.AlertLevel.ERROR
    assert "whole number from 0 through 30" in update_view.call_args.kwargs["text"]


def test_enabled_form_requires_a_channel(monkeypatch):
    region_record = SlackSettings(team_id="T1")
    update_view = MagicMock()
    update_db = MagicMock()
    monkeypatch.setattr(
        f3versary_announcements.F3VERSARY_ANNOUNCEMENTS_FORM,
        "get_selected_values",
        lambda body: selected_values(**{actions.F3VERSARY_ANNOUNCEMENTS_CHANNEL: None}),
    )
    monkeypatch.setattr(f3versary_announcements, "update_submission_wait_view", update_view)
    monkeypatch.setattr(f3versary_announcements.DbManager, "update_records", update_db)

    f3versary_announcements.handle_f3versary_announcements_edit(
        {"view": {"id": "V1"}}, MagicMock(), MagicMock(), {}, region_record
    )

    update_db.assert_not_called()
    assert update_view.call_args.kwargs["level"] == constants.AlertLevel.ERROR
    assert "destination channel" in update_view.call_args.kwargs["text"]


def test_valid_settings_save_and_preserve_last_processed_date(monkeypatch):
    region_record = SlackSettings(
        team_id="T1",
        f3versary_announcements_last_processed_date="2026-09-01",
    )
    update_view = MagicMock()
    update_db = MagicMock()
    refresh = MagicMock()
    monkeypatch.setattr(
        f3versary_announcements.F3VERSARY_ANNOUNCEMENTS_FORM,
        "get_selected_values",
        lambda body: selected_values(**{actions.F3VERSARY_ANNOUNCEMENTS_LEAD_DAYS: "30"}),
    )
    monkeypatch.setattr(f3versary_announcements, "update_submission_wait_view", update_view)
    monkeypatch.setattr(f3versary_announcements.DbManager, "update_records", update_db)
    monkeypatch.setattr(f3versary_announcements, "update_local_region_records", refresh)

    f3versary_announcements.handle_f3versary_announcements_edit(
        {"submission_view_id": "V2"}, MagicMock(), MagicMock(), {}, region_record
    )

    update_db.assert_called_once()
    refresh.assert_called_once()
    assert region_record.f3versary_announcements_enabled is True
    assert region_record.f3versary_announcements_channel == "C1"
    assert region_record.f3versary_announcements_lead_days == 30
    assert region_record.f3versary_announcements_last_processed_date == "2026-09-01"
    assert update_view.call_args.kwargs["level"] == constants.AlertLevel.SUCCESS


def test_disabled_settings_can_save_without_a_channel(monkeypatch):
    region_record = SlackSettings(team_id="T1")
    update_db = MagicMock()
    monkeypatch.setattr(
        f3versary_announcements.F3VERSARY_ANNOUNCEMENTS_FORM,
        "get_selected_values",
        lambda body: selected_values(
            **{
                actions.F3VERSARY_ANNOUNCEMENTS_ENABLED: None,
                actions.F3VERSARY_ANNOUNCEMENTS_CHANNEL: None,
                actions.F3VERSARY_ANNOUNCEMENTS_LEAD_DAYS: "0",
            }
        ),
    )
    monkeypatch.setattr(f3versary_announcements, "update_submission_wait_view", MagicMock())
    monkeypatch.setattr(f3versary_announcements.DbManager, "update_records", update_db)
    monkeypatch.setattr(f3versary_announcements, "update_local_region_records", MagicMock())

    f3versary_announcements.handle_f3versary_announcements_edit(
        {"view": {"id": "V3"}}, MagicMock(), MagicMock(), {}, region_record
    )

    update_db.assert_called_once()
    assert region_record.f3versary_announcements_enabled is False
    assert region_record.f3versary_announcements_channel is None
    assert region_record.f3versary_announcements_lead_days == 0


def test_form_defaults_lead_days_to_fourteen(monkeypatch):
    region_record = SlackSettings(team_id="T1")
    form = MagicMock()
    monkeypatch.setattr(f3versary_announcements.copy, "deepcopy", lambda value: form)

    f3versary_announcements.build_f3versary_announcements_form(
        {"trigger_id": "TRIGGER"}, MagicMock(), MagicMock(), {}, region_record
    )

    initial_values = form.set_initial_values.call_args.args[0]
    assert initial_values[actions.F3VERSARY_ANNOUNCEMENTS_LEAD_DAYS] == "14"
    form.post_modal.assert_called_once()
