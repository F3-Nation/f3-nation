"""Bolt installation store backed by the `slack_spaces` credential columns.

Bolt must never refresh a token itself: its rotation path saves through the
store without the per-workspace lock. `find_bot` therefore refreshes under the
lock (`refresh_if_needed`) and returns a `Bot` with no expiry and no refresh
token, which Bolt treats as a non-rotating installation.
"""

import logging
from typing import Optional

from slack_sdk.errors import SlackApiError, SlackTokenRotationError
from slack_sdk.oauth.installation_store import Bot, Installation
from slack_sdk.oauth.installation_store.installation_store import InstallationStore

from utilities.slack_tokens.crypto import TokenDecryptError
from utilities.slack_tokens.refresh import (
    STORE_WINDOW_MINUTES,
    TokenSaveError,
    load_bot,
    locked_row,
    refresh_if_needed,
    save_bot_locked,
)

logger = logging.getLogger(__name__)


def _non_rotating(bot: Optional[Bot]) -> Optional[Bot]:
    if bot is not None:
        bot.bot_token_expires_at = None
        bot.bot_refresh_token = None
    return bot


class SlackSpaceInstallationStore(InstallationStore):
    def save(self, installation: Installation) -> None:
        save_bot_locked(installation.to_bot(), team_id=installation.team_id, workspace_name=installation.team_name)

    def save_bot(self, bot: Bot) -> None:
        save_bot_locked(bot, team_id=bot.team_id)

    def find_bot(
        self,
        *,
        enterprise_id: Optional[str],
        team_id: Optional[str],
        is_enterprise_install: Optional[bool] = False,
    ) -> Optional[Bot]:
        if team_id is None:
            return None
        try:
            bot = refresh_if_needed(team_id, minutes_before_expiration=STORE_WINDOW_MINUTES, path="authorize")
        except Exception as e:
            # Failures are logged by refresh.py. The stored token may still be valid, so a refresh
            # problem doesn't fail the request; Slack rejects the token if it is not.
            if not isinstance(e, (TokenDecryptError, TokenSaveError)) and not _is_slack_error(e):
                raise
            bot = load_bot(team_id)
        return _non_rotating(bot)

    def find_installation(
        self,
        *,
        enterprise_id: Optional[str],
        team_id: Optional[str],
        user_id: Optional[str] = None,
        is_enterprise_install: Optional[bool] = False,
    ) -> Optional[Installation]:
        raise NotImplementedError("Only bot tokens are stored")

    def delete_bot(self, *, enterprise_id: Optional[str], team_id: Optional[str]) -> None:
        self._clear(team_id)

    def delete_installation(
        self, *, enterprise_id: Optional[str], team_id: Optional[str], user_id: Optional[str] = None
    ) -> None:
        self._clear(team_id)

    @staticmethod
    def _clear(team_id: Optional[str]) -> None:
        """Clear the credentials but keep the row, which also holds the workspace's region settings."""
        if team_id is None:
            return
        with locked_row(team_id) as row:
            if row is not None:
                row.bot_token = None
                row.bot_token_expires_at = None
                row.bot_refresh_token_encrypted = None


def _is_slack_error(error: Exception) -> bool:
    return isinstance(error, (SlackApiError, SlackTokenRotationError))
