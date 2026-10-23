import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from features import connect
from utilities.database.orm import SlackSettings


def test_connection_request_metadata_does_not_include_bot_token(monkeypatch):
    sent = {}
    monkeypatch.setattr(connect, "LOCAL_DEVELOPMENT", False)

    def fake_web_client(**kwargs):
        return MagicMock(chat_postMessage=lambda **args: sent.update(args))

    monkeypatch.setattr(connect, "WebClient", fake_web_client)
    monkeypatch.setenv("ADMIN_BOT_TOKEN", "admin-token")
    monkeypatch.setenv("ADMIN_CHANNEL_ID", "C_ADMIN")
    client = MagicMock()
    client.users_info.return_value = {"user": {"profile": {"display_name": "Pax"}}}
    body = {
        "team": {"id": "TREQUESTER", "domain": "requester"},
        "user": {"id": "U_REQUESTER"},
        "view": {
            "id": "V_CURRENT",
            "previous_view_id": "V_PREVIOUS",
            "state": {
                "values": {
                    connect.SELECT_REGION: {
                        connect.SELECT_REGION: {
                            "type": "external_select",
                            "selected_option": {
                                "value": "42",
                                "text": {"type": "plain_text", "text": "Region 42"},
                            },
                        }
                    },
                    connect.MIGRATION_DATE: {
                        connect.MIGRATION_DATE: {"type": "datepicker", "selected_date": "2026-10-23"}
                    },
                }
            },
        },
    }

    connect.handle_existing_region_selection(
        body,
        client,
        MagicMock(),
        {},
        SlackSettings(team_id="TREQUESTER", bot_token="requester-secret"),
    )

    metadata = sent["metadata"]
    assert metadata["event_payload"] == {
        "user_id": "U_REQUESTER",
        "region_id": "42",
        "region_name": "Region 42",
        "migration_date": "2026-10-23",
        "team_id": "TREQUESTER",
    }
    assert "requestor_bot_token" not in str(metadata)
    buttons = sent["blocks"][-1].to_dict()
    assert "requester-secret" not in str(buttons)


def test_deny_uses_current_db_token_and_ignores_legacy_metadata_token(monkeypatch):
    requester_space = SimpleNamespace(bot_token="current-db-token")
    lookup = MagicMock(return_value=requester_space)
    client_factory = MagicMock()
    monkeypatch.setattr(connect, "_get_requester_slack_space", lookup)
    monkeypatch.setattr(connect, "WebClient", client_factory)
    body = {
        "message": {
            "metadata": {
                "event_payload": {
                    "team_id": "TREQUESTER",
                    "user_id": "U_REQUESTER",
                    "requestor_bot_token": "attacker-controlled-legacy-token",
                }
            }
        }
    }

    connect.handle_deny_connection(body, MagicMock(), MagicMock(), {}, SlackSettings(team_id="TREQUESTER"))

    lookup.assert_called_once_with("TREQUESTER")
    client_factory.assert_called_once()
    assert client_factory.call_args.kwargs["token"] == "current-db-token"
    client_factory.return_value.chat_postMessage.assert_called_once()


def test_deny_rejects_missing_or_invalid_workspace_without_using_legacy_token(monkeypatch):
    lookup = MagicMock(return_value=None)
    client_factory = MagicMock()
    monkeypatch.setattr(connect, "_get_requester_slack_space", lookup)
    monkeypatch.setattr(connect, "WebClient", client_factory)
    body = {
        "message": {
            "metadata": {
                "event_payload": {
                    "team_id": "not-a-slack-team-id",
                    "user_id": "U_REQUESTER",
                    "requestor_bot_token": "legacy-secret",
                }
            }
        }
    }

    connect.handle_deny_connection(body, MagicMock(), MagicMock(), {}, SlackSettings(team_id="TREQUESTER"))

    lookup.assert_called_once_with("not-a-slack-team-id")
    client_factory.assert_not_called()


def test_workspace_lookup_validates_team_id_before_database_query(monkeypatch):
    database_lookup = MagicMock()
    monkeypatch.setattr(connect.DbManager, "find_first_record", database_lookup)

    assert connect._get_requester_slack_space("invalid") is None

    database_lookup.assert_not_called()


def test_workspace_lookup_fetches_token_from_slack_space_by_validated_team(monkeypatch):
    requester_space = SimpleNamespace(bot_token="current-db-token")
    database_lookup = MagicMock(return_value=requester_space)
    monkeypatch.setattr(connect.DbManager, "find_first_record", database_lookup)

    assert connect._get_requester_slack_space("TREQUESTER") is requester_space

    database_lookup.assert_called_once()
    assert database_lookup.call_args.args[0] is connect.SlackSpace


def test_approve_uses_requester_workspace_client_without_admin_context(monkeypatch):
    requester_space = SimpleNamespace(
        bot_token="current-db-token",
        settings={"team_id": "TREQUESTER", "org_id": 7},
        id=12,
    )
    monkeypatch.setattr(
        connect.DbManager,
        "find_first_record",
        MagicMock(side_effect=[requester_space, SimpleNamespace(id=3)]),
    )
    monkeypatch.setattr(connect.DbManager, "get", MagicMock(return_value=SimpleNamespace(id=7)))
    monkeypatch.setattr(connect.DbManager, "create_record", MagicMock())
    monkeypatch.setattr(connect.DbManager, "update_records", MagicMock())
    monkeypatch.setattr(
        connect,
        "get_region_record",
        MagicMock(side_effect=AssertionError("must not load via callback context")),
    )
    get_user = MagicMock(return_value=SimpleNamespace(user_id=22))
    monkeypatch.setattr(connect, "get_user", get_user)
    monkeypatch.setattr(connect, "update_local_region_records", MagicMock())
    client_factory = MagicMock()
    monkeypatch.setattr(connect, "WebClient", client_factory)
    monkeypatch.delenv("ADMIN_BOT_TOKEN", raising=False)
    body = {
        "user": {"id": "U_ADMIN"},
        "message": {
            "metadata": {
                "event_payload": {
                    "team_id": "TREQUESTER",
                    "user_id": "U_REQUESTER",
                    "region_id": 7,
                    "region_name": "Region 7",
                    "migration_date": "2026-10-23",
                    "requestor_bot_token": "poisoned-legacy-token",
                }
            }
        },
    }

    connect.handle_approve_connection(
        body,
        MagicMock(),
        MagicMock(),
        {"bot_token": "admin-token"},
        SlackSettings(team_id="TADMIN"),
    )

    assert client_factory.call_args.kwargs["token"] == "current-db-token"
    assert get_user.call_args.args[2] is client_factory.return_value
    assert client_factory.return_value.chat_postMessage.call_args.kwargs["channel"] == "U_REQUESTER"


def test_approve_rejects_unexpected_workspace_settings_before_database_writes(monkeypatch):
    requester_space = SimpleNamespace(
        bot_token="current-db-token",
        settings={"team_id": "TREQUESTER", "unexpected_stale_field": True},
    )
    find_first_record = MagicMock(return_value=requester_space)
    create_record = MagicMock()
    update_records = MagicMock()
    logger = MagicMock()
    monkeypatch.setattr(connect.DbManager, "find_first_record", find_first_record)
    monkeypatch.setattr(connect.DbManager, "create_record", create_record)
    monkeypatch.setattr(connect.DbManager, "update_records", update_records)
    client_factory = MagicMock()
    monkeypatch.setattr(connect, "WebClient", client_factory)
    body = {
        "message": {
            "metadata": {
                "event_payload": {
                    "team_id": "TREQUESTER",
                    "user_id": "U_REQUESTER",
                    "region_id": 7,
                    "requestor_bot_token": "poisoned-legacy-token",
                }
            }
        }
    }

    connect.handle_approve_connection(
        body,
        MagicMock(),
        logger,
        {"bot_token": "admin-token"},
        SlackSettings(team_id="TADMIN"),
    )

    create_record.assert_not_called()
    update_records.assert_not_called()
    client_factory.assert_not_called()
    logger.warning.assert_called_once_with("Unable to parse requester workspace settings for connection approval.")


@pytest.mark.parametrize(
    "space, warning",
    [
        (None, "Unable to resolve requester workspace credentials for connection approval."),
        (
            SimpleNamespace(bot_token="requester-token", settings={"team_id": "TOTHER"}),
            "Unable to resolve requester workspace settings for connection approval.",
        ),
        (
            SimpleNamespace(bot_token="requester-token", settings={"team_id": "TREQUESTER", "unexpected": True}),
            "Unable to parse requester workspace settings for connection approval.",
        ),
    ],
)
def test_approve_failure_feedback_uses_admin_client_and_does_not_write(monkeypatch, space, warning):
    monkeypatch.setattr(connect, "_get_requester_slack_space", MagicMock(return_value=space))
    writes = [MagicMock(), MagicMock()]
    monkeypatch.setattr(connect.DbManager, "create_record", writes[0])
    monkeypatch.setattr(connect.DbManager, "update_records", writes[1])
    factory = MagicMock()
    monkeypatch.setattr(connect, "WebClient", factory)
    monkeypatch.setenv("ADMIN_BOT_TOKEN", "admin-workspace-token")
    logger = MagicMock()
    body = {
        "user": {"id": "U_ADMIN"},
        "channel": {"id": "C_ADMIN"},
        "message": {"metadata": {"event_payload": {"team_id": "TREQUESTER"}}},
    }

    connect.handle_approve_connection(body, MagicMock(), logger, {}, SlackSettings(team_id="TADMIN"))

    logger.warning.assert_called_once_with(warning)
    factory.assert_called_once_with(token="admin-workspace-token")
    factory.return_value.chat_postEphemeral.assert_called_once()
    assert factory.return_value.chat_postEphemeral.call_args.kwargs["channel"] == "C_ADMIN"
    assert factory.return_value.chat_postEphemeral.call_args.kwargs["user"] == "U_ADMIN"
    assert "requester-token" not in str(factory.return_value.chat_postEphemeral.call_args)
    for write in writes:
        write.assert_not_called()


def test_approve_failure_feedback_skips_missing_channel_or_user(monkeypatch):
    monkeypatch.setattr(connect, "_get_requester_slack_space", MagicMock(return_value=None))
    factory = MagicMock()
    monkeypatch.setattr(connect, "WebClient", factory)
    monkeypatch.setenv("ADMIN_BOT_TOKEN", "admin-workspace-token")
    body = {"message": {"metadata": {"event_payload": {"team_id": "TREQUESTER"}}}}

    connect.handle_approve_connection(body, MagicMock(), MagicMock(), {}, SlackSettings(team_id="TADMIN"))

    factory.assert_not_called()
