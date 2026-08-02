import os
import sys
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from features import config
from utilities import constants
from utilities.database.orm import SlackSettings
from utilities.slack import actions


def selected_values(**overrides):
    values = {
        actions.KOTTER_REPORT_ENABLE: "enable",
        actions.KOTTER_REPORT_RECIPIENT_USERS: [],
        actions.KOTTER_REPORT_INCLUDE_ADMINS: "no",
        actions.KOTTER_REPORT_INCLUDE_SITE_QS: "no",
        actions.KOTTER_REPORT_SEND_MODE: "group",
        actions.KOTTER_REPORT_DAY: "0",
        actions.KOTTER_REPORT_HOUR_CST: "8",
        actions.KOTTER_REPORT_NO_POST_WEEKS: "2",
        actions.KOTTER_REPORT_REMOVE_WEEKS: "4",
        actions.KOTTER_REPORT_HOME_AO_WEEKS: "8",
        actions.KOTTER_REPORT_NO_Q_WEEKS: "12",
        actions.KOTTER_REPORT_NO_Q_POSTS: "4",
    }
    values.update(overrides)
    return values


def test_invalid_enabled_kotter_config_does_not_save_and_updates_wait_view(monkeypatch):
    region_record = SlackSettings(team_id="T1")
    update_view = MagicMock()
    update_db = MagicMock()
    monkeypatch.setattr(config.forms.KOTTER_REPORT_CONFIG_FORM, "get_selected_values", lambda body: selected_values())
    monkeypatch.setattr(config, "update_submission_wait_view", update_view)
    monkeypatch.setattr(config.DbManager, "update_records", update_db)

    config.handle_kotter_report_config_post({"view": {"id": "V123"}}, MagicMock(), MagicMock(), {}, region_record)

    update_db.assert_not_called()
    update_view.assert_called_once()
    assert update_view.call_args.kwargs["view_id"] == "V123"
    assert update_view.call_args.kwargs["level"] == constants.AlertLevel.ERROR
    assert "at least one delivery destination" in update_view.call_args.kwargs["text"]


def test_valid_kotter_config_saves_and_updates_success_wait_view(monkeypatch):
    region_record = SlackSettings(team_id="T1")
    update_view = MagicMock()
    update_db = MagicMock()
    monkeypatch.setattr(
        config.forms.KOTTER_REPORT_CONFIG_FORM,
        "get_selected_values",
        lambda body: selected_values(**{actions.KOTTER_REPORT_RECIPIENT_USERS: ["U123"]}),
    )
    monkeypatch.setattr(config, "update_submission_wait_view", update_view)
    monkeypatch.setattr(config.DbManager, "update_records", update_db)
    monkeypatch.setattr(config, "update_local_region_records", MagicMock())

    config.handle_kotter_report_config_post({"submission_view_id": "V456"}, MagicMock(), MagicMock(), {}, region_record)

    update_db.assert_called_once()
    assert region_record.kotter_report_recipient_users == ["U123"]
    update_view.assert_called_once()
    assert update_view.call_args.kwargs["view_id"] == "V456"
    assert update_view.call_args.kwargs["level"] == constants.AlertLevel.SUCCESS
    assert "saved successfully" in update_view.call_args.kwargs["text"]
