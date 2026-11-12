import logging
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest
from cryptography.fernet import Fernet
from f3_data_models.models import Base, SlackSpace
from slack_sdk.errors import SlackApiError, SlackTokenRotationError
from slack_sdk.oauth.installation_store import Bot
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from tests import postgres_fixture
from utilities.slack_tokens import refresh
from utilities.slack_tokens.crypto import TokenDecryptError, decrypt_refresh_token, encrypt_refresh_token

pytestmark = postgres_fixture.requires_postgres
isolated_postgres = postgres_fixture.isolated_postgres

TEAM_ID = "T_ROTATE"
STORED_TOKEN = "xoxb-stored"
STORED_REFRESH = "xoxe-1-stored"
NEW_TOKEN = "xoxb-new"
NEW_REFRESH = "xoxe-1-new"


@pytest.fixture
def postgres_schema():
    def create(engine):
        Base.metadata.tables["slack_spaces"].create(engine)

    return create


@pytest.fixture(autouse=True)
def encryption_key(monkeypatch):
    key = Fernet.generate_key().decode()
    monkeypatch.setenv("SLACK_TOKEN_ENCRYPTION_KEY", key)
    return key


class FakeRotator:
    def __init__(self, delay=0.0, error=None):
        self.calls = 0
        self.received_refresh_tokens = []
        self.delay = delay
        self.error = error
        self._lock = threading.Lock()

    def perform_bot_token_rotation(self, *, bot, minutes_before_expiration):
        with self._lock:
            self.calls += 1
            self.received_refresh_tokens.append(bot.bot_refresh_token)
        time.sleep(self.delay)
        if self.error is not None:
            raise self.error
        return Bot(
            team_id=bot.team_id,
            bot_token=NEW_TOKEN,
            bot_id=bot.bot_id,
            bot_user_id=bot.bot_user_id,
            bot_scopes=bot.bot_scopes,
            bot_refresh_token=NEW_REFRESH,
            bot_token_expires_at=int(time.time()) + 12 * 3600,
            installed_at=bot.installed_at,
        )


@pytest.fixture
def rotator(monkeypatch):
    fake = FakeRotator()
    monkeypatch.setattr(refresh, "_rotator", lambda: fake)
    return fake


def _now():
    return datetime.now(timezone.utc)


def _seed(engine, *, expires_in, refresh_token=STORED_REFRESH, token=STORED_TOKEN, ciphertext=None):
    with Session(engine) as session:
        session.add(
            SlackSpace(
                team_id=TEAM_ID,
                workspace_name="Rotation Test",
                bot_token=token,
                bot_id="B_ROTATE",
                bot_user_id="U_ROTATE",
                bot_scopes="chat:write,users:read",
                bot_token_expires_at=None if expires_in is None else _now() + expires_in,
                bot_refresh_token_encrypted=ciphertext
                if ciphertext is not None
                else (encrypt_refresh_token(refresh_token) if refresh_token is not None else None),
            )
        )
        session.commit()


def _row(engine, team_id=TEAM_ID):
    with Session(engine) as session:
        row = session.scalars(select(SlackSpace).where(SlackSpace.team_id == team_id)).one_or_none()
        if row is None:
            return None
        return {
            "workspace_name": row.workspace_name,
            "bot_token": row.bot_token,
            "bot_id": row.bot_id,
            "bot_user_id": row.bot_user_id,
            "bot_scopes": row.bot_scopes,
            "bot_token_expires_at": row.bot_token_expires_at,
            "bot_refresh_token_encrypted": row.bot_refresh_token_encrypted,
        }


def _offered(*, expires_at, token=NEW_TOKEN, refresh_token=NEW_REFRESH):
    return Bot(
        team_id=TEAM_ID,
        bot_token=token,
        bot_id="B_ROTATE",
        bot_user_id="U_ROTATE",
        bot_scopes="chat:write,users:read",
        bot_refresh_token=refresh_token,
        bot_token_expires_at=None if expires_at is None else int(expires_at.timestamp()),
        installed_at=time.time(),
    )


def _events(caplog):
    return [getattr(r, "json_fields", {}).get("event") for r in caplog.records]


def test_fresh_token_not_refreshed(isolated_postgres, rotator):
    _seed(isolated_postgres, expires_in=timedelta(hours=5))

    bot = refresh.refresh_if_needed(TEAM_ID, minutes_before_expiration=refresh.STORE_WINDOW_MINUTES, path="test")

    assert rotator.calls == 0
    assert bot.bot_token == STORED_TOKEN


def test_near_expiry_refreshes_and_persists(isolated_postgres, rotator, caplog):
    _seed(isolated_postgres, expires_in=timedelta(minutes=30))
    caplog.set_level(logging.INFO)

    bot = refresh.refresh_if_needed(TEAM_ID, minutes_before_expiration=refresh.STORE_WINDOW_MINUTES, path="test")

    assert rotator.calls == 1
    assert rotator.received_refresh_tokens == [STORED_REFRESH]
    row = _row(isolated_postgres)
    assert bot.bot_token == row["bot_token"] == NEW_TOKEN
    assert row["bot_token_expires_at"] > _now() + timedelta(hours=11)
    assert bot.bot_token_expires_at == int(row["bot_token_expires_at"].timestamp())
    assert decrypt_refresh_token(row["bot_refresh_token_encrypted"]) == NEW_REFRESH
    assert "slack.token.refreshed" in _events(caplog)
    assert all(NEW_TOKEN not in r.getMessage() and NEW_REFRESH not in r.getMessage() for r in caplog.records)


def test_concurrent_refresh_calls_slack_once(isolated_postgres, monkeypatch):
    _seed(isolated_postgres, expires_in=timedelta(minutes=30))
    fake = FakeRotator(delay=0.5)
    monkeypatch.setattr(refresh, "_rotator", lambda: fake)
    barrier = threading.Barrier(2)
    results = [None, None]
    errors = []

    def run(index):
        try:
            barrier.wait()
            results[index] = refresh.refresh_if_needed(
                TEAM_ID, minutes_before_expiration=refresh.STORE_WINDOW_MINUTES, path="test"
            )
        except Exception as e:  # surfaced by the assertion below
            errors.append(e)

    threads = [threading.Thread(target=run, args=(i,)) for i in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert errors == []
    assert fake.calls == 1
    row = _row(isolated_postgres)
    assert row["bot_token"] == NEW_TOKEN
    assert [r.bot_token for r in results] == [NEW_TOKEN, NEW_TOKEN]


def test_save_bot_rejects_earlier_expiry(isolated_postgres):
    _seed(isolated_postgres, expires_in=timedelta(hours=12))
    before = _row(isolated_postgres)

    saved = refresh.save_bot_locked(_offered(expires_at=_now() + timedelta(hours=11)), team_id=TEAM_ID)

    assert saved is False
    assert _row(isolated_postgres) == before


def test_save_bot_rejects_null_over_rotating(isolated_postgres):
    _seed(isolated_postgres, expires_in=timedelta(hours=12))
    before = _row(isolated_postgres)

    saved = refresh.save_bot_locked(_offered(expires_at=None, refresh_token=None), team_id=TEAM_ID)

    assert saved is False
    assert _row(isolated_postgres) == before


def test_save_over_null_expiry_writes_rotating_token(isolated_postgres):
    _seed(isolated_postgres, expires_in=None, refresh_token=None)
    expires_at = _now() + timedelta(hours=12)

    saved = refresh.save_bot_locked(_offered(expires_at=expires_at), team_id=TEAM_ID)

    assert saved is True
    row = _row(isolated_postgres)
    assert row["bot_token"] == NEW_TOKEN
    assert int(row["bot_token_expires_at"].timestamp()) == int(expires_at.timestamp())
    assert decrypt_refresh_token(row["bot_refresh_token_encrypted"]) == NEW_REFRESH
    assert row["workspace_name"] == "Rotation Test"


def test_save_later_expiry_replaces_rotating_token(isolated_postgres):
    _seed(isolated_postgres, expires_in=timedelta(hours=1))

    saved = refresh.save_bot_locked(_offered(expires_at=_now() + timedelta(hours=12)), team_id=TEAM_ID)

    assert saved is True
    row = _row(isolated_postgres)
    assert row["bot_token"] == NEW_TOKEN
    assert decrypt_refresh_token(row["bot_refresh_token_encrypted"]) == NEW_REFRESH


def test_save_creates_row_with_workspace_name(isolated_postgres):
    saved = refresh.save_bot_locked(
        _offered(expires_at=_now() + timedelta(hours=12)), team_id=TEAM_ID, workspace_name="New Workspace"
    )

    assert saved is True
    row = _row(isolated_postgres)
    assert row["workspace_name"] == "New Workspace"
    assert row["bot_token"] == NEW_TOKEN
    assert row["bot_scopes"] == "chat:write,users:read"
    assert decrypt_refresh_token(row["bot_refresh_token_encrypted"]) == NEW_REFRESH


def test_save_does_not_overwrite_workspace_name_on_update(isolated_postgres):
    _seed(isolated_postgres, expires_in=None, refresh_token=None)

    refresh.save_bot_locked(_offered(expires_at=None, refresh_token=None), team_id=TEAM_ID, workspace_name="Renamed")

    assert _row(isolated_postgres)["workspace_name"] == "Rotation Test"


def test_save_context_token_refused_on_rotating_row(isolated_postgres):
    _seed(isolated_postgres, expires_in=timedelta(hours=12))
    before = _row(isolated_postgres)

    saved = refresh.save_context_token(
        TEAM_ID, {"bot_token": "xoxb-context", "bot_id": "B_CTX", "bot_user_id": "U_CTX"}
    )

    assert saved is False
    assert _row(isolated_postgres) == before


def test_save_context_token_writes_non_rotating_row(isolated_postgres):
    _seed(isolated_postgres, expires_in=None, refresh_token=None)

    saved = refresh.save_context_token(
        TEAM_ID, {"bot_token": "xoxb-context", "bot_id": "B_CTX", "bot_user_id": "U_CTX"}
    )

    assert saved is True
    row = _row(isolated_postgres)
    assert row["bot_token"] == "xoxb-context"
    assert row["bot_id"] == "B_CTX"
    assert row["bot_user_id"] == "U_CTX"
    assert row["bot_token_expires_at"] is None
    assert row["bot_refresh_token_encrypted"] is None
    # Bolt's context carries no scopes, so the stored scopes are kept.
    assert row["bot_scopes"] == "chat:write,users:read"


def test_refresh_result_carries_no_refresh_token(isolated_postgres, rotator):
    _seed(isolated_postgres, expires_in=timedelta(minutes=30))

    refreshed = refresh.refresh_if_needed(TEAM_ID, minutes_before_expiration=refresh.STORE_WINDOW_MINUTES, path="test")
    loaded = refresh.load_bot(TEAM_ID)

    assert rotator.calls == 1
    assert refreshed.bot_refresh_token is None
    assert loaded.bot_refresh_token is None
    assert loaded.bot_token == NEW_TOKEN
    assert loaded.bot_token_expires_at == refreshed.bot_token_expires_at
    assert loaded.team_name == "Rotation Test"


def test_null_expiry_never_refreshes(isolated_postgres, rotator):
    _seed(isolated_postgres, expires_in=None, refresh_token=None)

    bot = refresh.refresh_if_needed(TEAM_ID, minutes_before_expiration=refresh.SWEEP_WINDOW_MINUTES, path="test")

    assert rotator.calls == 0
    assert bot.bot_token == STORED_TOKEN
    assert bot.bot_token_expires_at is None


def test_missing_row_or_token_returns_none(isolated_postgres, rotator):
    assert refresh.refresh_if_needed(TEAM_ID, minutes_before_expiration=120, path="test") is None
    assert refresh.load_bot(TEAM_ID) is None
    _seed(isolated_postgres, expires_in=None, token=None, refresh_token=None)
    assert refresh.refresh_if_needed(TEAM_ID, minutes_before_expiration=120, path="test") is None
    assert refresh.load_bot(TEAM_ID) is None
    assert rotator.calls == 0


def test_decrypt_failure_leaves_row(isolated_postgres, rotator, caplog):
    other_key = Fernet(Fernet.generate_key())
    _seed(
        isolated_postgres,
        expires_in=timedelta(minutes=30),
        ciphertext=other_key.encrypt(STORED_REFRESH.encode()).decode(),
    )
    before = _row(isolated_postgres)

    with pytest.raises(TokenDecryptError):
        refresh.refresh_if_needed(TEAM_ID, minutes_before_expiration=refresh.SWEEP_WINDOW_MINUTES, path="test")

    assert rotator.calls == 0
    assert _row(isolated_postgres) == before
    assert "slack.token.decrypt_failed" in _events(caplog)


def test_slack_error_leaves_row_and_logs_code(isolated_postgres, monkeypatch, caplog):
    _seed(isolated_postgres, expires_in=timedelta(minutes=30))
    before = _row(isolated_postgres)
    api_error = SlackApiError("oauth failed for xoxe-1-stored", {"ok": False, "error": "invalid_refresh_token"})
    fake = FakeRotator(error=SlackTokenRotationError(api_error))
    monkeypatch.setattr(refresh, "_rotator", lambda: fake)

    with pytest.raises(SlackTokenRotationError):
        refresh.refresh_if_needed(TEAM_ID, minutes_before_expiration=refresh.STORE_WINDOW_MINUTES, path="test")

    assert _row(isolated_postgres) == before
    failed = [r for r in caplog.records if getattr(r, "json_fields", {}).get("event") == "slack.token.refresh_failed"]
    assert len(failed) == 1
    assert failed[0].json_fields["error_code"] == "invalid_refresh_token"
    assert failed[0].json_fields["team_id"] == TEAM_ID
    assert all(STORED_REFRESH not in r.getMessage() for r in caplog.records)


def test_lock_timeout_returns_stored_token(isolated_postgres, rotator, caplog):
    _seed(isolated_postgres, expires_in=timedelta(minutes=30))
    with isolated_postgres.connect() as holder:
        holder.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"), {"k": "slack_token:" + TEAM_ID})

        bot = refresh.refresh_if_needed(TEAM_ID, minutes_before_expiration=refresh.STORE_WINDOW_MINUTES, path="test")

        holder.rollback()

    assert rotator.calls == 0
    assert bot.bot_token == STORED_TOKEN
    assert "slack.token.lock_timeout" in _events(caplog)


def _exception_chain_text(error):
    parts = []
    while error is not None:
        parts.append(str(error))
        error = error.__cause__ or error.__context__
    return " ".join(parts)


@contextmanager
def _row_lock_held(engine):
    # A writer that skips the advisory lock holds the row lock, so the token
    # UPDATE waits past `lock_timeout` and the database rejects it.
    with engine.connect() as holder:
        holder.execute(text("SELECT 1 FROM slack_spaces WHERE team_id = :t FOR UPDATE"), {"t": TEAM_ID})
        try:
            yield
        finally:
            holder.rollback()


def test_refresh_save_failure_is_logged_and_sanitized(isolated_postgres, rotator, caplog):
    _seed(isolated_postgres, expires_in=timedelta(minutes=30))
    before = _row(isolated_postgres)

    with _row_lock_held(isolated_postgres):
        with pytest.raises(refresh.TokenSaveError) as raised:
            refresh.refresh_if_needed(TEAM_ID, minutes_before_expiration=refresh.STORE_WINDOW_MINUTES, path="test")

    assert rotator.calls == 1
    assert _row(isolated_postgres) == before
    chain = _exception_chain_text(raised.value)
    assert NEW_TOKEN not in chain and "gAAAA" not in chain
    assert raised.value.__cause__ is None and raised.value.__context__ is None
    failed = [r for r in caplog.records if getattr(r, "json_fields", {}).get("event") == "slack.token.refresh_failed"]
    assert len(failed) == 1
    assert failed[0].json_fields["error_type"] == "OperationalError"
    assert all(NEW_TOKEN not in r.getMessage() and NEW_TOKEN not in str(r.json_fields) for r in failed)
    assert all(NEW_TOKEN not in r.getMessage() for r in caplog.records)


def test_save_bot_failure_is_logged_and_sanitized(isolated_postgres, caplog):
    _seed(isolated_postgres, expires_in=None, refresh_token=None)
    before = _row(isolated_postgres)

    with _row_lock_held(isolated_postgres):
        with pytest.raises(refresh.TokenSaveError) as raised:
            refresh.save_bot_locked(_offered(expires_at=_now() + timedelta(hours=12)), team_id=TEAM_ID)

    assert _row(isolated_postgres) == before
    assert NEW_TOKEN not in _exception_chain_text(raised.value)
    assert raised.value.__cause__ is None and raised.value.__context__ is None
    assert "slack.token.refresh_failed" in _events(caplog)
    assert all(NEW_TOKEN not in r.getMessage() for r in caplog.records)
