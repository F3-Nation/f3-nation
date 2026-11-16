"""Slack clients for code that runs outside Bolt's request context.

Callers get a client from `slack_client_for_team` and never hold a token
string. A refresh in another process can revoke the token a long-lived client
holds, so the client re-reads the stored token and retries once.
"""

import logging
import os
from typing import Optional

from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError, SlackClientError
from slack_sdk.web import SlackResponse

from utilities import constants
from utilities.slack_tokens import refresh
from utilities.slack_tokens.crypto import TokenDecryptError

logger = logging.getLogger(__name__)

_REFRESH_FAILURES = (TokenDecryptError, refresh.TokenSaveError, SlackClientError, OSError)


def _log(level: int, event: str, team_id: str, **fields) -> None:
    logger.log(level, event, extra={"json_fields": {"event": event, "team_id": team_id, **fields}})


def get_bot_token(team_id: str) -> Optional[str]:
    """The workspace's current bot token, refreshed first if it expires soon.

    Falls back to the stored token when the refresh fails (the failure is
    already logged); the token may still be valid. Returns None if the
    workspace has no stored token.
    """
    if constants.LOCAL_DEVELOPMENT:
        return os.environ[constants.SLACK_BOT_TOKEN]
    try:
        bot = refresh.refresh_if_needed(team_id, minutes_before_expiration=refresh.STORE_WINDOW_MINUTES, path="getter")
    except _REFRESH_FAILURES:
        bot = refresh.load_bot(team_id)
    return bot.bot_token if bot else None


class RotatingWebClient(WebClient):
    """A `WebClient` that recovers once from a token revoked by another process's refresh."""

    def __init__(self, *, team_id: str, token: str, **kwargs):
        super().__init__(token=token, **kwargs)
        self.team_id = team_id

    def api_call(
        self,
        api_method: str,
        *,
        http_verb: str = "POST",
        files: Optional[dict] = None,
        data: Optional[dict] = None,
        params: Optional[dict] = None,
        json: Optional[dict] = None,
        headers: Optional[dict] = None,
        auth: Optional[dict] = None,
    ) -> SlackResponse:
        def call() -> SlackResponse:
            return super(RotatingWebClient, self).api_call(
                api_method,
                http_verb=http_verb,
                files=files,
                data=data,
                params=params,
                json=json,
                headers=headers,
                auth=auth,
            )

        try:
            return call()
        except SlackApiError as e:
            if e.response.get("error") != "token_revoked":
                raise
            bot = refresh.load_bot(self.team_id)
            if bot is None or not bot.bot_token or bot.bot_token == self.token:
                raise
            self.token = bot.bot_token
            try:
                response = call()
            except SlackApiError:
                _log(logging.WARNING, "slack.token.revoked_retry", self.team_id, succeeded=False)
                raise
            _log(logging.INFO, "slack.token.revoked_retry", self.team_id, succeeded=True)
            return response


def slack_client_for_team(team_id: str, **client_kwargs) -> Optional[RotatingWebClient]:
    """A client for the workspace, or None if it has no bot token."""
    token = get_bot_token(team_id)
    if not token:
        return None
    return RotatingWebClient(team_id=team_id, token=token, **client_kwargs)
