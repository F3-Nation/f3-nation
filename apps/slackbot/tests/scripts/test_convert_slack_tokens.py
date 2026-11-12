import time
from datetime import datetime, timedelta, timezone

import pytest
from cryptography.fernet import Fernet
from f3_data_models.models import Base, SlackSpace
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from sqlalchemy import select
from sqlalchemy.orm import Session

from scripts import convert_slack_tokens as converter
from tests import postgres_fixture
from utilities.slack_tokens import refresh
from utilities.slack_tokens.crypto import decrypt_refresh_token

pytestmark = postgres_fixture.requires_postgres
isolated_postgres = postgres_fixture.isolated_postgres

LONG_LIVED = "xoxb-long-lived"
ROTATING = "xoxb-rotating"
EXCHANGED = "xoxe.xoxb-exchanged"
EXCHANGED_REFRESH = "xoxe-1-exchanged"


@pytest.fixture
def postgres_schema():
    def create(engine):
        Base.metadata.tables["slack_spaces"].create(engine)

    return create


@pytest.fixture(autouse=True)
def slack_env(monkeypatch):
    monkeypatch.setenv("SLACK_TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("SLACK_CLIENT_ID", "client-id")
    monkeypatch.setenv("SLACK_CLIENT_SECRET", "client-secret")


class FakeExchange:
    def __init__(self, error=None):
        self.error = error
        self.tokens = []

    def __call__(self, client, *, token, client_id, client_secret):
        assert (client_id, client_secret) == ("client-id", "client-secret")
        self.tokens.append(token)
        if self.error:
            raise SlackApiError("secret-bearing message " + token, {"ok": False, "error": self.error})
        return {
            "ok": True,
            "access_token": EXCHANGED,
            "refresh_token": EXCHANGED_REFRESH,
            "expires_in": 43200,
            "token_type": "bot",
            "scope": "chat:write,users:read",
            "bot_user_id": "U_NEW",
        }


@pytest.fixture
def exchange(monkeypatch):
    fake = FakeExchange()

    def oauth_v2_exchange(self, **kwargs):
        return fake(self, **kwargs)

    monkeypatch.setattr(WebClient, "oauth_v2_exchange", oauth_v2_exchange)
    return fake


def _seed(engine, team_id, *, token=LONG_LIVED, expires_in=None):
    with Session(engine) as session:
        session.add(
            SlackSpace(
                team_id=team_id,
                workspace_name="W",
                bot_token=token,
                bot_id="B_OLD",
                bot_user_id="U_OLD",
                bot_scopes="chat:write",
                bot_token_expires_at=None if expires_in is None else datetime.now(timezone.utc) + expires_in,
            )
        )
        session.commit()


def _row(engine, team_id):
    with Session(engine) as session:
        row = session.scalars(select(SlackSpace).where(SlackSpace.team_id == team_id)).one()
        return (row.bot_token, row.bot_token_expires_at, row.bot_refresh_token_encrypted)


def _assert_converted(engine, team_id):
    token, expires_at, ciphertext = _row(engine, team_id)
    assert token == EXCHANGED
    assert abs(expires_at.timestamp() - (time.time() + 43200)) < 60
    assert ciphertext != EXCHANGED_REFRESH
    assert decrypt_refresh_token(ciphertext) == EXCHANGED_REFRESH


def test_converts_non_rotating_row(isolated_postgres, exchange, capsys):
    _seed(isolated_postgres, "T1")

    assert converter.main(["--team-id", "T1"]) == 0

    assert capsys.readouterr().out.splitlines() == ["T1 converted"]
    assert exchange.tokens == [LONG_LIVED]
    _assert_converted(isolated_postgres, "T1")


def test_skips_rotating_row(isolated_postgres, exchange, capsys):
    _seed(isolated_postgres, "T2", token=ROTATING, expires_in=timedelta(hours=5))
    before = _row(isolated_postgres, "T2")

    assert converter.main(["--team-id", "T2"]) == 0

    assert capsys.readouterr().out.splitlines() == ["T2 skipped"]
    assert exchange.tokens == []
    assert _row(isolated_postgres, "T2") == before


def test_failure_leaves_row_and_exits_1(isolated_postgres, exchange, capsys):
    _seed(isolated_postgres, "T3")
    _seed(isolated_postgres, "T4")
    exchange.error = "invalid_auth"

    assert converter.main(["--team-id", "T3", "--team-id", "T4"]) == 1

    assert capsys.readouterr().out.splitlines() == ["T3 failed:invalid_auth", "T4 failed:invalid_auth"]
    assert _row(isolated_postgres, "T3") == (LONG_LIVED, None, None)


def test_unknown_team_fails(isolated_postgres, exchange, capsys):
    assert converter.main(["--team-id", "T_MISSING"]) == 1

    assert capsys.readouterr().out.splitlines() == ["T_MISSING failed:no_token"]
    assert exchange.tokens == []


def test_already_exchanged_reports_needs_reinstall(isolated_postgres, exchange, capsys):
    _seed(isolated_postgres, "T5")
    exchange.error = "token_already_exchanged"

    assert converter.main(["--team-id", "T5"]) == 1

    assert capsys.readouterr().out.splitlines() == ["T5 needs_reinstall"]
    assert _row(isolated_postgres, "T5") == (LONG_LIVED, None, None)


def _failing_flush(monkeypatch, failures):
    real_flush = refresh._flush
    calls = []

    def flush(session, team_id, path):
        calls.append(path)
        if failures is None or len(calls) <= failures:
            raise refresh.TokenSaveError("saving the bot token failed with OperationalError")
        real_flush(session, team_id, path)

    monkeypatch.setattr(refresh, "_flush", flush)
    return calls


def test_save_failure_after_exchange_retries_save_only(isolated_postgres, exchange, monkeypatch, capsys):
    _seed(isolated_postgres, "T6")
    calls = _failing_flush(monkeypatch, failures=2)

    assert converter.main(["--team-id", "T6"]) == 0

    assert capsys.readouterr().out.splitlines() == ["T6 converted"]
    assert exchange.tokens == [LONG_LIVED]
    assert len(calls) == 3
    _assert_converted(isolated_postgres, "T6")


def test_save_failure_every_time_reports_needs_reinstall(isolated_postgres, exchange, monkeypatch, capsys):
    _seed(isolated_postgres, "T7")
    calls = _failing_flush(monkeypatch, failures=None)

    assert converter.main(["--team-id", "T7"]) == 1

    assert capsys.readouterr().out.splitlines() == ["T7 needs_reinstall"]
    assert exchange.tokens == [LONG_LIVED]
    assert len(calls) == 3
    assert _row(isolated_postgres, "T7") == (LONG_LIVED, None, None)


def test_commit_failure_after_exchange_retries_save_only(isolated_postgres, exchange, monkeypatch, capsys):
    _seed(isolated_postgres, "T8")
    commits = []
    real_commit = Session.commit

    def commit(self):
        commits.append(1)
        if len(commits) == 1:
            raise RuntimeError("commit lost")
        real_commit(self)

    monkeypatch.setattr(Session, "commit", commit)

    assert converter.main(["--team-id", "T8"]) == 0

    assert capsys.readouterr().out.splitlines() == ["T8 converted"]
    assert exchange.tokens == [LONG_LIVED]
    _assert_converted(isolated_postgres, "T8")


def test_limit_caps_batch(isolated_postgres, exchange, capsys):
    _seed(isolated_postgres, "T_A")
    _seed(isolated_postgres, "T_B", token=ROTATING, expires_in=timedelta(hours=5))
    _seed(isolated_postgres, "T_C")
    _seed(isolated_postgres, "T_D")
    _seed(isolated_postgres, "T_E", token=None)

    assert converter.main(["--all", "--limit", "2"]) == 0

    assert capsys.readouterr().out.splitlines() == ["T_A converted", "T_C converted"]
    assert exchange.tokens == [LONG_LIVED, LONG_LIVED]
    assert _row(isolated_postgres, "T_D") == (LONG_LIVED, None, None)


def test_all_requires_limit():
    with pytest.raises(SystemExit):
        converter.main(["--all"])
    with pytest.raises(SystemExit):
        converter.main(["--team-id", "T1", "--all", "--limit", "1"])


def test_dry_run_calls_nothing_and_writes_nothing(isolated_postgres, exchange, capsys):
    _seed(isolated_postgres, "T9")
    _seed(isolated_postgres, "T10", token=ROTATING, expires_in=timedelta(hours=5))

    assert converter.main(["--team-id", "T9", "--team-id", "T10", "--dry-run"]) == 0
    assert converter.main(["--all", "--limit", "5", "--dry-run"]) == 0

    assert capsys.readouterr().out.splitlines() == ["T9 would_convert", "T10 skipped", "T9 would_convert"]
    assert exchange.tokens == []
    assert _row(isolated_postgres, "T9") == (LONG_LIVED, None, None)


def test_never_prints_tokens(isolated_postgres, exchange, monkeypatch, capsys):
    _seed(isolated_postgres, "T11")
    converter.main(["--team-id", "T11"])
    _seed(isolated_postgres, "T12")
    _failing_flush(monkeypatch, failures=None)
    converter.main(["--team-id", "T12"])
    _seed(isolated_postgres, "T13")
    exchange.error = "invalid_auth"
    converter.main(["--team-id", "T13"])

    captured = capsys.readouterr()
    output = captured.out + captured.err
    assert "xox" not in output
    assert "secret-bearing" not in output
    assert "client-secret" not in output
