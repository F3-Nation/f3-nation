import json
import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from slack_sdk.errors import SlackApiError
from slack_sdk.web.slack_response import SlackResponse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from features import downrange
from utilities.database.orm import SlackSettings


@pytest.mark.parametrize("sharing", ["proactive", "request_only", "direct_email"])
def test_region_selection_button_payload_contains_identifiers_not_credentials(sharing):
    blocks = downrange._build_region_info_blocks(
        has_slack=True,
        target_settings=SimpleNamespace(
            downrange_invite_sharing=sharing,
            downrange_invite_link="https://join.slack.com/t/target" if sharing == "proactive" else None,
        ),
        target_team_id="T_TARGET",
        target_org_id=42,
        selected_org_name="Target",
        requester_team_id="T_REQUESTER",
        requester_user_id="U_REQUESTER",
        requester_name="Requester",
        requester_region_name="Home",
    )

    buttons = [element for block in blocks if hasattr(block, "elements") for element in block.elements]
    payload = json.loads(next(button.value for button in buttons if getattr(button, "value", None)))
    assert payload["target_team_id"] == "T_TARGET"
    assert payload["requester_team_id"] == "T_REQUESTER"
    assert not any("token" in key.lower() for key in payload)
    assert all("xoxb" not in getattr(button, "value", "").lower() for button in buttons)


def test_request_uses_server_resolved_target_token_and_never_emits_token_metadata(monkeypatch):
    target_settings = SlackSettings(team_id="T_TARGET", org_id=42)
    target_settings.downrange_invite_sharing = "request_only"
    monkeypatch.setattr(
        downrange,
        "_get_target_region_info",
        MagicMock(return_value=("T_TARGET", "xoxb-target-secret", target_settings)),
    )
    monkeypatch.setattr(
        downrange, "get_admin_users", MagicMock(return_value=[(None, SimpleNamespace(slack_id="U_ADMIN"))])
    )
    target_client = MagicMock()
    target_client.conversations_open.return_value = {"channel": {"id": "D1"}}
    web_client_factory = MagicMock(return_value=target_client)
    monkeypatch.setattr(downrange, "WebClient", web_client_factory)
    client = MagicMock()
    body = {
        "actions": [
            {
                "value": json.dumps(
                    {"target_team_id": "T_TARGET", "target_org_id": 42, "target_bot_token": "xoxb-attacker"}
                )
            }
        ],
        "user": {"id": "U_REQUESTER"},
        "view": {"id": "V1", "state": {"values": {}}},
    }

    downrange.handle_invite_request(
        body, client, MagicMock(), {}, SlackSettings(team_id="T_REQUESTER", org_id=9, bot_token="xoxb-requester-secret")
    )

    assert web_client_factory.call_args.kwargs["token"] == "xoxb-target-secret"
    payload = target_client.chat_postMessage.call_args.kwargs["metadata"]["event_payload"]
    assert payload["requester_team_id"] == "T_REQUESTER"
    assert not any("token" in key.lower() for key in payload)


def test_approval_uses_server_side_requester_space_and_legacy_token_metadata_is_rejected(monkeypatch):
    send = MagicMock()
    space_lookup = MagicMock(return_value=SimpleNamespace(bot_token="xoxb-server-secret"))
    monkeypatch.setattr(downrange, "_get_space_for_team", space_lookup)
    web_client = MagicMock()
    monkeypatch.setattr(downrange, "WebClient", MagicMock(return_value=send))
    record = SlackSettings(team_id="T_TARGET", org_id=42, downrange_invite_link="https://invite.test")
    body = {
        "message": {
            "metadata": {"event_payload": {"requester_team_id": "T_REQUESTER", "requester_user_id": "U1"}},
            "ts": "1",
        },
        "channel": {"id": "C1"},
        "user": {"id": "U_ADMIN"},
    }

    downrange.handle_invite_approve(body, web_client, MagicMock(), {}, record)

    assert downrange.WebClient.call_args.kwargs["token"] == "xoxb-server-secret"
    broken_payload = json.loads(send.chat_postMessage.call_args.kwargs["blocks"][2]["elements"][0]["value"])
    assert not any("token" in key.lower() for key in broken_payload)

    legacy = {
        "message": {
            "metadata": {"event_payload": {"requester_bot_token": "xoxb-client-token", "requester_user_id": "U1"}}
        }
    }
    downrange.handle_invite_approve(legacy, web_client, MagicMock(), {}, record)
    assert space_lookup.call_count == 1
    send.chat_postMessage.assert_called_once()


@pytest.mark.parametrize("handler_name", ["handle_invite_deny", "handle_invite_mark_done"])
def test_legacy_denial_and_mark_done_metadata_never_lookup_or_send(monkeypatch, handler_name):
    lookup = MagicMock()
    monkeypatch.setattr(downrange, "_get_space_for_team", lookup)
    client = MagicMock()
    legacy_body = {
        "message": {
            "metadata": {"event_payload": {"requester_bot_token": "xoxb-legacy", "requester_user_id": "U1"}},
            "ts": "1",
        },
        "channel": {"id": "C1"},
        "user": {"id": "U_ADMIN"},
    }

    getattr(downrange, handler_name)(legacy_body, client, MagicMock(), {}, SlackSettings(team_id="T_TARGET", org_id=42))

    lookup.assert_not_called()
    client.chat_postMessage.assert_not_called()
    client.chat_postEphemeral.assert_called_once_with(
        channel="C1",
        user="U_ADMIN",
        text="This request can't be completed. Please ask the requester to resubmit from Downrange.",
    )


def test_missing_server_side_bot_token_fails_closed(monkeypatch):
    lookup = MagicMock(return_value=SimpleNamespace(bot_token=None))
    monkeypatch.setattr(downrange.DbManager, "find_first_record", lookup)
    assert downrange._get_space_for_team("T_REQUESTER") is None

    factory = MagicMock()
    monkeypatch.setattr(downrange, "WebClient", factory)
    body = {
        "message": {"metadata": {"event_payload": {"requester_team_id": "T_REQUESTER", "requester_user_id": "U1"}}},
        "channel": {"id": "C1"},
    }
    downrange.handle_invite_deny(body, MagicMock(), MagicMock(), {}, SlackSettings(team_id="T_TARGET", org_id=42))
    factory.assert_not_called()


@pytest.mark.parametrize("value", [{}, {"target_team_id": "T_TARGET", "target_org_id": 42}])
def test_unresolved_request_updates_modal_with_fixed_resubmit_guidance(monkeypatch, value):
    client = MagicMock()
    monkeypatch.setattr(downrange, "_get_target_region_info", MagicMock(return_value=("OTHER", None, None)))
    body = {"actions": [{"value": json.dumps(value)}], "view": {"id": "V1", "state": {"values": {}}}}

    downrange.handle_invite_request(body, client, MagicMock(), {}, SlackSettings(team_id="T_REQUESTER"))

    client.views_update.assert_called_once()
    assert "resubmit from Downrange" in str(client.views_update.call_args)
    assert "target_team_id" not in str(client.views_update.call_args)


def test_unresolved_admin_feedback_is_best_effort_without_channel_or_user():
    client = MagicMock()
    body = {"message": {"metadata": {"event_payload": {}}}}

    downrange.handle_invite_deny(body, client, MagicMock(), {}, SlackSettings(team_id="T_TARGET"))

    client.chat_postEphemeral.assert_not_called()


def test_broken_link_uses_org_team_lookup_and_ignores_legacy_embedded_token(monkeypatch):
    target_client = MagicMock()
    target_client.conversations_open.return_value = {"channel": {"id": "D1"}}
    factory = MagicMock(return_value=target_client)
    monkeypatch.setattr(downrange, "WebClient", factory)
    monkeypatch.setattr(
        downrange, "_get_target_region_info", MagicMock(return_value=("T_TARGET", "xoxb-server-target", None))
    )
    monkeypatch.setattr(
        downrange, "get_admin_users", MagicMock(return_value=[(None, SimpleNamespace(slack_id="U_ADMIN"))])
    )
    body = {
        "actions": [
            {
                "value": json.dumps(
                    {"target_team_id": "T_TARGET", "target_org_id": 42, "target_bot_token": "xoxb-client-forged"}
                )
            }
        ],
        "user": {"id": "U_REQUESTER"},
        "channel": {"id": "C_REQUESTER"},
    }

    downrange.handle_invite_link_broken(
        body, MagicMock(), MagicMock(), {}, SlackSettings(team_id="T_REQUESTER", org_id=9)
    )

    assert factory.call_args.kwargs["token"] == "xoxb-server-target"
    sent_blocks = target_client.chat_postMessage.call_args.kwargs["blocks"]
    assert all("xoxb" not in str(block).lower() for block in sent_blocks)


def test_slack_api_error_logging_includes_only_safe_error_code():
    logger = MagicMock()
    error = SlackApiError(
        "request failed with xoxb-secret",
        {"error": "ratelimited", "response_metadata": {"token": "xoxb-response-secret"}},
    )

    downrange._log_slack_call_error(logger, "handle_invite_approve.requester_dm_error", error)

    logged = str(logger.error.call_args)
    assert "ratelimited" in logged
    assert "handle_invite_approve.requester_dm_error" in logged
    assert "xoxb" not in logged


def test_slack_api_error_with_real_slack_response_logs_only_error_code():
    logger = MagicMock()
    response = SlackResponse(
        client=None,
        http_verb="POST",
        api_url="https://slack.example/api",
        req_args={},
        data={"error": "channel_not_found", "token": "xoxb-response-secret"},
        headers={},
        status_code=200,
    )
    error = SlackApiError("request failed with xoxb-secret", response)

    downrange._log_slack_call_error(logger, "handle_invite_approve.requester_dm_error", error)

    logged = str(logger.error.call_args)
    assert "channel_not_found" in logged
    assert "xoxb" not in logged
    assert "response" not in logged


def test_slack_error_with_unexpected_code_and_other_errors_log_type_only():
    slack_logger = MagicMock()
    downrange._log_slack_call_error(
        slack_logger,
        "handle_invite_deny.requester_dm_error",
        SlackApiError("xoxb-secret", {"error": "xoxb_secret"}),
    )
    assert "unclassified" in str(slack_logger.error.call_args)
    assert "xoxb" not in str(slack_logger.error.call_args)

    exception_logger = MagicMock()
    downrange._log_slack_call_error(
        exception_logger,
        "handle_invite_mark_done.admin_message_update_error",
        RuntimeError("xoxb-exception-secret"),
    )
    logged = str(exception_logger.error.call_args)
    assert "RuntimeError" in logged
    assert "handle_invite_mark_done.admin_message_update_error" in logged
    assert "xoxb" not in logged
