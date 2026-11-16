"""Re-encrypt stored Slack refresh tokens with the newest `SLACK_TOKEN_ENCRYPTION_KEY`.

To change the key, put the new key first and the old key second, deploy, run
this script, then run it with `--check` until it exits 0, and only then remove
the old key. A workspace whose refresh token only the removed key could decrypt
has to reinstall the app. The hourly sweep is not a substitute: it skips rows
that aren't near expiry.

    python scripts/rekey_slack_tokens.py [--check]

Without `--check`, each row with a refresh token is rewritten with the newest
key, in its own transaction holding the workspace's token lock. Only the
encrypted refresh token column changes, and Slack is never called. Each
workspace prints `<team_id> rekeyed` or `<team_id> failed:<exception class>`
(for example `TokenDecryptError` when no listed key decrypts the row, or
`TokenLockTimeout`); a failure leaves that row unchanged and the run goes on.
Exits 1 if any workspace failed.

With `--check`, nothing is locked or written. It prints `<team_id> old_key` for
each row the newest key alone can't decrypt, then `<count> not on the newest
key`, and exits 1 unless the count is 0.

Tokens, ciphertext and keys are never printed.
"""

import argparse
import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
from f3_data_models.models import SlackSpace
from f3_data_models.utils import session_scope
from sqlalchemy import select

from utilities.slack_tokens.crypto import decrypts_with_primary_key, reencrypt_refresh_token
from utilities.slack_tokens.refresh import locked_row


def _team_ids_with_refresh_token() -> list[str]:
    with session_scope() as session:
        return list(
            session.scalars(
                select(SlackSpace.team_id)
                .where(SlackSpace.bot_refresh_token_encrypted.is_not(None))
                .order_by(SlackSpace.team_id)
            )
        )


def _rekey_team(team_id: str) -> str:
    with locked_row(team_id) as row:
        # Re-read under the lock: the row may have been refreshed or removed since the listing.
        if row is None or row.bot_refresh_token_encrypted is None:
            return "skipped"
        row.bot_refresh_token_encrypted = reencrypt_refresh_token(row.bot_refresh_token_encrypted)
    return "rekeyed"


def _check() -> int:
    with session_scope() as session:
        rows = list(
            session.execute(
                select(SlackSpace.team_id, SlackSpace.bot_refresh_token_encrypted)
                .where(SlackSpace.bot_refresh_token_encrypted.is_not(None))
                .order_by(SlackSpace.team_id)
            )
        )
    stale = [team_id for team_id, ciphertext in rows if not decrypts_with_primary_key(ciphertext)]
    for team_id in stale:
        print(f"{team_id} old_key")
    print(f"{len(stale)} not on the newest key")
    return 1 if stale else 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--check", action="store_true", help="report rows the newest key can't decrypt; write nothing")
    args = parser.parse_args(argv)
    if args.check:
        return _check()

    failed = False
    for team_id in _team_ids_with_refresh_token():
        try:
            status = _rekey_team(team_id)
        except Exception as e:
            # The class name only: exception text can embed token or ciphertext data.
            status = f"failed:{type(e).__name__}"
        failed = failed or status.startswith("failed")
        if status != "skipped":
            print(f"{team_id} {status}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
