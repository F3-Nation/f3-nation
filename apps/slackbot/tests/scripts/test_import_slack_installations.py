import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet
from f3_data_models.models import Base, SlackSpace
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from slack_sdk.oauth.installation_store import Bot, FileInstallationStore
from sqlalchemy import select
from sqlalchemy.orm import Session

from scripts import import_slack_installations as importer
from tests import postgres_fixture

pytestmark = postgres_fixture.requires_postgres
isolated_postgres = postgres_fixture.isolated_postgres

FILE_TOKEN = "xoxb-from-file"
ROW_TOKEN = "xoxb-in-row"


@pytest.fixture
def postgres_schema():
    def create(engine):
        Base.metadata.tables["slack_spaces"].create(engine)

    return create


@pytest.fixture(autouse=True)
def encryption_key(monkeypatch):
    monkeypatch.setenv("SLACK_TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())


def _seed(engine, team_id, *, token=ROW_TOKEN, expires_in=None):
    with Session(engine) as session:
        session.add(
            SlackSpace(
                team_id=team_id,
                workspace_name="W",
                bot_token=token,
                bot_token_expires_at=None if expires_in is None else datetime.now(timezone.utc) + expires_in,
            )
        )
        session.commit()


def _row(engine, team_id):
    with Session(engine) as session:
        row = session.scalars(select(SlackSpace).where(SlackSpace.team_id == team_id)).one()
        return (row.bot_token, row.bot_id, row.bot_user_id, row.bot_scopes, row.bot_token_expires_at)


def _write_file(directory, team_id, *, team_name=None, enterprise_id=None):
    # Production wrote the files without a client_id.
    FileInstallationStore(base_dir=str(directory)).save_bot(
        Bot(
            enterprise_id=enterprise_id,
            team_id=team_id,
            team_name=team_name,
            bot_token=FILE_TOKEN,
            bot_id="B_FILE",
            bot_user_id="U_FILE",
            bot_scopes=["chat:write", "users:read"],
            installed_at=time.time(),
        )
    )


def _fake_auth_test(monkeypatch, *, error=None):
    def auth_test(self):
        if error:
            raise SlackApiError("secret-bearing message", {"ok": False, "error": error})
        return SimpleNamespace(
            get=lambda key: {"bot_id": "B_AUTH", "user_id": "U_AUTH"}.get(key),
            headers={"x-oauth-scopes": "chat:write,channels:read"},
        )

    monkeypatch.setattr(WebClient, "auth_test", auth_test)


def test_imports_file_install(isolated_postgres, tmp_path, capsys):
    _seed(isolated_postgres, "T1")
    _write_file(tmp_path, "T1")

    assert importer.main(["--installations-dir", str(tmp_path)]) == 0

    assert capsys.readouterr().out.splitlines() == ["T1 imported"]
    assert _row(isolated_postgres, "T1") == (FILE_TOKEN, "B_FILE", "U_FILE", "chat:write,users:read", None)


def test_backfills_from_auth_test(isolated_postgres, tmp_path, monkeypatch, capsys):
    _seed(isolated_postgres, "T2")
    _fake_auth_test(monkeypatch)

    assert importer.main(["--installations-dir", str(tmp_path)]) == 0

    assert capsys.readouterr().out.splitlines() == ["T2 backfilled"]
    assert _row(isolated_postgres, "T2") == (ROW_TOKEN, "B_AUTH", "U_AUTH", "chat:write,channels:read", None)


def test_reports_no_token_and_auth_failed(isolated_postgres, tmp_path, monkeypatch, capsys):
    _seed(isolated_postgres, "T3", token=None)
    _seed(isolated_postgres, "T4")
    _fake_auth_test(monkeypatch, error="invalid_auth")

    assert importer.main(["--installations-dir", str(tmp_path)]) == 1

    assert capsys.readouterr().out.splitlines() == ["T3 no_token", "T4 auth_failed:invalid_auth"]
    assert _row(isolated_postgres, "T4")[1] is None


def test_dry_run_writes_nothing(isolated_postgres, tmp_path, monkeypatch, capsys):
    _seed(isolated_postgres, "T5")
    _seed(isolated_postgres, "T6")
    _write_file(tmp_path, "T5")
    _fake_auth_test(monkeypatch)

    assert importer.main(["--installations-dir", str(tmp_path), "--dry-run"]) == 0

    assert capsys.readouterr().out.splitlines() == ["T5 imported", "T6 backfilled"]
    assert _row(isolated_postgres, "T5") == (ROW_TOKEN, None, None, None, None)
    assert _row(isolated_postgres, "T6") == (ROW_TOKEN, None, None, None, None)


def test_import_skips_rotating_row(isolated_postgres, tmp_path, monkeypatch, capsys):
    _seed(isolated_postgres, "T7", expires_in=timedelta(hours=5))
    _write_file(tmp_path, "T7")
    before = _row(isolated_postgres, "T7")

    def forbidden(self):
        raise AssertionError("auth.test must not run for a rotating row")

    monkeypatch.setattr(WebClient, "auth_test", forbidden)

    assert importer.main(["--installations-dir", str(tmp_path)]) == 0

    assert capsys.readouterr().out.splitlines() == ["T7 skipped_rotating"]
    assert _row(isolated_postgres, "T7") == before


def test_never_prints_tokens(isolated_postgres, tmp_path, monkeypatch, capsys):
    _seed(isolated_postgres, "T8")
    _seed(isolated_postgres, "T9")
    _seed(isolated_postgres, "T10")
    _write_file(tmp_path, "T8")
    _fake_auth_test(monkeypatch, error="token_revoked")

    importer.main(["--installations-dir", str(tmp_path)])

    captured = capsys.readouterr()
    assert "xox" not in captured.out + captured.err
    assert "secret-bearing" not in captured.out + captured.err


def test_rotating_row_without_file_never_calls_auth_test(isolated_postgres, tmp_path, monkeypatch, capsys):
    _seed(isolated_postgres, "T11", expires_in=timedelta(hours=5))
    before = _row(isolated_postgres, "T11")
    calls = []
    monkeypatch.setattr(WebClient, "auth_test", lambda self: calls.append(1))

    assert importer.main(["--installations-dir", str(tmp_path)]) == 0

    assert capsys.readouterr().out.splitlines() == ["T11 skipped_rotating"]
    assert calls == []
    assert _row(isolated_postgres, "T11") == before


def test_rotating_row_dry_run(isolated_postgres, tmp_path, monkeypatch, capsys):
    _seed(isolated_postgres, "T12", expires_in=timedelta(hours=5))
    calls = []
    monkeypatch.setattr(WebClient, "auth_test", lambda self: calls.append(1))

    assert importer.main(["--installations-dir", str(tmp_path), "--dry-run"]) == 0

    assert capsys.readouterr().out.splitlines() == ["T12 skipped_rotating"]
    assert calls == []


def test_one_bad_team_does_not_stop_the_run(isolated_postgres, tmp_path, capsys):
    _seed(isolated_postgres, "T13")
    _seed(isolated_postgres, "T14")
    _write_file(tmp_path, "T14")
    _write_file(tmp_path, "T13")
    corrupt = next(p for p in tmp_path.rglob("bot-latest") if "T13" in str(p))
    corrupt.write_text("{not json")

    assert importer.main(["--installations-dir", str(tmp_path)]) == 1

    assert capsys.readouterr().out.splitlines() == ["T13 error:JSONDecodeError", "T14 imported"]
    assert _row(isolated_postgres, "T14")[0] == FILE_TOKEN
    assert _row(isolated_postgres, "T13")[0] == ROW_TOKEN


def _workspace_name(engine, team_id):
    with Session(engine) as session:
        row = session.scalars(select(SlackSpace).where(SlackSpace.team_id == team_id)).one_or_none()
        return None if row is None else row.workspace_name


def test_imports_file_without_a_row(isolated_postgres, tmp_path, capsys):
    _seed(isolated_postgres, "T20")
    _write_file(tmp_path, "T20")
    _write_file(tmp_path, "T21", team_name="Orphan Team")
    _write_file(tmp_path, "T22", enterprise_id="E1")

    assert importer.main(["--installations-dir", str(tmp_path)]) == 0

    assert capsys.readouterr().out.splitlines() == ["T20 imported", "T21 imported_new"]
    assert _row(isolated_postgres, "T21") == (FILE_TOKEN, "B_FILE", "U_FILE", "chat:write,users:read", None)
    assert _workspace_name(isolated_postgres, "T21") == "Orphan Team"
    assert _workspace_name(isolated_postgres, "T22") is None


def test_dry_run_reports_file_without_a_row_and_writes_nothing(isolated_postgres, tmp_path, capsys):
    _write_file(tmp_path, "T23", team_name="Orphan Team")

    assert importer.main(["--installations-dir", str(tmp_path), "--dry-run"]) == 0

    assert capsys.readouterr().out.splitlines() == ["T23 imported_new"]
    with Session(isolated_postgres) as session:
        assert session.scalars(select(SlackSpace).where(SlackSpace.team_id == "T23")).one_or_none() is None
