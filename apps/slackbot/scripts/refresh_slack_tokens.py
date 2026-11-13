"""Refresh every rotating Slack bot token that expires within the sweep window.

Slack access tokens last 12 hours. A quiet workspace sends no traffic that
would trigger a refresh, and the API only reads tokens, so the hourly job
refreshes them here before running its other scripts.
"""

import logging
import os
import sys
import time

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
from datetime import datetime, timezone

from f3_data_models.models import SlackSpace
from f3_data_models.utils import session_scope
from slack_sdk.errors import SlackClientError
from sqlalchemy import select

from utilities.slack_tokens.crypto import TokenDecryptError
from utilities.slack_tokens.refresh import (
    SWEEP_WINDOW_MINUTES,
    TokenSaveError,
    _to_epoch,
    log_refresh_failure,
    refresh_if_needed,
)

logger = logging.getLogger(__name__)

# `refresh_if_needed` logs these itself (a decrypt failure, a failed save, or a
# Slack or network error from the rotation call); anything else is logged here.
_LOGGED_BY_REFRESH = (TokenDecryptError, TokenSaveError, SlackClientError, OSError)


def refresh_expiring_tokens() -> dict[str, int]:
    """Refresh each workspace whose token expires within `SWEEP_WINDOW_MINUTES`.

    Returns counts of workspaces processed:

    - `refreshed`: the expiry returned differs from the one selected, so the
      token was refreshed, by this sweep or by another process after the
      selection. Every refresh issues a new expiry, and comparing expiries
      rather than tokens keeps this script out of the token-access boundary.
    - `skipped`: the expiry is unchanged (the lock timed out, or the save guard
      or Slack's rotator left the token as it was), or the row no longer holds
      a token.
    - `failed`: refreshing raised. Each failure is logged with the error type
      only, as `slack.token.refresh_failed` or `slack.token.decrypt_failed`.

    `slack.token.sweep_complete` carries the counts, at WARNING when any
    workspace failed.

    One workspace's failure never stops the others. Non-rotating rows have no
    expiry and are never selected.
    """
    cutoff = datetime.fromtimestamp(time.time() + SWEEP_WINDOW_MINUTES * 60, tz=timezone.utc)
    with session_scope() as session:
        rows = session.execute(
            select(SlackSpace.team_id, SlackSpace.bot_token_expires_at)
            .where(SlackSpace.bot_token_expires_at.is_not(None), SlackSpace.bot_token_expires_at < cutoff)
            .order_by(SlackSpace.team_id)
        ).all()
        due = [(row.team_id, _to_epoch(row.bot_token_expires_at)) for row in rows]

    counts = {"refreshed": 0, "failed": 0, "skipped": 0}
    for team_id, old_expiry in due:
        try:
            bot = refresh_if_needed(team_id, minutes_before_expiration=SWEEP_WINDOW_MINUTES, path="sweep")
        except Exception as e:
            if not isinstance(e, _LOGGED_BY_REFRESH):
                log_refresh_failure(team_id, e, path="sweep")
            counts["failed"] += 1
            continue
        if bot is not None and bot.bot_token_expires_at != old_expiry:
            counts["refreshed"] += 1
        else:
            counts["skipped"] += 1

    logger.log(
        logging.WARNING if counts["failed"] else logging.INFO,
        "slack.token.sweep_complete",
        extra={"json_fields": {"event": "slack.token.sweep_complete", **counts}},
    )
    return counts


if __name__ == "__main__":
    print(refresh_expiring_tokens())
