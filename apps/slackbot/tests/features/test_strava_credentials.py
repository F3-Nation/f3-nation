from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy.exc import IntegrityError, ProgrammingError

from infrastructure import strava_credentials


@pytest.fixture
def session(monkeypatch):
    session = MagicMock()

    @contextmanager
    def scope(**kwargs):
        assert kwargs == {"backend": "postgresql"}
        yield session

    monkeypatch.setattr(strava_credentials, "session_scope", scope)
    return session


def test_missing_connection_never_uses_legacy_meta(session):
    session.scalar.return_value = None
    refresh = MagicMock()
    assert strava_credentials.get_access_token(12, refresh, now=100) is None
    refresh.assert_not_called()


def test_unexpired_connection_uses_store(session):
    session.scalar.return_value = SimpleNamespace(access_token="synthetic-current", expires_at=200)
    refresh = MagicMock()
    assert strava_credentials.get_access_token(12, refresh, now=100) == "synthetic-current"
    refresh.assert_not_called()


def test_refresh_changes_entire_bundle_under_lock(session):
    row = SimpleNamespace(access_token="synthetic-old", refresh_token="synthetic-refresh", expires_at=50)
    session.scalar.return_value = row
    refresh = MagicMock(
        return_value={"access_token": "synthetic-new", "refresh_token": "synthetic-rotated", "expires_at": 200}
    )
    assert strava_credentials.get_access_token(12, refresh, now=100) == "synthetic-new"
    refresh.assert_called_once_with("synthetic-refresh")
    assert (row.access_token, row.refresh_token, row.expires_at) == ("synthetic-new", "synthetic-rotated", 200)
    assert "FOR UPDATE" in str(session.scalar.call_args.args[0])


def test_incomplete_refresh_does_not_partially_update(session):
    row = SimpleNamespace(access_token="synthetic-old", refresh_token="synthetic-refresh", expires_at=50)
    session.scalar.return_value = row
    with pytest.raises(ValueError, match="Invalid Strava credential bundle"):
        strava_credentials.get_access_token(12, lambda _: {"access_token": "synthetic-new"}, now=100)
    assert (row.access_token, row.refresh_token, row.expires_at) == ("synthetic-old", "synthetic-refresh", 50)


@pytest.mark.parametrize("sqlstate", ["42P01", "42501"])
def test_only_missing_table_is_disconnected(session, sqlstate):
    original = Exception("synthetic database error")
    original.pgcode = sqlstate
    original.diag = SimpleNamespace(message_primary='relation "user_strava_credentials" does not exist')
    session.scalar.side_effect = ProgrammingError("SELECT", {}, original)
    if sqlstate == "42P01":
        assert strava_credentials.get_access_token(12, MagicMock(), now=100) is None
    else:
        with pytest.raises(RuntimeError, match="Strava credential storage failed"):
            strava_credentials.get_access_token(12, MagicMock(), now=100)


def test_exchange_saves_complete_bundle_atomically(session):
    data = {
        "athlete": {"id": 34},
        "access_token": "synthetic-access",
        "refresh_token": "synthetic-refresh",
        "expires_at": 200,
    }
    assert strava_credentials.save_connection(12, data) is True
    statement = session.execute.call_args.args[0]
    assert statement.compile().params == {
        "user_id": 12,
        "athlete_id": 34,
        "access_token": "synthetic-access",
        "refresh_token": "synthetic-refresh",
        "expires_at": 200,
        "param_1": 34,
        "param_2": "synthetic-access",
        "param_3": "synthetic-refresh",
        "param_4": 200,
    }
    assert "ON CONFLICT (user_id) DO UPDATE" in str(statement)


def test_failed_provider_refresh_leaves_connection_unchanged(session):
    row = SimpleNamespace(access_token="synthetic-old", refresh_token="synthetic-refresh", expires_at=50)
    session.scalar.return_value = row
    refresh = MagicMock(side_effect=TimeoutError("Synthetic provider timeout"))
    with pytest.raises(TimeoutError):
        strava_credentials.get_access_token(12, refresh, now=100)
    assert (row.access_token, row.refresh_token, row.expires_at) == ("synthetic-old", "synthetic-refresh", 50)


def test_exchange_during_missing_table_gap_does_not_write_metadata(session):
    original = Exception("synthetic database error")
    original.pgcode = "42P01"
    original.diag = SimpleNamespace(message_primary='relation "user_strava_credentials" does not exist')
    session.execute.side_effect = ProgrammingError("INSERT", {}, original)
    assert (
        strava_credentials.save_connection(
            12,
            {
                "athlete": {"id": 34},
                "access_token": "synthetic-access",
                "refresh_token": "synthetic-refresh",
                "expires_at": 200,
            },
        )
        is False
    )


def test_unrelated_missing_relation_is_an_error_without_sql_or_credentials(session):
    original = Exception("synthetic-access")
    original.pgcode = "42P01"
    original.diag = SimpleNamespace(message_primary='relation "unrelated_table" does not exist')
    session.scalar.side_effect = ProgrammingError("SELECT synthetic-access", {"token": "synthetic-access"}, original)
    with pytest.raises(RuntimeError) as captured:
        strava_credentials.get_access_token(12, MagicMock(), now=100)
    assert str(captured.value) == "Strava credential storage failed"
    assert captured.value.__suppress_context__ is True


@pytest.mark.parametrize("athlete", [None, [], "invalid", {}])
def test_invalid_athlete_never_writes(session, athlete):
    with pytest.raises(ValueError, match="Invalid Strava athlete"):
        strava_credentials.save_connection(
            12,
            {
                "athlete": athlete,
                "access_token": "synthetic-access",
                "refresh_token": "synthetic-refresh",
                "expires_at": 200,
            },
        )
    session.execute.assert_not_called()


def test_missing_store_warning_excludes_database_details(session, caplog):
    original = Exception("synthetic-secret")
    original.pgcode = "42P01"
    original.diag = SimpleNamespace(message_primary='relation "user_strava_credentials" does not exist')
    session.scalar.side_effect = ProgrammingError("SELECT synthetic-secret", {}, original)
    assert strava_credentials.get_access_token(12, MagicMock(), now=100) is None
    assert "strava.credentials.store_missing operation=read" in caplog.text
    assert "synthetic-secret" not in caplog.text


@pytest.mark.parametrize("constraint", ["user_strava_credentials_athlete_id_key", "unrelated_key"])
def test_athlete_conflict_is_distinguished_without_exposing_credentials(session, constraint, caplog):
    original = Exception("synthetic-secret")
    original.pgcode = "23505"
    original.diag = SimpleNamespace(constraint_name=constraint)
    session.execute.side_effect = IntegrityError("INSERT", {"token": "synthetic-secret"}, original)
    expected = (
        strava_credentials.StravaOwnershipConflict
        if constraint == "user_strava_credentials_athlete_id_key"
        else RuntimeError
    )
    with pytest.raises(expected) as captured:
        strava_credentials.save_connection(
            12,
            {
                "athlete": {"id": 34},
                "access_token": "synthetic-access",
                "refresh_token": "synthetic-refresh",
                "expires_at": 200,
            },
        )
    assert captured.value.__suppress_context__ is True
    assert "synthetic" not in str(captured.value)
    assert "synthetic" not in caplog.text
    assert session.execute.call_count == 1
    assert "user_id=12" in caplog.text
    if constraint == "unrelated_key":
        assert "pgcode=23505" in caplog.text
        assert "constraint=unrelated_key" in caplog.text


@pytest.mark.parametrize("payload", [None, [], "synthetic-invalid"])
def test_non_object_refresh_is_rejected_without_partial_update(session, payload):
    row = SimpleNamespace(access_token="synthetic-old", refresh_token="synthetic-refresh", expires_at=50)
    session.scalar.return_value = row
    with pytest.raises(ValueError, match="Invalid Strava credential bundle"):
        strava_credentials.get_access_token(12, lambda _: payload, now=100)
    assert (row.access_token, row.refresh_token, row.expires_at) == ("synthetic-old", "synthetic-refresh", 50)
