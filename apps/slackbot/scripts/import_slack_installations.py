"""Copy Bolt `FileInstallationStore` installations into `slack_spaces`.

Run once per environment, before deploying the release that reads bot
credentials from `slack_spaces`. The installations directory is a local copy of
the bucket the previous release stored them in.

    python scripts/import_slack_installations.py --installations-dir <dir> [--dry-run]

Each workspace prints one line, `<team_id> <status>`:

- `imported`: the file's bot id, bot user id, scopes and token were saved.
- `backfilled`: no file, so the row's own token was checked with `auth.test`
  to fill the bot id, bot user id and scopes.
- `skipped_rotating`: the row already holds a rotating token. Its file holds an
  earlier, already-exchanged token, so the row is neither read from the file
  nor sent to Slack.
- `no_token`: no file and no stored token.
- `auth_failed:<slack error code>`: `auth.test` rejected the stored token.
- `error:<exception class>`: reading the file, calling Slack or saving failed;
  the run continues with the next workspace.

`--dry-run` writes nothing but still calls `auth.test` for backfill rows.
Exits 1 if any workspace is `auth_failed` or `error`. Tokens are never printed.
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
from slack_sdk.oauth.installation_store import Bot, FileInstallationStore
from sqlalchemy import select

from utilities.slack_tokens.refresh import load_bot, save_bot_locked


def _stored_tokens() -> list[tuple[str, Optional[str]]]:
    with session_scope() as session:
        rows = session.execute(select(SlackSpace.team_id, SlackSpace.bot_token).order_by(SlackSpace.team_id)).all()
        return [(team_id, bot_token) for team_id, bot_token in rows]


def _backfill_bot(team_id: str, token: str) -> Bot:
    """Ask Slack who owns `token`; raises `SlackApiError` if it is rejected."""
    response = WebClient(token=token).auth_test()
    scopes = response.headers.get("x-oauth-scopes", "") if response.headers else ""
    return Bot(
        team_id=team_id,
        bot_token=token,
        bot_id=response.get("bot_id"),
        bot_user_id=response.get("user_id"),
        bot_scopes=[scope.strip() for scope in scopes.split(",") if scope.strip()],
        installed_at=time.time(),
    )


def _import_team(team_id: str, token: Optional[str], store: FileInstallationStore, dry_run: bool) -> str:
    existing = load_bot(team_id)
    if existing is not None and existing.bot_token_expires_at is not None:
        return "skipped_rotating"

    file_bot = store.find_bot(enterprise_id=None, team_id=team_id)
    if file_bot is not None:
        if dry_run:
            return "imported"
        return "imported" if save_bot_locked(file_bot, team_id=team_id) else "skipped_rotating"

    if not token:
        return "no_token"
    try:
        bot = _backfill_bot(team_id, token)
    except SlackApiError as e:
        code = e.response.get("error") if e.response is not None else None
        return f"auth_failed:{code if isinstance(code, str) else 'unknown'}"
    if dry_run:
        return "backfilled"
    return "backfilled" if save_bot_locked(bot, team_id=team_id) else "skipped_rotating"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--installations-dir", required=True)
    parser.add_argument(
        "--dry-run", action="store_true", help="report statuses without writing (backfill rows still call auth.test)"
    )
    args = parser.parse_args(argv)

    # The previous release wrote the files without a client_id; adding one changes the directory layout.
    store = FileInstallationStore(base_dir=args.installations_dir)
    failed = False
    for team_id, token in _stored_tokens():
        try:
            status = _import_team(team_id, token, store, args.dry_run)
        except Exception as e:
            # The class name only: exception text can embed request or token data.
            status = f"error:{type(e).__name__}"
        failed = failed or status.startswith(("auth_failed", "error"))
        print(f"{team_id} {status}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
