import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from features import db_admin
from utilities.slack import actions

ANNOUNCEMENT = {"type": "rich_text", "elements": []}


def _body():
    value = {"type": "rich_text_input", "rich_text_value": ANNOUNCEMENT}
    return {"view": {"state": {"values": {actions.DB_ADMIN_TEXT: {actions.DB_ADMIN_TEXT: value}}}}}


def _space(team_id, org_id):
    return (SimpleNamespace(team_id=team_id, workspace_name=f"Workspace {team_id}"), SimpleNamespace(org_id=org_id))


def _admins(*slack_ids):
    return [(None, {"slack_id": slack_id}) for slack_id in slack_ids]


def test_admin_announcement_looks_up_each_workspace_client_once(monkeypatch):
    monkeypatch.setattr(db_admin.DbManager, "find_join_records2", lambda *args, **kwargs: [_space("T1", 1)])
    monkeypatch.setattr(db_admin, "get_admin_users", lambda org_id, team_id: _admins("U_A", "U_B"))
    workspace_client = MagicMock()
    lookup = MagicMock(return_value=workspace_client)
    monkeypatch.setattr(db_admin, "slack_client_for_team", lookup)

    db_admin.handle_send_admin_announcement(_body(), MagicMock(), MagicMock(), {}, MagicMock())

    lookup.assert_called_once_with("T1")
    assert {c.kwargs["channel"] for c in workspace_client.chat_postMessage.call_args_list} == {"U_A", "U_B"}


def test_admin_announcement_continues_after_a_client_lookup_error(monkeypatch):
    monkeypatch.setattr(
        db_admin.DbManager, "find_join_records2", lambda *args, **kwargs: [_space("T1", 1), _space("T2", 2)]
    )
    monkeypatch.setattr(
        db_admin, "get_admin_users", lambda org_id, team_id: _admins("U_A") if team_id == "T1" else _admins("U_B")
    )
    second_client = MagicMock()

    def client_for_team(team_id):
        if team_id == "T1":
            raise RuntimeError("lookup failed")
        return second_client

    monkeypatch.setattr(db_admin, "slack_client_for_team", client_for_team)
    logger = MagicMock()

    db_admin.handle_send_admin_announcement(_body(), MagicMock(), logger, {}, MagicMock())

    second_client.chat_postMessage.assert_called_once()
    assert second_client.chat_postMessage.call_args.kwargs["channel"] == "U_B"
    logger.error.assert_called_once_with("Slack client lookup failed for Workspace T1: RuntimeError")
