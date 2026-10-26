import copy
import os
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from features import welcome
from utilities.database.orm import SlackSettings
from utilities.slack import actions


def region_record(**overrides):
    return SlackSettings(**{"team_id": "T1", "org_id": 8, "workspace_name": "F3 Boone", **overrides})


def team_join():
    return {"event": {"user": {"id": "U_FNG", "profile": {"email": "john@example.com"}}}}


def test_team_join_tells_the_fngs_contacts(monkeypatch):
    notify = MagicMock()
    monkeypatch.setattr(welcome, "notify_fng_joined", notify)
    client, record = MagicMock(), region_record()

    welcome.handle_team_join(team_join(), client, MagicMock(), {}, record)

    notify.assert_called_once_with(client, record, team_join()["event"]["user"], notify.call_args.args[3])


def test_fngs_contacts_hear_he_joined_even_if_the_welcome_dm_fails(monkeypatch):
    notify = MagicMock()
    monkeypatch.setattr(welcome, "notify_fng_joined", notify)
    client = MagicMock()
    client.chat_postMessage.side_effect = RuntimeError("channel_not_found")

    with pytest.raises(RuntimeError):
        welcome.handle_team_join(team_join(), client, MagicMock(), {}, region_record(welcome_dm_enable=1))

    notify.assert_called_once()


def test_team_join_survives_a_failed_fng_lookup(monkeypatch):
    monkeypatch.setattr(welcome, "notify_fng_joined", MagicMock(side_effect=RuntimeError("db down")))
    logger = MagicMock()

    welcome.handle_team_join(team_join(), MagicMock(), logger, {}, region_record())

    logger.error.assert_called_once()


@pytest.mark.parametrize("picked, saved", [("7", 7), ("0", 0), (None, 3)])
def test_settings_save_the_fng_reminder_frequency(monkeypatch, picked, saved):
    record = region_record()
    monkeypatch.setattr(
        welcome.forms.WELCOME_MESSAGE_CONFIG_FORM,
        "get_selected_values",
        MagicMock(return_value={actions.WELCOME_DM_ENABLE: "disable", actions.WELCOME_FNG_REMINDER_DAYS: picked}),
    )
    monkeypatch.setattr(welcome.DbManager, "update_records", MagicMock())
    monkeypatch.setattr(welcome, "update_local_region_records", MagicMock())

    welcome.handle_welcome_message_config_post({}, MagicMock(), MagicMock(), {}, record)

    assert record.fng_reminder_days == saved


@pytest.mark.parametrize("stored, shown", [(None, "3"), (0, "0"), (2, "2")])
def test_settings_form_shows_the_current_frequency(monkeypatch, stored, shown):
    form = copy.deepcopy(welcome.forms.WELCOME_MESSAGE_CONFIG_FORM)
    monkeypatch.setattr(welcome.copy, "deepcopy", lambda _: form)

    welcome.build_welcome_config_form(
        {"trigger_id": "x"}, MagicMock(), MagicMock(), {}, region_record(fng_reminder_days=stored)
    )

    block = next(b for b in form.blocks if getattr(b, "action", None) == actions.WELCOME_FNG_REMINDER_DAYS)
    assert block.element.initial_value == shown
