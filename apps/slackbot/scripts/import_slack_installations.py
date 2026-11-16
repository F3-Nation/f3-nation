"""Copy Bolt `FileInstallationStore` installations into `slack_spaces`.

Run once per environment, after the migration and before deploying the release
that reads bot credentials from `slack_spaces`. The installations directory is
a local copy of the bucket the previous release stored them in. Don't re-run it
after that deploy: the release saves new installations only to `slack_spaces`,
so from then on the files are older than the rows and would overwrite them.

    python scripts/import_slack_installations.py --installations-dir <dir> [--dry-run]

Each workspace prints one line, `<team_id> <status>`:

- `imported`: the file's bot id, bot user id, scopes and token were saved.
- `imported_new`: a file with no `slack_spaces` row; the row was created from
  it, named after the file's team name. Without it the workspace would stop
  working once the release reads credentials only from `slack_spaces`.
- `backfilled`: no file, so the row's own token was checked with `auth.test`
  to fill the bot id, bot user id and scopes.
- `skipped_rotating`: the row already holds a rotating token. Its file holds an
  earlier, already-exchanged token, so the row is neither read from the file
  nor sent to Slack.
- `skipped_changed`: the row's token changed while the run was in progress
  (a reinstall, or another process saving it), so the newer token is kept.
- `no_token`: no file and no stored token.
- `team_mismatch`: the file, or `auth.test` for the stored token, names a
  different workspace, so nothing was saved.
- `auth_failed:<slack error code>`: `auth.test` rejected the stored token.
- `error:<exception class>`: reading the file, calling Slack or saving failed;
  the run continues with the next workspace.

`--dry-run` writes nothing but still calls `auth.test` for backfill rows.
Exits 1 if any workspace is `team_mismatch`, `auth_failed` or `error`, and 2 if
`--installations-dir` is not a directory. Tokens are never printed.
"""

import argparse
import glob
import os
import sys
import time
from functools import partial
from typing import Optional

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
from f3_data_models.models import SlackSpace
from f3_data_models.utils import session_scope
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from slack_sdk.oauth.installation_store import Bot, FileInstallationStore
from sqlalchemy import select

from utilities.slack_tokens.refresh import TokenChanged, load_bot, save_bot_locked


def _stored_tokens() -> list[tuple[str, Optional[str]]]:
    with session_scope() as session:
        rows = session.execute(select(SlackSpace.team_id, SlackSpace.bot_token).order_by(SlackSpace.team_id)).all()
        return [(team_id, bot_token) for team_id, bot_token in rows]


def _file_team_ids(installations_dir: str) -> list[str]:
    """Team ids of the workspace (non-enterprise) installation files, from their `none-<team_id>` directories."""
    paths = glob.glob(os.path.join(glob.escape(installations_dir), "none-*", "bot-latest"))
    team_ids = {os.path.basename(os.path.dirname(path))[len("none-") :] for path in paths}
    return sorted(team_id for team_id in team_ids if team_id and team_id != "none")


def _save(
    bot: Bot, team_id: str, snapshot_token: Optional[str], status: str, workspace_name: Optional[str] = None
) -> str:
    """Save `bot` only if the row still holds the token read at the start of the run."""
    try:
        saved = save_bot_locked(bot, team_id=team_id, workspace_name=workspace_name, expected_token=snapshot_token)
    except TokenChanged:
        return "skipped_changed"
    return status if saved else "skipped_rotating"


def _import_new_team(team_id: str, store: FileInstallationStore, dry_run: bool) -> str:
    file_bot = store.find_bot(enterprise_id=None, team_id=team_id)
    if file_bot is None:
        return "no_token"
    if file_bot.team_id != team_id:
        return "team_mismatch"
    if dry_run:
        return "imported_new"
    return _save(file_bot, team_id, None, "imported_new", workspace_name=file_bot.team_name)


def _backfill_bot(token: str) -> Bot:
    """Ask Slack who owns `token`; raises `SlackApiError` if it is rejected."""
    response = WebClient(token=token).auth_test()
    scopes = response.headers.get("x-oauth-scopes", "") if response.headers else ""
    return Bot(
        team_id=response.get("team_id"),
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
        if file_bot.team_id != team_id:
            return "team_mismatch"
        if dry_run:
            return "imported"
        return _save(file_bot, team_id, token, "imported")

    if not token:
        return "no_token"
    try:
        bot = _backfill_bot(token)
    except SlackApiError as e:
        code = e.response.get("error") if e.response is not None else None
        return f"auth_failed:{code if isinstance(code, str) else 'unknown'}"
    if bot.team_id != team_id:
        return "team_mismatch"
    if dry_run:
        return "backfilled"
    return _save(bot, team_id, token, "backfilled")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--installations-dir", required=True)
    parser.add_argument(
        "--dry-run", action="store_true", help="report statuses without writing (backfill rows still call auth.test)"
    )
    args = parser.parse_args(argv)
    # FileInstallationStore accepts a missing path and finds no files in it, which
    # would report every file-only workspace as absent instead of failing.
    if not os.path.isdir(args.installations_dir):
        parser.error(f"--installations-dir is not a directory: {args.installations_dir}")

    # The previous release wrote the files without a client_id; adding one changes the directory layout.
    store = FileInstallationStore(base_dir=args.installations_dir)
    stored = _stored_tokens()
    known = {team_id for team_id, _token in stored}
    work = [(team_id, partial(_import_team, team_id, token, store, args.dry_run)) for team_id, token in stored]
    work += [
        (team_id, partial(_import_new_team, team_id, store, args.dry_run))
        for team_id in _file_team_ids(args.installations_dir)
        if team_id not in known
    ]
    failed = False
    for team_id, step in work:
        try:
            status = step()
        except Exception as e:
            # The class name only: exception text can embed request or token data.
            status = f"error:{type(e).__name__}"
        failed = failed or status.startswith(("auth_failed", "error", "team_mismatch"))
        print(f"{team_id} {status}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
