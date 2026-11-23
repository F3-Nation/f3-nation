import json
import logging
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from slack_sdk.errors import SlackApiError, SlackClientError
from slack_sdk.oauth.installation_store import Bot
from slack_sdk.web import WebClient

from utilities.slack_tokens import client as client_module
from utilities.slack_tokens.client import RotatingWebClient, get_bot_token, slack_client_for_team
from utilities.slack_tokens.crypto import TokenDecryptError

TEAM = "T123"


def _bot(token: str) -> Bot:
    return Bot(
        team_id=TEAM,
        bot_token=token,
        bot_id="B1",
        bot_user_id="U1",
        installed_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


class FakeHttp:
    """Stands in for the HTTP layer; records each request's Authorization header."""

    def __init__(self, errors_by_token: dict[str, str]):
        self.errors_by_token = errors_by_token
        self.authorizations: list[str] = []

    def __call__(self, _client, *, url, args):
        auth = args["headers"]["Authorization"]
        self.authorizations.append(auth)
        error = self.errors_by_token.get(auth.removeprefix("Bearer "))
        body = {"ok": False, "error": error} if error else {"ok": True}
        return {"status": 200, "headers": {}, "body": json.dumps(body)}


@pytest.fixture(autouse=True)
def not_local(monkeypatch):
    monkeypatch.setattr(client_module.constants, "LOCAL_DEVELOPMENT", False)


def _patch_http(http: FakeHttp):
    return patch.object(
        WebClient, "_perform_urllib_http_request", lambda self, *, url, args: http(self, url=url, args=args)
    )


def test_client_for_team_returns_none_without_token():
    with patch.object(client_module.refresh, "refresh_if_needed", return_value=None):
        assert slack_client_for_team(TEAM) is None


def test_client_for_team_passes_kwargs_and_token():
    with patch.object(client_module.refresh, "refresh_if_needed", return_value=_bot("xoxb-a")):
        c = slack_client_for_team(TEAM, timeout=7)
    assert isinstance(c, RotatingWebClient)
    assert c.token == "xoxb-a"
    assert c.timeout == 7


def test_revoked_token_reloads_and_retries_once(caplog):
    http = FakeHttp({"xoxb-old": "token_revoked"})
    c = RotatingWebClient(team_id=TEAM, token="xoxb-old")
    with (
        _patch_http(http),
        patch.object(client_module.refresh, "load_bot", return_value=_bot("xoxb-new")) as load,
        caplog.at_level(logging.INFO),
    ):
        response = c.api_call("auth.test")
    assert response["ok"] is True
    assert http.authorizations == ["Bearer xoxb-old", "Bearer xoxb-new"]
    load.assert_called_once_with(TEAM)
    assert c.token == "xoxb-new"
    record = next(r for r in caplog.records if r.getMessage() == "slack.token.revoked_retry")
    assert record.json_fields == {"event": "slack.token.revoked_retry", "team_id": TEAM, "succeeded": True}


def test_revoked_twice_raises():
    http = FakeHttp({"xoxb-old": "token_revoked", "xoxb-new": "token_revoked"})
    c = RotatingWebClient(team_id=TEAM, token="xoxb-old")
    with _patch_http(http), patch.object(client_module.refresh, "load_bot", return_value=_bot("xoxb-new")):
        with pytest.raises(SlackApiError) as exc:
            c.api_call("auth.test")
    assert exc.value.response["error"] == "token_revoked"
    assert len(http.authorizations) == 2


def test_revoked_with_unchanged_stored_token_raises_without_retry():
    http = FakeHttp({"xoxb-old": "token_revoked"})
    c = RotatingWebClient(team_id=TEAM, token="xoxb-old")
    with _patch_http(http), patch.object(client_module.refresh, "load_bot", return_value=_bot("xoxb-old")):
        with pytest.raises(SlackApiError):
            c.api_call("auth.test")
    assert len(http.authorizations) == 1


def test_other_slack_errors_are_not_retried():
    http = FakeHttp({"xoxb-old": "channel_not_found"})
    c = RotatingWebClient(team_id=TEAM, token="xoxb-old")
    with _patch_http(http), patch.object(client_module.refresh, "load_bot") as load:
        with pytest.raises(SlackApiError) as exc:
            c.api_call("auth.test")
    assert exc.value.response["error"] == "channel_not_found"
    load.assert_not_called()
    assert len(http.authorizations) == 1


def test_local_development_uses_env_token(monkeypatch):
    monkeypatch.setattr(client_module.constants, "LOCAL_DEVELOPMENT", True)
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-local")
    with patch.object(client_module.refresh, "refresh_if_needed") as refresh_mock:
        assert get_bot_token(TEAM) == "xoxb-local"
        c = slack_client_for_team(TEAM)
    refresh_mock.assert_not_called()
    assert c is not None and c.token == "xoxb-local"


def test_getter_refreshes_within_store_window():
    with patch.object(client_module.refresh, "refresh_if_needed", return_value=_bot("xoxb-a")) as r:
        assert get_bot_token(TEAM) == "xoxb-a"
    r.assert_called_once_with(TEAM, minutes_before_expiration=120, path="getter")


@pytest.mark.parametrize(
    "failure",
    [TokenDecryptError("x"), client_module.refresh.TokenSaveError("x"), SlackClientError("x"), OSError("x")],
)
def test_getter_falls_back_to_stored_token_when_refresh_fails(failure):
    with (
        patch.object(client_module.refresh, "refresh_if_needed", side_effect=failure),
        patch.object(client_module.refresh, "load_bot", return_value=_bot("xoxb-stored")),
    ):
        assert get_bot_token(TEAM) == "xoxb-stored"
    with (
        patch.object(client_module.refresh, "refresh_if_needed", side_effect=failure),
        patch.object(client_module.refresh, "load_bot", return_value=None),
    ):
        assert get_bot_token(TEAM) is None


def test_getter_propagates_unexpected_errors():
    with patch.object(client_module.refresh, "refresh_if_needed", side_effect=ValueError("boom")):
        with pytest.raises(ValueError):
            get_bot_token(TEAM)
