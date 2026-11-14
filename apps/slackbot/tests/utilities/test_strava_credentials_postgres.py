import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from f3_data_models.models import User, UserStravaCredential
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from test_create_user_postgres import isolated_postgres  # noqa: F401

from infrastructure.strava_credentials import StravaOwnershipConflict, get_access_token, save_connection

pytestmark = pytest.mark.skipif(
    os.environ.get("SLACKBOT_POSTGRES_TESTS") != "1",
    reason="set SLACKBOT_POSTGRES_TESTS=1 to run disposable-Postgres integration tests",
)


@pytest.fixture
def store(isolated_postgres):  # noqa: F811
    ddl = Path(__file__).resolve().parents[4] / "packages/db/drizzle/0035_strava_credential_store.sql"
    with isolated_postgres.begin() as connection:
        connection.exec_driver_sql(ddl.read_text())
    with Session(isolated_postgres) as session:
        users = [User(email=f"strava-{i}@example.invalid") for i in range(2)]
        session.add_all(users)
        session.flush()
        ids = [user.id for user in users]
        session.commit()
    return isolated_postgres, ids


def _bundle(athlete=34, suffix="old", expiry=50):
    return {
        "athlete": {"id": athlete},
        "access_token": f"synthetic-{suffix}-access",
        "refresh_token": f"synthetic-{suffix}-refresh",
        "expires_at": expiry,
    }


def _read(engine, user_id):
    with Session(engine) as session:
        row = session.scalar(select(UserStravaCredential).where(UserStravaCredential.user_id == user_id))
        return None if row is None else (row.athlete_id, row.access_token, row.refresh_token, row.expires_at)


def test_real_ownership_conflict_preserves_both_connections(store):
    engine, (first, second) = store
    assert save_connection(first, _bundle()) is True
    assert save_connection(second, _bundle(athlete=35, suffix="second")) is True
    before = [_read(engine, user) for user in (first, second)]
    with pytest.raises(StravaOwnershipConflict):
        save_connection(second, _bundle(suffix="conflict"))
    assert [_read(engine, user) for user in (first, second)] == before


def test_real_upsert_replaces_complete_bundle(store):
    engine, (user_id, _) = store
    assert save_connection(user_id, _bundle()) is True
    assert save_connection(user_id, _bundle(athlete=35, suffix="new", expiry=300)) is True
    assert _read(engine, user_id) == (35, "synthetic-new-access", "synthetic-new-refresh", 300)


def test_real_refresh_commits_rotated_bundle(store):
    engine, (user_id, _) = store
    save_connection(user_id, _bundle())

    def refresh(token):
        assert token == "synthetic-old-refresh"
        return _bundle(suffix="rotated", expiry=300)

    assert get_access_token(user_id, refresh, now=100) == "synthetic-rotated-access"
    assert _read(engine, user_id) == (34, "synthetic-rotated-access", "synthetic-rotated-refresh", 300)


def test_real_refresh_serializes_reconnect_and_preserves_newer_bundle(store):
    engine, (user_id, _) = store
    save_connection(user_id, _bundle())
    refreshing = threading.Event()
    release = threading.Event()

    def refresh(token):
        assert token == "synthetic-old-refresh"
        refreshing.set()
        assert release.wait(timeout=10), "refresh release timed out"
        return _bundle(suffix="rotated", expiry=300)

    with ThreadPoolExecutor(max_workers=2) as pool:
        rotating = pool.submit(get_access_token, user_id, refresh, now=100)
        reconnect = None
        try:
            assert refreshing.wait(timeout=5), "refresh never acquired the row"
            reconnect = pool.submit(save_connection, user_id, _bundle(athlete=35, suffix="reconnected", expiry=400))
            deadline = time.monotonic() + 5
            waiting = False
            while time.monotonic() < deadline:
                with engine.connect() as connection:
                    waiting = connection.scalar(
                        text(
                            "SELECT EXISTS (SELECT 1 FROM pg_stat_activity "
                            "WHERE cardinality(pg_blocking_pids(pid)) > 0)"
                        )
                    )
                if waiting:
                    break
                time.sleep(0.01)
            assert waiting, "reconnect did not wait for the refresh row lock"
            assert not reconnect.done()
        finally:
            release.set()
        assert rotating.result(timeout=5) == "synthetic-rotated-access"
        assert reconnect is not None and reconnect.result(timeout=5) is True
    assert _read(engine, user_id) == (35, "synthetic-reconnected-access", "synthetic-reconnected-refresh", 400)


def test_real_missing_table_is_disconnected(store):
    engine, (user_id, _) = store
    with engine.begin() as connection:
        connection.exec_driver_sql("DROP TABLE user_strava_credentials")
    assert get_access_token(user_id, lambda _: pytest.fail("missing table must not refresh")) is None
    assert save_connection(user_id, _bundle()) is False
