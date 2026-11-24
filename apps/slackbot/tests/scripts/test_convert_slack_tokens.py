import logging
import time
from datetime import datetime, timedelta, timezone
from urllib.error import URLError

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
DATABASE = "slackbot_test"
APPLY = ["--apply", "--database", DATABASE]


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
    monkeypatch.setenv("DATABASE_SCHEMA", DATABASE)


class FakeExchange:
    def __init__(self, error=None):
        self.error = error
        self.raises = None
        self.response = None
        self.tokens = []

    def __call__(self, client, *, token, client_id, client_secret):
        assert (client_id, client_secret) == ("client-id", "client-secret")
        # A retried HTTP request could exchange the token twice.
        assert client.retry_handlers == []
        # slack_sdk logs response bodies, which hold the new tokens, at DEBUG.
        assert client.logger.level > logging.DEBUG
        self.tokens.append(token)
        if self.raises is not None:
            raise self.raises
        if self.response is not None:
            return self.response
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


def _seed(engine, team_id, *, token=LONG_LIVED, expires_in=None, settings=None):
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
                settings=settings,
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

    assert converter.main(["--team-id", "T1", *APPLY]) == 0

    assert capsys.readouterr().out.splitlines() == ["T1 converted"]
    assert exchange.tokens == [LONG_LIVED]
    _assert_converted(isolated_postgres, "T1")


@pytest.mark.parametrize("dry_run", [False, True])
def test_settings_token_copy_blocks_conversion(isolated_postgres, exchange, capsys, dry_run):
    _seed(isolated_postgres, "T30", settings={"bot_token": LONG_LIVED, "region": "R"})
    _seed(isolated_postgres, "T31", settings={"bot_token": None, "region": "R"})
    before = _row(isolated_postgres, "T30")

    argv = ["--team-id", "T30", "--team-id", "T31"] + ([] if dry_run else APPLY)
    assert converter.main(argv) == 1

    expected_t31 = "would_convert" if dry_run else "converted"
    out = capsys.readouterr().out
    assert out.splitlines() == ["T30 blocked:settings_token", f"T31 {expected_t31}"]
    assert LONG_LIVED not in out
    assert exchange.tokens == ([] if dry_run else [LONG_LIVED])
    assert _row(isolated_postgres, "T30") == before


def test_skips_rotating_row(isolated_postgres, exchange, capsys):
    _seed(isolated_postgres, "T2", token=ROTATING, expires_in=timedelta(hours=5))
    before = _row(isolated_postgres, "T2")

    assert converter.main(["--team-id", "T2", *APPLY]) == 0

    assert capsys.readouterr().out.splitlines() == ["T2 skipped"]
    assert exchange.tokens == []
    assert _row(isolated_postgres, "T2") == before


def test_failure_leaves_row_and_exits_1(isolated_postgres, exchange, capsys):
    _seed(isolated_postgres, "T3")
    _seed(isolated_postgres, "T4")
    exchange.error = "invalid_auth"

    assert converter.main(["--team-id", "T3", "--team-id", "T4", *APPLY]) == 1

    assert capsys.readouterr().out.splitlines() == ["T3 failed:invalid_auth", "T4 failed:invalid_auth"]
    assert _row(isolated_postgres, "T3") == (LONG_LIVED, None, None)


def test_unknown_team_fails(isolated_postgres, exchange, capsys):
    assert converter.main(["--team-id", "T_MISSING", *APPLY]) == 1

    assert capsys.readouterr().out.splitlines() == ["T_MISSING failed:no_token"]
    assert exchange.tokens == []


def test_already_exchanged_reports_needs_reinstall(isolated_postgres, exchange, capsys):
    _seed(isolated_postgres, "T5")
    exchange.error = "token_already_exchanged"

    assert converter.main(["--team-id", "T5", *APPLY]) == 1

    assert capsys.readouterr().out.splitlines() == ["T5 needs_reinstall"]
    assert _row(isolated_postgres, "T5") == (LONG_LIVED, None, None)


def _failing_flush(monkeypatch, failures):
    real_flush = refresh._flush
    calls = []

    def flush(session, team_id, path, **kwargs):
        calls.append(path)
        if failures is None or len(calls) <= failures:
            raise refresh.TokenSaveError("saving the bot token failed with OperationalError")
        real_flush(session, team_id, path, **kwargs)

    monkeypatch.setattr(refresh, "_flush", flush)
    return calls


def test_save_failure_after_exchange_retries_save_only(isolated_postgres, exchange, monkeypatch, capsys):
    _seed(isolated_postgres, "T6")
    calls = _failing_flush(monkeypatch, failures=2)

    assert converter.main(["--team-id", "T6", *APPLY]) == 0

    assert capsys.readouterr().out.splitlines() == ["T6 converted"]
    assert exchange.tokens == [LONG_LIVED]
    assert len(calls) == 3
    _assert_converted(isolated_postgres, "T6")


def test_save_failure_every_time_reports_needs_reinstall(isolated_postgres, exchange, monkeypatch, capsys, caplog):
    _seed(isolated_postgres, "T7")
    calls = _failing_flush(monkeypatch, failures=None)

    with caplog.at_level(logging.ERROR):
        assert converter.main(["--team-id", "T7", *APPLY]) == 1

    assert capsys.readouterr().out.splitlines() == ["T7 needs_reinstall"]
    assert exchange.tokens == [LONG_LIVED]
    assert len(calls) == 3
    assert _row(isolated_postgres, "T7") == (LONG_LIVED, None, None)
    # `save_bot_locked` logs its own save failures, so the retry loop doesn't log them again.
    assert not [
        r for r in caplog.records if getattr(r, "json_fields", {}).get("path") == "convert_slack_tokens.save_retry"
    ]
    assert _exchange_lost(caplog) == [_lost("T7", "save_failed")]


def _lost(team_id, reason):
    return {"event": "slack.token.exchange_lost", "team_id": team_id, "path": "convert_slack_tokens", "reason": reason}


def _exchange_lost(caplog):
    return [
        r.json_fields
        for r in caplog.records
        if r.levelno == logging.ERROR and getattr(r, "json_fields", {}).get("event") == "slack.token.exchange_lost"
    ]


def test_commit_failure_after_exchange_retries_save_only(isolated_postgres, exchange, monkeypatch, capsys, caplog):
    _seed(isolated_postgres, "T8")
    commits = []
    real_commit = Session.commit

    def commit(self):
        commits.append(1)
        if len(commits) == 1:
            raise RuntimeError("commit lost")
        real_commit(self)

    monkeypatch.setattr(Session, "commit", commit)

    with caplog.at_level(logging.ERROR):
        assert converter.main(["--team-id", "T8", *APPLY]) == 0

    assert capsys.readouterr().out.splitlines() == ["T8 converted"]
    assert exchange.tokens == [LONG_LIVED]
    _assert_converted(isolated_postgres, "T8")
    # The lost first commit is still recorded, by type only.
    assert [
        r.json_fields
        for r in caplog.records
        if getattr(r, "json_fields", {}).get("event") == "slack.token.refresh_failed"
    ] == [
        {
            "event": "slack.token.refresh_failed",
            "team_id": "T8",
            "path": "convert_slack_tokens",
            "error_type": "RuntimeError",
        }
    ]


def test_refused_write_after_exchange_never_reports_success(isolated_postgres, exchange, monkeypatch, capsys, caplog):
    _seed(isolated_postgres, "T14")
    monkeypatch.setattr(refresh, "_guard_allows", lambda row, bot: False)

    with caplog.at_level(logging.ERROR):
        assert converter.main(["--team-id", "T14", *APPLY]) == 1

    assert capsys.readouterr().out.splitlines() == ["T14 needs_reinstall"]
    assert exchange.tokens == [LONG_LIVED]
    assert _row(isolated_postgres, "T14") == (LONG_LIVED, None, None)
    assert _exchange_lost(caplog) == [_lost("T14", "save_failed")]


def test_already_exchanged_logs_exchange_lost(isolated_postgres, exchange, caplog):
    _seed(isolated_postgres, "T15")
    exchange.error = "token_already_exchanged"

    with caplog.at_level(logging.ERROR):
        assert converter.main(["--team-id", "T15", *APPLY]) == 1

    assert _exchange_lost(caplog) == [_lost("T15", "token_already_exchanged")]


@pytest.mark.parametrize("missing", ["refresh_token", "expires_in", "access_token"])
def test_incomplete_exchange_response_reports_needs_reinstall(isolated_postgres, exchange, capsys, caplog, missing):
    _seed(isolated_postgres, "T16")
    response = {
        "ok": True,
        "access_token": EXCHANGED,
        "refresh_token": EXCHANGED_REFRESH,
        "expires_in": 43200,
        "scope": "chat:write",
    }
    del response[missing]
    exchange.response = response

    with caplog.at_level(logging.ERROR):
        assert converter.main(["--team-id", "T16", *APPLY]) == 1

    assert capsys.readouterr().out.splitlines() == ["T16 needs_reinstall"]
    assert _row(isolated_postgres, "T16") == (LONG_LIVED, None, None)
    assert _exchange_lost(caplog) == [_lost("T16", f"missing_{missing}")]


def test_network_error_during_exchange_reports_error(isolated_postgres, exchange, monkeypatch, capsys):
    _seed(isolated_postgres, "T17")
    exchange.raises = URLError("connection reset")
    saves = []
    monkeypatch.setattr(converter, "save_bot_locked", lambda *args, **kwargs: saves.append(1))

    assert converter.main(["--team-id", "T17", *APPLY]) == 1

    assert capsys.readouterr().out.splitlines() == ["T17 error:URLError"]
    assert exchange.tokens == [LONG_LIVED]
    assert saves == []
    assert _row(isolated_postgres, "T17") == (LONG_LIVED, None, None)


class _ServerErrorResponse(dict):
    status_code = 504


def test_slack_error_without_code_reports_error(isolated_postgres, exchange, capsys):
    _seed(isolated_postgres, "T18")
    exchange.raises = SlackApiError("gateway timeout", _ServerErrorResponse())

    assert converter.main(["--team-id", "T18", *APPLY]) == 1

    assert capsys.readouterr().out.splitlines() == ["T18 error:SlackApiError"]
    assert _row(isolated_postgres, "T18") == (LONG_LIVED, None, None)


def test_lock_timeout_reports_error(isolated_postgres, exchange, monkeypatch, capsys):
    _seed(isolated_postgres, "T19")

    def timed_out(team_id):
        raise refresh.TokenLockTimeout(team_id)

    monkeypatch.setattr(converter, "locked_row", timed_out)

    assert converter.main(["--team-id", "T19", *APPLY]) == 1

    assert capsys.readouterr().out.splitlines() == ["T19 error:TokenLockTimeout"]
    assert exchange.tokens == []
    assert _row(isolated_postgres, "T19") == (LONG_LIVED, None, None)


def test_non_object_settings_blocks_conversion(isolated_postgres, exchange, capsys):
    _seed(isolated_postgres, "T20", settings=["bot_token"])

    assert converter.main(["--team-id", "T20", *APPLY]) == 1

    assert capsys.readouterr().out.splitlines() == ["T20 blocked:settings_token"]
    assert exchange.tokens == []


@pytest.mark.parametrize("key", [None, "not-a-fernet-key"])
def test_apply_checks_encryption_key_before_any_exchange(isolated_postgres, exchange, monkeypatch, capsys, key):
    _seed(isolated_postgres, "T21")
    _seed(isolated_postgres, "T22")
    if key is None:
        monkeypatch.delenv("SLACK_TOKEN_ENCRYPTION_KEY")
    else:
        monkeypatch.setenv("SLACK_TOKEN_ENCRYPTION_KEY", key)

    assert converter.main(["--all", "--limit", "5", *APPLY]) == 2

    assert capsys.readouterr().out == ""
    assert exchange.tokens == []
    assert _row(isolated_postgres, "T21") == (LONG_LIVED, None, None)


def test_limit_caps_batch(isolated_postgres, exchange, capsys):
    _seed(isolated_postgres, "T_0", token=None)
    _seed(isolated_postgres, "T_00", token="")
    _seed(isolated_postgres, "T_01", settings={"bot_token": LONG_LIVED})
    _seed(isolated_postgres, "T_A")
    _seed(isolated_postgres, "T_B", token=ROTATING, expires_in=timedelta(hours=5))
    _seed(isolated_postgres, "T_C")
    _seed(isolated_postgres, "T_D")

    assert converter.main(["--all", "--limit", "2", *APPLY]) == 0

    captured = capsys.readouterr()
    assert captured.out.splitlines() == ["T_A converted", "T_C converted"]
    assert "1 workspace(s) not selected" in captured.err
    assert "next: --after T_C" in captured.err
    assert exchange.tokens == [LONG_LIVED, LONG_LIVED]
    assert _row(isolated_postgres, "T_D") == (LONG_LIVED, None, None)


def test_after_starts_the_next_batch_past_stuck_rows(isolated_postgres, exchange, capsys):
    _seed(isolated_postgres, "T_A")
    _seed(isolated_postgres, "T_B")
    _seed(isolated_postgres, "T_C")
    exchange.error = "invalid_auth"
    assert converter.main(["--all", "--limit", "2", *APPLY]) == 1
    exchange.error = None

    assert converter.main(["--all", "--limit", "2", "--after", "T_B", *APPLY]) == 0

    assert capsys.readouterr().out.splitlines() == [
        "T_A failed:invalid_auth",
        "T_B failed:invalid_auth",
        "T_C converted",
    ]
    _assert_converted(isolated_postgres, "T_C")


@pytest.mark.parametrize(
    "argv",
    [
        ["--all"],
        ["--all", "--limit", "0"],
        ["--team-id", "T1", "--all", "--limit", "1"],
        ["--team-id", "T1", "--limit", "1"],
        ["--team-id", "T1", "--after", "T0"],
        ["--team-id", "T1", "--apply"],
        ["--team-id", "T1", "--apply", "--database", "f3_prod"],
        ["--team-id", "T1", "--database", DATABASE],
    ],
)
def test_rejects_invalid_arguments(argv, exchange):
    with pytest.raises(SystemExit):
        converter.main(argv)
    assert exchange.tokens == []


def test_dry_run_calls_nothing_and_writes_nothing(isolated_postgres, exchange, capsys):
    _seed(isolated_postgres, "T9")
    _seed(isolated_postgres, "T10", token=ROTATING, expires_in=timedelta(hours=5))

    assert converter.main(["--team-id", "T9", "--team-id", "T10"]) == 0
    assert converter.main(["--all", "--limit", "5"]) == 0

    assert capsys.readouterr().out.splitlines() == ["T9 would_convert", "T10 skipped", "T9 would_convert"]
    assert exchange.tokens == []
    assert _row(isolated_postgres, "T9") == (LONG_LIVED, None, None)


def test_never_prints_tokens(isolated_postgres, exchange, monkeypatch, capsys):
    _seed(isolated_postgres, "T11")
    converter.main(["--team-id", "T11", *APPLY])
    _seed(isolated_postgres, "T12")
    _failing_flush(monkeypatch, failures=None)
    converter.main(["--team-id", "T12", *APPLY])
    _seed(isolated_postgres, "T13")
    exchange.error = "invalid_auth"
    converter.main(["--team-id", "T13", *APPLY])

    captured = capsys.readouterr()
    output = captured.out + captured.err
    assert "xox" not in output
    assert "secret-bearing" not in output
    assert "client-secret" not in output
