import logging

import pytest
from slack_sdk.errors import SlackApiError
from slack_sdk.web import WebClient

from utilities.slack_tokens.refresh import oauth_web_client

TOKEN_PREFIX = "xoxe.xoxb-1-secret"


def test_undecodable_oauth_body_never_reaches_logs(monkeypatch, caplog):
    def non_json_response(_client, *, url, args):
        return {"status": 200, "headers": {}, "body": f'access_token={TOKEN_PREFIX}&refresh_token=xoxe-1-x "'}

    # Patch only the HTTP layer, so the SDK's own decode-and-log path runs.
    monkeypatch.setattr(WebClient, "_perform_urllib_http_request", non_json_response)

    with caplog.at_level(logging.DEBUG), pytest.raises(SlackApiError):
        oauth_web_client(retry_handlers=[]).oauth_v2_exchange(client_id="id", client_secret="secret", token="xoxb-old")

    decode_records = [r for r in caplog.records if r.getMessage().startswith("Failed to decode Slack API response")]
    assert [(r.levelno, r.getMessage()) for r in decode_records] == [
        (logging.ERROR, "Failed to decode Slack API response")
    ]
    assert not [r for r in caplog.records if TOKEN_PREFIX in r.getMessage()]
