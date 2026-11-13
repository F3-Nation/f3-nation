import logging
import os
import sys
import time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import pytest
from f3_data_models.models import Base, SlackSpace
from slack_sdk.oauth.installation_store import Bot
from sqlalchemy import select
from sqlalchemy.orm import Session

from scripts import hourly_runner, refresh_slack_tokens
from tests import postgres_fixture
from tests.scripts.test_f3versary_hourly_runner import silence_other_jobs
from utilities.slack_tokens import refresh

isolated_postgres = postgres_fixture.isolated_postgres


@pytest.fixture
def postgres_schema():
    def create(engine):
        Base.metadata.tables["slack_spaces"].create(engine)

    return create


def _seed(engine, team_id, expires_in):
    with Session(engine) as session:
        session.add(
            SlackSpace(
                team_id=team_id,
                workspace_name=team_id,
                bot_token="xoxb-old",
                bot_token_expires_at=None if expires_in is None else datetime.now(timezone.utc) + expires_in,
                bot_refresh_token_encrypted=None if expires_in is None else "ciphertext",
            )
        )
        session.commit()


def _bot(team_id, expires_at):
    return Bot(
        team_id=team_id,
        bot_token="xoxb-x",
        bot_id="B",
        bot_user_id="U",
        installed_at=1.0,
        bot_token_expires_at=expires_at,
    )


@postgres_fixture.requires_postgres
def test_sweep_refreshes_only_rows_in_window(isolated_postgres, monkeypatch):
    engine = isolated_postgres
    _seed(engine, "T_SOON", timedelta(hours=1))
    _seed(engine, "T_LATER", timedelta(hours=4))
    _seed(engine, "T_STATIC", None)
    calls = []

    def fake_refresh(team_id, *, minutes_before_expiration, path):
        calls.append((team_id, minutes_before_expiration, path))
        return _bot(team_id, int(time.time()) + 43200)

    monkeypatch.setattr(refresh_slack_tokens, "refresh_if_needed", fake_refresh)

    result = refresh_slack_tokens.refresh_expiring_tokens()

    assert calls == [("T_SOON", refresh_slack_tokens.SWEEP_WINDOW_MINUTES, "sweep")]
    assert result == {"refreshed": 1, "failed": 0, "skipped": 0}


@postgres_fixture.requires_postgres
def test_sweep_counts_unchanged_token_as_skipped(isolated_postgres, monkeypatch):
    _seed(isolated_postgres, "T_SOON", timedelta(hours=1))
    with Session(isolated_postgres) as session:
        stored = session.scalars(select(SlackSpace.bot_token_expires_at)).one()
    monkeypatch.setattr(
        refresh_slack_tokens,
        "refresh_if_needed",
        lambda team_id, **_: _bot(team_id, int(stored.timestamp())),
    )

    assert refresh_slack_tokens.refresh_expiring_tokens() == {"refreshed": 0, "failed": 0, "skipped": 1}


@postgres_fixture.requires_postgres
def test_sweep_continues_after_failure(isolated_postgres, monkeypatch, caplog):
    _seed(isolated_postgres, "T_A", timedelta(hours=1))
    _seed(isolated_postgres, "T_B", timedelta(hours=2))
    seen = []

    def fake_refresh(team_id, **_):
        seen.append(team_id)
        if len(seen) == 1:
            raise RuntimeError("secret-looking message")
        return _bot(team_id, int(time.time()) + 43200)

    monkeypatch.setattr(refresh_slack_tokens, "refresh_if_needed", fake_refresh)

    result = refresh_slack_tokens.refresh_expiring_tokens()

    assert len(seen) == 2
    assert result == {"refreshed": 1, "failed": 1, "skipped": 0}
    assert "secret-looking message" not in caplog.text
    failed = [r for r in caplog.records if getattr(r, "json_fields", {}).get("event") == "slack.token.refresh_failed"]
    assert [r.json_fields for r in failed] == [
        {"event": "slack.token.refresh_failed", "team_id": "T_A", "path": "sweep", "error_type": "RuntimeError"}
    ]
    assert failed[0].levelno == logging.ERROR
    [complete] = [r for r in caplog.records if r.getMessage() == "slack.token.sweep_complete"]
    assert complete.levelno == logging.WARNING
    assert complete.json_fields == {"event": "slack.token.sweep_complete", "refreshed": 1, "failed": 1, "skipped": 0}


@postgres_fixture.requires_postgres
def test_sweep_does_not_log_failures_refresh_already_logged(isolated_postgres, monkeypatch, caplog):
    _seed(isolated_postgres, "T_A", timedelta(hours=1))

    def fake_refresh(team_id, **_):
        raise refresh.TokenSaveError("saving the bot token failed with OperationalError")

    monkeypatch.setattr(refresh_slack_tokens, "refresh_if_needed", fake_refresh)

    assert refresh_slack_tokens.refresh_expiring_tokens() == {"refreshed": 0, "failed": 1, "skipped": 0}
    assert not [r for r in caplog.records if getattr(r, "json_fields", {}).get("event") == "slack.token.refresh_failed"]


@postgres_fixture.requires_postgres
def test_sweep_complete_is_info_without_failures(isolated_postgres, monkeypatch, caplog):
    caplog.set_level(logging.INFO)
    _seed(isolated_postgres, "T_A", timedelta(hours=1))
    monkeypatch.setattr(
        refresh_slack_tokens, "refresh_if_needed", lambda team_id, **_: _bot(team_id, int(time.time()) + 43200)
    )

    refresh_slack_tokens.refresh_expiring_tokens()

    [complete] = [r for r in caplog.records if r.getMessage() == "slack.token.sweep_complete"]
    assert complete.levelno == logging.INFO


@postgres_fixture.requires_postgres
def test_sweep_without_key_leaves_rows(isolated_postgres, monkeypatch):
    monkeypatch.delenv("SLACK_TOKEN_ENCRYPTION_KEY", raising=False)
    _seed(isolated_postgres, "T_NOKEY", timedelta(hours=1))
    with Session(isolated_postgres) as session:
        before = session.scalars(select(SlackSpace.bot_token, SlackSpace.bot_refresh_token_encrypted)).one()

    result = refresh_slack_tokens.refresh_expiring_tokens()

    assert result == {"refreshed": 0, "failed": 1, "skipped": 0}
    with Session(isolated_postgres) as session:
        assert session.scalars(select(SlackSpace.bot_token, SlackSpace.bot_refresh_token_encrypted)).one() == before


def test_hourly_runner_runs_sweep_first(monkeypatch):
    calls = []
    silence_other_jobs(monkeypatch)
    monkeypatch.setattr(hourly_runner.refresh_slack_tokens, "refresh_expiring_tokens", lambda: calls.append("sweep"))
    monkeypatch.setattr(
        hourly_runner.calendar_images, "generate_calendar_images", lambda *a, **k: calls.append("calendar")
    )

    hourly_runner.run_all_hourly_scripts(run_reporting=False)

    assert calls[0] == "sweep"
    assert "calendar" in calls


def test_hourly_runner_continues_when_sweep_fails(monkeypatch):
    calls = []
    silence_other_jobs(monkeypatch)
    monkeypatch.setattr(
        hourly_runner.refresh_slack_tokens,
        "refresh_expiring_tokens",
        lambda: (_ for _ in ()).throw(RuntimeError("db down")),
    )
    monkeypatch.setattr(
        hourly_runner.calendar_images, "generate_calendar_images", lambda *a, **k: calls.append("calendar")
    )

    hourly_runner.run_all_hourly_scripts(run_reporting=False)

    assert calls == ["calendar"]
