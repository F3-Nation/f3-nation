"""Convert workspaces' long-lived bot tokens to rotating ones with `oauth.v2.exchange`.

Conversion can't be undone, and Slack exchanges a token only once: a
workspace whose exchange response is lost before it is saved has to reinstall
the app. Run it only once all of these hold:

- token rotation is enabled on the Slack app;
- no row's `settings` JSON holds a `bot_token` key, so no long-lived copy of
  the token is left readable in the database (rows that still do are reported
  as `blocked:settings_token`);
- the GCS installation files have been imported and deleted;
- on production, staging has run on rotating tokens for its soak period.

    python scripts/convert_slack_tokens.py (--team-id T... [--team-id T...] | --all --limit N [--after T...])
        [--apply --database NAME]

Without `--apply` it is a dry run: it calls nothing and writes nothing, and
reports what it would do. `--apply` also needs `--database NAME`, which must
equal the `DATABASE_SCHEMA` the script is connected to, so a run can't convert
a database the operator didn't name. Before the first exchange, `--apply`
checks that `SLACK_TOKEN_ENCRYPTION_KEY` can encrypt and decrypt, and exits 2
without calling Slack if it can't.

`--all --limit N` converts at most N non-rotating workspaces whose `settings`
JSON holds no `bot_token`, in team ID order, starting after `--after` if
given. It ends by printing `next: --after <last team ID>` to stderr, so the
next batch can start past rows this batch couldn't convert.

Each workspace is converted in its own transaction holding its token lock; the
exchange is the last step before the write. Each workspace prints one line,
`<team_id> <status>`:

- `converted`: the rotating token, its expiry and the encrypted refresh token
  are committed.
- `skipped`: the row already holds a rotating token.
- `superseded`: the exchange succeeded and its first save failed, and before
  the save was retried a reinstall replaced the row's token. The reinstall's
  credentials are kept, the exchange result is dropped, and
  `slack.token.exchange_superseded` is logged at WARNING.
- `blocked:settings_token`: the row's `settings` JSON holds a `bot_token`, or
  isn't a JSON object; nothing is exchanged and the row is unchanged.
- `would_convert`: dry run only; the row would be exchanged.
- `failed:<slack error code>`: Slack rejected the exchange; the row is
  unchanged. `failed:no_token` means there is no row or no stored token.
- `needs_reinstall`: Slack says the token was already exchanged, the exchange
  response lacked a token field, or the exchange succeeded and saving its
  result failed three times. This run doesn't call the exchange again for the
  workspace, and logs `slack.token.exchange_lost` at ERROR. The row keeps its
  old token, so a later run gets `token_already_exchanged` and reports
  `needs_reinstall` again. It recovers by reinstalling the app.
- `error:<exception class>`: anything else failed before the exchange
  returned, such as a lock timeout, a network error, or a Slack response with
  no error code (an HTTP 5xx or a non-JSON body) or with a server-side code
  (`fatal_error`, `internal_error`, `request_timeout`, `service_unavailable`).
  If the error came from the exchange call itself, Slack may still have
  exchanged the token.

Exits 1 if any workspace is `blocked`, `failed`, `needs_reinstall` or `error`.
Tokens are never printed or logged.
"""

import argparse
import logging
import os
import re
import sys
import time
from typing import Optional

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
from f3_data_models.models import SlackSpace
from f3_data_models.utils import session_scope
from slack_sdk.errors import SlackApiError
from slack_sdk.oauth.installation_store import Bot
from sqlalchemy import and_, func, or_, select

from utilities import constants
from utilities.slack_tokens.crypto import TokenDecryptError, decrypt_refresh_token, encrypt_refresh_token
from utilities.slack_tokens.refresh import (
    TokenChanged,
    TokenSaveError,
    locked_row,
    log_refresh_failure,
    oauth_web_client,
    save_bot_locked,
    write_locked_row,
)

logger = logging.getLogger(__name__)

SAVE_RETRIES = 2
_PATH = "convert_slack_tokens"
_REQUIRED_RESPONSE_FIELDS = ("access_token", "refresh_token", "expires_in")
_SLACK_ERROR_CODE = re.compile(r"[a-z][a-z0-9_]{0,63}")
# Slack's server-side failures, which it can return with HTTP 200 after part of
# the operation succeeded, so the token may already be exchanged.
_MAYBE_EXCHANGED_CODES = frozenset({"fatal_error", "internal_error", "request_timeout", "service_unavailable"})


class ExchangeResponseError(Exception):
    """The exchange succeeded but its response lacks a field needed to save the new token."""


def _without_settings_token():
    """Settings is SQL NULL, JSON null, or a JSON object without a non-null `bot_token`.

    Extracting a key from a JSON array or scalar yields NULL, so the type
    check keeps those rows, which `_convert_team` blocks, out of `--all`
    batches and in the blocked count. JSON null is how SQLAlchemy stores a
    Python `None`, which `_convert_team` allows.
    """
    return or_(
        SlackSpace.settings.is_(None),
        and_(
            func.jsonb_typeof(SlackSpace.settings).in_(("object", "null")),
            SlackSpace.settings["bot_token"].astext.is_(None),
        ),
    )


def _non_rotating():
    return (SlackSpace.bot_token.is_not(None), SlackSpace.bot_token != "", SlackSpace.bot_token_expires_at.is_(None))


def _non_rotating_team_ids(limit: int, after: Optional[str]) -> list[str]:
    query = select(SlackSpace.team_id).where(*_non_rotating()).where(_without_settings_token())
    if after is not None:
        query = query.where(SlackSpace.team_id > after)
    with session_scope() as session:
        return list(session.scalars(query.order_by(SlackSpace.team_id).limit(limit)))


def _blocked_count() -> int:
    with session_scope() as session:
        return session.scalar(
            select(func.count()).select_from(SlackSpace).where(*_non_rotating()).where(~_without_settings_token())
        )


def _encryption_key_works() -> bool:
    try:
        return decrypt_refresh_token(encrypt_refresh_token("probe")) == "probe"
    except TokenDecryptError:
        return False


def _slack_error_status(error: SlackApiError) -> str:
    response = error.response
    code = response.get("error") if response is not None else None
    status = getattr(response, "status_code", None)
    if (
        not isinstance(code, str)
        # The SDK stores a non-JSON body's text here; it must never be printed.
        or not _SLACK_ERROR_CODE.fullmatch(code)
        or code in _MAYBE_EXCHANGED_CODES
        or (isinstance(status, int) and status >= 500)
    ):
        # No Slack error code, or a server-side failure: Slack may have exchanged the token.
        return "error:SlackApiError"
    if code == "token_already_exchanged":
        return "needs_reinstall"
    return f"failed:{code}"


def _bot_from_exchange(team_id: str, row: SlackSpace, response) -> Bot:
    for field in _REQUIRED_RESPONSE_FIELDS:
        if not response.get(field):
            raise ExchangeResponseError(field)
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


def _log_exchange_lost(team_id: str, reason: str) -> None:
    event = "slack.token.exchange_lost"
    logger.error(event, extra={"json_fields": {"event": event, "team_id": team_id, "path": _PATH, "reason": reason}})


def _save_retry(team_id: str, bot: Bot, exchanged_token: str) -> str:
    """Save an exchange result that the locked write lost, without calling Slack again.

    Saves only while the row still holds `exchanged_token`, the long-lived token
    that was exchanged. The failed write released the lock, so a reinstall may
    have saved new credentials since; those are kept and the exchange result is
    dropped.
    """
    for _ in range(SAVE_RETRIES):
        try:
            if save_bot_locked(bot, team_id=team_id, expected_token=exchanged_token):
                return "converted"
        except TokenChanged:
            event = "slack.token.exchange_superseded"
            logger.warning(event, extra={"json_fields": {"event": event, "team_id": team_id, "path": _PATH}})
            return "superseded"
        except TokenSaveError:
            # `save_bot_locked` has already logged it.
            pass
        except Exception as e:
            # Logs the error type only: the exception text can embed the token.
            log_refresh_failure(team_id, e, path=f"{_PATH}.save_retry")
    _log_exchange_lost(team_id, "save_failed")
    return "needs_reinstall"


def _convert_team(team_id: str, apply: bool) -> str:
    bot: Optional[Bot] = None
    exchanged_token = ""
    try:
        with locked_row(team_id) as row:
            if row is None or not row.bot_token:
                return "failed:no_token"
            if row.bot_token_expires_at is not None:
                return "skipped"
            if row.settings is not None and (
                not isinstance(row.settings, dict) or row.settings.get("bot_token") is not None
            ):
                # A long-lived copy of the token must not stay readable in the database.
                return "blocked:settings_token"
            if not apply:
                return "would_convert"
            exchanged_token = row.bot_token
            try:
                # No retry handlers: a retried request after a dropped connection
                # could exchange the token a second time.
                response = oauth_web_client(retry_handlers=[]).oauth_v2_exchange(
                    client_id=os.environ[constants.SLACK_CLIENT_ID],
                    client_secret=os.environ[constants.SLACK_CLIENT_SECRET],
                    token=row.bot_token,
                )
            except SlackApiError as e:
                status = _slack_error_status(e)
                if status == "needs_reinstall":
                    _log_exchange_lost(team_id, "token_already_exchanged")
                return status
            try:
                bot = _bot_from_exchange(team_id, row, response)
            except ExchangeResponseError as e:
                _log_exchange_lost(team_id, f"missing_{e}")
                return "needs_reinstall"
            if not write_locked_row(row, bot, path=_PATH):
                # The expiry was null under this lock, so the guard can't refuse.
                # Never drop tokens Slack has already issued.
                raise RuntimeError("save guard refused an exchanged token")
        # Reached only after `locked_row` committed the write.
        return "converted"
    except Exception as e:
        if bot is None:
            raise
        if not isinstance(e, TokenSaveError):
            # A failed commit, or the guard refusal above; `write_locked_row` logs its own flush failures.
            log_refresh_failure(team_id, e, path=_PATH)
        # Slack has already exchanged the long-lived token and would refuse a
        # second exchange, so only the save is retried.
        return _save_retry(team_id, bot, exchanged_token)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--team-id", action="append", dest="team_ids", metavar="TEAM_ID")
    target.add_argument("--all", action="store_true", help="convert non-rotating workspaces, up to --limit")
    parser.add_argument("--limit", type=int, help="the most workspaces --all converts (required with --all)")
    parser.add_argument("--after", metavar="TEAM_ID", help="with --all, start after this team ID")
    parser.add_argument("--apply", action="store_true", help="call Slack and write; without it, a dry run")
    parser.add_argument("--database", metavar="NAME", help="with --apply, must equal DATABASE_SCHEMA")
    args = parser.parse_args(argv)
    if args.all and (args.limit is None or args.limit < 1):
        parser.error("--all requires --limit N with N >= 1")
    if not args.all and (args.limit is not None or args.after is not None):
        parser.error("--limit and --after apply only to --all")
    if args.apply and (not args.database or args.database != os.environ.get("DATABASE_SCHEMA")):
        parser.error("--apply requires --database NAME matching DATABASE_SCHEMA")
    if not args.apply and args.database is not None:
        parser.error("--database applies only to --apply")
    if args.apply and not _encryption_key_works():
        print("SLACK_TOKEN_ENCRYPTION_KEY can't encrypt refresh tokens; nothing was exchanged", file=sys.stderr)
        return 2

    if not args.apply:
        print("dry run: pass --apply --database NAME to convert", file=sys.stderr)
    team_ids = _non_rotating_team_ids(args.limit, args.after) if args.all else list(dict.fromkeys(args.team_ids))
    failed = False
    for team_id in team_ids:
        try:
            status = _convert_team(team_id, args.apply)
        except Exception as e:
            # The class name only: exception text can embed request or token data.
            status = f"error:{type(e).__name__}"
        failed = failed or status.startswith(("blocked", "failed", "needs_reinstall", "error"))
        print(f"{team_id} {status}")
    if args.all:
        blocked = _blocked_count()
        if blocked:
            print(
                f"{blocked} workspace(s) not selected: settings JSON holds a bot_token or isn't an object",
                file=sys.stderr,
            )
        if team_ids:
            print(f"next: --after {team_ids[-1]}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
