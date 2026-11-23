import os
import sys
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts import backblast_reminders, preblast_reminders
from utilities.database.orm import SlackSettings
from utilities.helper_functions import current_date_cst


def _item(team_id: str, user_id: str, **extra):
    return SimpleNamespace(
        event=SimpleNamespace(id=1, start_date=current_date_cst(), meta={}, series_exception=None),
        event_type=SimpleNamespace(name="Bootcamp"),
        org=SimpleNamespace(name="AO"),
        parent_org=SimpleNamespace(name="Region"),
        q_name="Q",
        slack_user_id=user_id,
        slack_settings=SlackSettings(team_id=team_id),
        **extra,
    )


@pytest.mark.parametrize("first_lookup", ["uninstalled", "raises"])
@pytest.mark.parametrize(
    "module, list_class, send",
    [
        (preblast_reminders, "PreblastList", preblast_reminders.send_preblast_reminders),
        (backblast_reminders, "BackblastList", backblast_reminders.send_backblast_reminders),
    ],
)
def test_reminders_skip_a_workspace_without_a_client(monkeypatch, module, list_class, send, first_lookup):
    items = [_item("T1", "U1"), _item("T2", "U2")]
    if module is preblast_reminders:
        for item in items:
            item.q_name = "Q"
            item.q_avatar_url = None
            item.slack_avatar_url = None

    def pull_data(self, *args, **kwargs):
        self.items = items

    monkeypatch.setattr(getattr(module, list_class), "pull_data", pull_data)
    installed_client = MagicMock()

    def client_for_team(team_id, **kwargs):
        if team_id == "T2":
            return installed_client
        if first_lookup == "raises":
            raise RuntimeError("lookup failed")
        return None

    monkeypatch.setattr(module, "slack_client_for_team", client_for_team)
    if module is preblast_reminders:
        monkeypatch.setattr(module, "datetime", SimpleNamespace(now=lambda tz: datetime(2026, 9, 1, 10)))

    send(force=True)

    installed_client.chat_postMessage.assert_called_once()
    assert installed_client.chat_postMessage.call_args.kwargs["channel"] == "U2"
