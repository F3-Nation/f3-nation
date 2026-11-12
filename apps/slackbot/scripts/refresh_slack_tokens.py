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
from sqlalchemy import select

from utilities.slack_tokens.refresh import SWEEP_WINDOW_MINUTES, _to_epoch, refresh_if_needed

logger = logging.getLogger(__name__)


def refresh_expiring_tokens() -> dict[str, int]:
    """Refresh each workspace whose token expires within `SWEEP_WINDOW_MINUTES`.

    Returns counts of workspaces processed:

    - `refreshed`: the stored token's expiry changed. Every refresh issues a
      new expiry and a token-less comparison keeps this script out of the
      token-access boundary.
    - `skipped`: selected, but no refresh was needed by the time its lock was
      held (another process refreshed first, or the lock timed out).
    - `failed`: refreshing raised. `refresh_if_needed` has already logged
      `slack.token.refresh_failed` or `slack.token.decrypt_failed` with the
      error type.

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
        except Exception:
            counts["failed"] += 1
            continue
        if bot is not None and bot.bot_token_expires_at != old_expiry:
            counts["refreshed"] += 1
        else:
            counts["skipped"] += 1

    logger.info(
        "slack.token.sweep_complete",
        extra={"json_fields": {"event": "slack.token.sweep_complete", **counts}},
    )
    return counts


if __name__ == "__main__":
    print(refresh_expiring_tokens())
