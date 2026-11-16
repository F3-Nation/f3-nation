from datetime import datetime, timedelta, timezone

import pytest
from cryptography.fernet import Fernet
from f3_data_models.models import Base, SlackSpace
from sqlalchemy import select
from sqlalchemy.orm import Session

from scripts import rekey_slack_tokens as rekey
from tests import postgres_fixture
from utilities.slack_tokens import refresh
from utilities.slack_tokens.crypto import decrypt_refresh_token, encrypt_refresh_token

pytestmark = postgres_fixture.requires_postgres
isolated_postgres = postgres_fixture.isolated_postgres

ENV = "SLACK_TOKEN_ENCRYPTION_KEY"
REFRESH = {"T1": "xoxe-1-one", "T2": "xoxe-1-two"}


@pytest.fixture
def postgres_schema():
    def create(engine):
        Base.metadata.tables["slack_spaces"].create(engine)

    return create


@pytest.fixture
def keys(monkeypatch):
    key_a, key_b = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    monkeypatch.setenv(ENV, key_a)
    return key_a, key_b


def _seed(engine, team_id, expires_in, *, refresh_token="unset"):
    token = REFRESH[team_id] if refresh_token == "unset" else refresh_token
    with Session(engine) as session:
        session.add(
            SlackSpace(
                team_id=team_id,
                workspace_name="W",
                bot_token=f"xoxb-{team_id}",
                bot_token_expires_at=datetime.now(timezone.utc) + expires_in,
                bot_refresh_token_encrypted=None if token is None else encrypt_refresh_token(token),
            )
        )
        session.commit()


def _rows(engine):
    with Session(engine) as session:
        return {
            r.team_id: (r.bot_token, r.bot_token_expires_at, r.bot_refresh_token_encrypted)
            for r in session.scalars(select(SlackSpace))
        }


@pytest.fixture
def seeded(isolated_postgres, keys):
    _seed(isolated_postgres, "T1", timedelta(minutes=30))
    _seed(isolated_postgres, "T2", timedelta(hours=10))
    return isolated_postgres


def _rotate_keys(monkeypatch, keys):
    key_a, key_b = keys
    monkeypatch.setenv(ENV, f"{key_b},{key_a}")


def test_rekey_rewrites_every_row(seeded, keys, monkeypatch, capsys):
    before = _rows(seeded)
    _rotate_keys(monkeypatch, keys)

    assert rekey.main([]) == 0

    assert sorted(capsys.readouterr().out.splitlines()) == ["T1 rekeyed", "T2 rekeyed"]
    monkeypatch.setenv(ENV, keys[1])
    after = _rows(seeded)
    for team_id, (token, expires_at, ciphertext) in after.items():
        assert decrypt_refresh_token(ciphertext) == REFRESH[team_id]
        assert (token, expires_at) == before[team_id][:2]


def test_rekey_makes_no_slack_call(seeded, keys, monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("Slack must not be called")

    monkeypatch.setattr(refresh, "_rotator", boom)
    _rotate_keys(monkeypatch, keys)

    assert rekey.main([]) == 0


def test_rekey_skips_rows_without_refresh_token(isolated_postgres, keys, monkeypatch, capsys):
    _seed(isolated_postgres, "T1", timedelta(hours=1), refresh_token=None)
    _rotate_keys(monkeypatch, keys)

    assert rekey.main([]) == 0
    assert capsys.readouterr().out == ""
    assert _rows(isolated_postgres)["T1"][2] is None


def test_rekey_reports_undecryptable_row_and_continues(seeded, keys, monkeypatch, capsys):
    with Session(seeded) as session:
        row = session.scalars(select(SlackSpace).where(SlackSpace.team_id == "T1")).one()
        row.bot_refresh_token_encrypted = Fernet(Fernet.generate_key()).encrypt(b"x").decode()
        session.commit()
    bad = _rows(seeded)["T1"][2]
    _rotate_keys(monkeypatch, keys)

    assert rekey.main([]) == 1

    assert sorted(capsys.readouterr().out.splitlines()) == ["T1 failed:TokenDecryptError", "T2 rekeyed"]
    assert _rows(seeded)["T1"][2] == bad


def test_rekey_reports_lock_timeout_and_continues(seeded, keys, monkeypatch, capsys):
    real = refresh.locked_row

    def locked(team_id):
        if team_id == "T1":
            raise refresh.TokenLockTimeout()
        return real(team_id)

    monkeypatch.setattr(rekey, "locked_row", locked)
    before = _rows(seeded)["T1"]
    _rotate_keys(monkeypatch, keys)

    assert rekey.main([]) == 1

    assert sorted(capsys.readouterr().out.splitlines()) == ["T1 failed:TokenLockTimeout", "T2 rekeyed"]
    assert _rows(seeded)["T1"] == before


def test_check_reports_old_key_rows(seeded, keys, monkeypatch, capsys):
    _rotate_keys(monkeypatch, keys)
    before = _rows(seeded)

    assert rekey.main(["--check"]) == 1

    lines = capsys.readouterr().out.splitlines()
    assert sorted(lines[:-1]) == ["T1 old_key", "T2 old_key"]
    assert lines[-1] == "2 not on the newest key"
    assert _rows(seeded) == before


def test_check_passes_after_rekey(seeded, keys, monkeypatch, capsys):
    _rotate_keys(monkeypatch, keys)
    assert rekey.main([]) == 0
    capsys.readouterr()

    assert rekey.main(["--check"]) == 0
    assert capsys.readouterr().out.splitlines() == ["0 not on the newest key"]


def test_never_prints_tokens(seeded, keys, monkeypatch, capsys):
    _rotate_keys(monkeypatch, keys)
    ciphertexts = [c for _, _, c in _rows(seeded).values()]

    rekey.main(["--check"])
    rekey.main([])
    ciphertexts += [c for _, _, c in _rows(seeded).values()]
    out = capsys.readouterr().out

    assert "xox" not in out
    assert not any(c in out for c in ciphertexts)
