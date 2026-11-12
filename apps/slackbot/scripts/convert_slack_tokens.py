"""Convert workspaces' long-lived bot tokens to rotating ones with `oauth.v2.exchange`.

Run only after token rotation is enabled on the Slack app. Conversion can't be
undone, and Slack exchanges a token only once: a workspace whose exchange
response is lost before it is saved has to reinstall the app.

    python scripts/convert_slack_tokens.py (--team-id T... [--team-id T...] | --all --limit N) [--dry-run]

`--all --limit N` converts at most N non-rotating workspaces, in team ID order.
Each workspace is converted in its own transaction holding its token lock; the
exchange is the last step before the write. Each workspace prints one line,
`<team_id> <status>`:

- `converted`: the rotating token, its expiry and the encrypted refresh token
  are committed.
- `skipped`: the row already holds a rotating token.
- `would_convert`: `--dry-run` only; the row would be exchanged.
- `failed:<slack error code>`: Slack rejected the exchange; the row is
  unchanged. `failed:no_token` means there is no row or no stored token.
- `needs_reinstall`: Slack says the token was already exchanged, or the
  exchange succeeded and saving its result failed three times. The exchange is
  never called again for the workspace; it recovers by reinstalling the app.
- `error:<exception class>`: anything else failed before the exchange
  returned, such as a lock timeout or a network error. If the error came from
  the exchange call itself, Slack may still have exchanged the token.

`--dry-run` calls nothing and writes nothing. Exits 1 if any workspace is
`failed`, `needs_reinstall` or `error`. Tokens are never printed or logged.
"""

import argparse
import os
import sys
import time
from typing import Optional

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
from f3_data_models.models import SlackSpace
from f3_data_models.utils import session_scope
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from slack_sdk.oauth.installation_store import Bot
from sqlalchemy import select

from utilities import constants
from utilities.slack_tokens.refresh import (
    locked_row,
    log_save_failure,
    save_bot_locked,
    write_locked_row,
)

SAVE_RETRIES = 2
_PATH = "convert_slack_tokens"


def _non_rotating_team_ids(limit: int) -> list[str]:
    with session_scope() as session:
        return list(
            session.scalars(
                select(SlackSpace.team_id)
                .where(SlackSpace.bot_token.is_not(None), SlackSpace.bot_token != "")
                .where(SlackSpace.bot_token_expires_at.is_(None))
                .order_by(SlackSpace.team_id)
                .limit(limit)
            )
        )


def _error_code(error: SlackApiError) -> str:
    code = error.response.get("error") if error.response is not None else None
    return code if isinstance(code, str) else "unknown"


def _bot_from_exchange(team_id: str, row: SlackSpace, response) -> Bot:
    return Bot(
        team_id=team_id,
        bot_token=response["access_token"],
        bot_id=row.bot_id,
        bot_user_id=response.get("bot_user_id") or row.bot_user_id,
        bot_scopes=response.get("scope") or "",
        bot_refresh_token=response["refresh_token"],
        bot_token_expires_at=int(time.time()) + int(response["expires_in"]),
        installed_at=time.time(),
    )


def _save_retry(team_id: str, bot: Optional[Bot]) -> str:
    """Save an exchange result that the locked write lost, without calling Slack again."""
    if bot is None:
        return "needs_reinstall"
    for _ in range(SAVE_RETRIES):
        try:
            if save_bot_locked(bot, team_id=team_id):
                return "converted"
        except Exception as e:
            # Logs the error type only: the exception text can embed the token.
            log_save_failure(team_id, e, path=f"{_PATH}.save_retry")
    return "needs_reinstall"


def _convert_team(team_id: str, dry_run: bool) -> str:
    exchanged = False
    bot: Optional[Bot] = None
    try:
        with locked_row(team_id) as row:
            if row is None or not row.bot_token:
                return "failed:no_token"
            if row.bot_token_expires_at is not None:
                return "skipped"
            if dry_run:
                return "would_convert"
            try:
                # No retry handlers: a retried request after a dropped connection
                # could exchange the token a second time.
                response = WebClient(retry_handlers=[]).oauth_v2_exchange(
                    client_id=os.environ[constants.SLACK_CLIENT_ID],
                    client_secret=os.environ[constants.SLACK_CLIENT_SECRET],
                    token=row.bot_token,
                )
            except SlackApiError as e:
                code = _error_code(e)
                return "needs_reinstall" if code == "token_already_exchanged" else f"failed:{code}"
            exchanged = True
            bot = _bot_from_exchange(team_id, row, response)
            if not write_locked_row(row, bot, path=_PATH):
                return "skipped"
        # Reached only after `locked_row` committed the write.
        return "converted"
    except Exception:
        if not exchanged:
            raise
        # Slack has already exchanged the long-lived token and would refuse a
        # second exchange, so only the save is retried.
        return _save_retry(team_id, bot)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--team-id", action="append", dest="team_ids", metavar="TEAM_ID")
    target.add_argument("--all", action="store_true", help="convert non-rotating workspaces, up to --limit")
    parser.add_argument("--limit", type=int, help="the most workspaces --all converts (required with --all)")
    parser.add_argument("--dry-run", action="store_true", help="report what would be converted; no Slack call")
    args = parser.parse_args(argv)
    if args.all and (args.limit is None or args.limit < 1):
        parser.error("--all requires --limit N with N >= 1")
    if not args.all and args.limit is not None:
        parser.error("--limit applies only to --all")

    team_ids = _non_rotating_team_ids(args.limit) if args.all else list(dict.fromkeys(args.team_ids))
    failed = False
    for team_id in team_ids:
        try:
            status = _convert_team(team_id, args.dry_run)
        except Exception as e:
            # The class name only: exception text can embed request or token data.
            status = f"error:{type(e).__name__}"
        failed = failed or status.startswith(("failed", "needs_reinstall", "error"))
        print(f"{team_id} {status}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
