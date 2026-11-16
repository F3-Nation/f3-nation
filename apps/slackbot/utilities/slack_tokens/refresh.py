"""Refreshes Slack bot tokens and guards every write to a workspace's token fields.

Token columns are written only by `utilities/slack_tokens` and the operator
CLIs in `scripts/`, always through `save_bot_locked` or `locked_row`, so every
write runs in one transaction holding a per-workspace `pg_advisory_xact_lock`.
Slack revokes access tokens from earlier refreshes and accepts concurrent
refreshes, so two unserialized refreshes can each save a token the other just
revoked. The transaction-scoped lock is released by commit or rollback, so a
pooled connection never keeps it after an exception.

`refresh_if_needed` is the only caller of `decrypt_refresh_token`. Every `Bot`
this module returns has `bot_refresh_token=None`.
"""

import logging
import os
import re
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator, Optional, Tuple

from f3_data_models.models import SlackSpace
from f3_data_models.utils import session_scope
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError, SlackTokenRotationError
from slack_sdk.oauth.installation_store import Bot
from slack_sdk.oauth.token_rotation import TokenRotator
from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from sqlalchemy.orm import Session

from utilities import constants
from utilities.slack_tokens.crypto import TokenDecryptError, decrypt_refresh_token, encrypt_refresh_token

logger = logging.getLogger(__name__)

STORE_WINDOW_MINUTES = 120
SWEEP_WINDOW_MINUTES = 180

_LOCK_TIMEOUT_PGCODE = "55P03"


class TokenLockTimeout(Exception):
    """Another process held the workspace's token lock past `lock_timeout`."""


class TokenSaveError(Exception):
    """The database rejected a token write; the transaction rolled back."""


class TokenChanged(Exception):
    """The row's token no longer matches the one the caller read; nothing was written."""


# slack_sdk logs every request and response body at DEBUG; for `oauth.v2.access`
# those hold the refresh token and the new tokens. The SDK checks its logger's
# own level, so this logger is pinned above DEBUG whatever `LOG_LEVEL` sets.
_rotation_http_logger = logging.getLogger(__name__ + ".rotation_http")
_rotation_http_logger.setLevel(logging.INFO)


def _rotator() -> TokenRotator:
    return TokenRotator(
        client_id=os.environ[constants.SLACK_CLIENT_ID],
        client_secret=os.environ[constants.SLACK_CLIENT_SECRET],
        client=WebClient(logger=_rotation_http_logger),
    )


def _log(level: int, event: str, team_id: str, **fields) -> None:
    logger.log(level, event, extra={"json_fields": {"event": event, "team_id": team_id, **fields}})


def _error_fields(error: Exception) -> dict:
    """The exception type and Slack error code only: slack_sdk messages can embed request data."""
    name = type(error).__name__
    fields = {"error_type": name if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", name) else "Exception"}
    api_error = error.api_error if isinstance(error, SlackTokenRotationError) else error
    if isinstance(api_error, SlackApiError):
        code = getattr(api_error.response, "get", lambda _key: None)("error")
        if isinstance(code, str) and re.fullmatch(r"[a-z0-9_]{1,64}", code):
            fields["error_code"] = code
    return fields


def log_refresh_failure(team_id: str, error: Exception, *, path: str) -> None:
    """Log `slack.token.refresh_failed` at ERROR with the error's type and Slack error code only."""
    _log(logging.ERROR, "slack.token.refresh_failed", team_id, path=path, **_error_fields(error))


def _to_epoch(value: Optional[datetime]) -> Optional[int]:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return int(value.timestamp())


def _to_datetime(epoch: Optional[int]) -> Optional[datetime]:
    return None if epoch is None else datetime.fromtimestamp(epoch, tz=timezone.utc)


def _bot_from_row(row: SlackSpace) -> Bot:
    created = row.created or datetime.now(timezone.utc)
    if created.tzinfo is None:
        # `created` is stored as naive UTC.
        created = created.replace(tzinfo=timezone.utc)
    return Bot(
        team_id=row.team_id,
        team_name=row.workspace_name,
        bot_token=row.bot_token,
        bot_id=row.bot_id,
        bot_user_id=row.bot_user_id,
        bot_scopes=row.bot_scopes or "",
        bot_refresh_token=None,
        bot_token_expires_at=_to_epoch(row.bot_token_expires_at),
        installed_at=created,
    )


@contextmanager
def _locked(team_id: str) -> Iterator[Tuple[Session, Optional[SlackSpace]]]:
    with session_scope() as session:
        session.execute(text("SET LOCAL lock_timeout = '5s'"))
        try:
            session.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"),
                {"k": "slack_token:" + team_id},
            )
        except OperationalError as e:
            if getattr(e.orig, "pgcode", None) == _LOCK_TIMEOUT_PGCODE:
                raise TokenLockTimeout(team_id) from None
            raise
        row = session.scalars(select(SlackSpace).where(SlackSpace.team_id == team_id)).one_or_none()
        yield session, row


@contextmanager
def locked_row(team_id: str) -> Iterator[Optional[SlackSpace]]:
    """Yield the workspace row inside a transaction holding its token lock.

    Changes to the row commit when the block exits normally and roll back if it
    raises. Raises `TokenLockTimeout` if the lock isn't acquired in time.
    """
    with _locked(team_id) as (_session, row):
        yield row


def _guard_allows(row: SlackSpace, bot: Bot) -> bool:
    """A null stored expiry never blocks; a rotating token is replaced only by one expiring no earlier."""
    stored = _to_epoch(row.bot_token_expires_at)
    if stored is None:
        return True
    return bot.bot_token_expires_at is not None and bot.bot_token_expires_at >= stored


def _write(row: SlackSpace, bot: Bot) -> None:
    row.bot_token = bot.bot_token
    # Bolt's request context carries no scopes and may lack IDs; keep stored values then.
    if bot.bot_id:
        row.bot_id = bot.bot_id
    if bot.bot_user_id:
        row.bot_user_id = bot.bot_user_id
    if bot.bot_scopes:
        row.bot_scopes = ",".join(bot.bot_scopes)
    row.bot_token_expires_at = _to_datetime(bot.bot_token_expires_at)
    row.bot_refresh_token_encrypted = (
        encrypt_refresh_token(bot.bot_refresh_token) if bot.bot_refresh_token is not None else None
    )


def _flush(session: Session, team_id: str, path: str) -> None:
    """Send the token write now, so a database failure is logged and sanitized here.

    SQLAlchemy's exception text includes the bound parameters, which here are
    the token and refresh-token ciphertext. The replacement error is raised
    outside the `except` block so the original is neither its cause nor its
    context.
    """
    failure = None
    try:
        session.flush()
    except SQLAlchemyError as e:
        failure = _error_fields(e)
    if failure is not None:
        _log(logging.ERROR, "slack.token.refresh_failed", team_id, path=path, **failure)
        raise TokenSaveError(f"saving the bot token failed with {failure['error_type']}")


_ANY_TOKEN = object()


def save_bot_locked(
    bot: Bot,
    *,
    team_id: str,
    workspace_name: Optional[str] = None,
    expected_token: object = _ANY_TOKEN,
) -> bool:
    """Write the bot's token fields under the workspace lock, creating the row if needed.

    Returns False without writing when the save guard rejects the token.
    With `expected_token` (a token string, or None for "no row or no token"),
    raises `TokenChanged` without writing if the row no longer holds it.
    Raises `TokenSaveError` if the database rejects the write.
    `workspace_name` is written only when the row is created.
    """
    with _locked(team_id) as (session, row):
        if expected_token is not _ANY_TOKEN and (row.bot_token if row is not None else None) != expected_token:
            raise TokenChanged(team_id)
        if row is None:
            row = SlackSpace(team_id=team_id, workspace_name=workspace_name)
            session.add(row)
        elif not _guard_allows(row, bot):
            return False
        _write(row, bot)
        _flush(session, team_id, "save_bot_locked")
        return True


def load_bot(team_id: str) -> Optional[Bot]:
    """Read the stored token without locking, refreshing or decrypting."""
    with session_scope() as session:
        row = session.scalars(select(SlackSpace).where(SlackSpace.team_id == team_id)).one_or_none()
        if row is None or not row.bot_token:
            return None
        return _bot_from_row(row)


def _due(bot: Bot, minutes_before_expiration: int) -> bool:
    """Whether a rotating token expires within the window; a null expiry never does."""
    expires_at = bot.bot_token_expires_at
    return expires_at is not None and expires_at <= time.time() + minutes_before_expiration * 60


def refresh_if_needed(team_id: str, *, minutes_before_expiration: int, path: str) -> Optional[Bot]:
    """Return the workspace's bot, refreshing it first if it expires within the window.

    A token with no expiry or outside the window is returned from an unlocked
    read, so most calls never wait on the lock. Otherwise lock, re-read,
    refresh if still due, write and commit all happen in one transaction, so a
    process that waited on the lock sees the token the other one saved and
    doesn't call Slack again.

    Raises `TokenSaveError` if saving the refreshed token fails. Slack has
    already issued the new token by then, and it is lost with the rollback.
    """
    unlocked = load_bot(team_id)
    if unlocked is None or not _due(unlocked, minutes_before_expiration):
        return unlocked
    try:
        with _locked(team_id) as (session, row):
            if row is None or not row.bot_token:
                return None
            stored = _bot_from_row(row)
            if not _due(stored, minutes_before_expiration):
                return stored

            try:
                if row.bot_refresh_token_encrypted is None:
                    raise TokenDecryptError("no refresh token is stored for a rotating bot token")
                refresh_token = decrypt_refresh_token(row.bot_refresh_token_encrypted)
            except TokenDecryptError:
                _log(logging.ERROR, "slack.token.decrypt_failed", team_id, path=path)
                raise

            rotating = _bot_from_row(row)
            rotating.bot_refresh_token = refresh_token
            try:
                rotated = _rotator().perform_bot_token_rotation(
                    bot=rotating, minutes_before_expiration=minutes_before_expiration
                )
            except Exception as e:
                log_refresh_failure(team_id, e, path=path)
                raise
            if rotated is None:
                return stored
            if rotated.bot_refresh_token is None:
                rotated.bot_refresh_token = refresh_token
            if not _guard_allows(row, rotated):
                _log(logging.WARNING, "slack.token.save_refused", team_id, path=path)
                return stored
            _write(row, rotated)
            _flush(session, team_id, path)
            _log(logging.INFO, "slack.token.refreshed", team_id, path=path)
            return _bot_from_row(row)
    except TokenLockTimeout:
        _log(logging.WARNING, "slack.token.lock_timeout", team_id, path=path)
        return load_bot(team_id)
