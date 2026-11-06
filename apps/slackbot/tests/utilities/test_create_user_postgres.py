import hashlib
import os
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from pathlib import Path

import pytest
from f3_data_models import utils as data_model_utils
from f3_data_models.models import Base, SlackUser, User
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from utilities import helper_functions

POSTGRES_IMAGE = "postgres:18.6-trixie@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280"
pytestmark = pytest.mark.skipif(
    os.environ.get("SLACKBOT_POSTGRES_TESTS") != "1",
    reason="set SLACKBOT_POSTGRES_TESTS=1 to run disposable-Postgres integration tests",
)


@pytest.fixture
def isolated_postgres(monkeypatch):
    assert helper_functions.session_scope is data_model_utils.session_scope
    container_id = None
    engine = None
    try:
        container_id = subprocess.check_output(
            [
                "docker",
                "create",
                "--tmpfs",
                "/var/lib/postgresql:rw",
                "--publish",
                "127.0.0.1::5432",
                "--env",
                "POSTGRES_USER=slackbot_test",
                "--env",
                "POSTGRES_PASSWORD=slackbot_test",
                "--env",
                "POSTGRES_DB=slackbot_test",
                POSTGRES_IMAGE,
            ],
            text=True,
        ).strip()
        subprocess.run(["docker", "start", container_id], check=True, capture_output=True, text=True)
        published_port = subprocess.check_output(["docker", "port", container_id, "5432/tcp"], text=True).strip()
        port = int(published_port.rsplit(":", maxsplit=1)[1])
        url = URL.create(
            "postgresql+psycopg2",
            username="slackbot_test",
            password="slackbot_test",
            host="127.0.0.1",
            port=port,
            database="slackbot_test",
        )
        engine = create_engine(url, pool_pre_ping=True)

        deadline = time.monotonic() + 30
        while True:
            try:
                with engine.connect() as connection:
                    connection.execute(text("SELECT 1"))
                break
            except Exception:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.2)

        with engine.begin() as connection:
            connection.execute(text("CREATE EXTENSION citext"))
            # The helper only needs the referenced key; avoid creating the full application schema.
            connection.execute(text("CREATE TABLE orgs (id integer PRIMARY KEY)"))
        Base.metadata.tables["users"].create(engine)
        Base.metadata.tables["slack_users"].create(engine)

        session_factory = sessionmaker(bind=engine)
        monkeypatch.setattr(data_model_utils, "get_session", lambda backend=None: session_factory())
        helper_functions.SLACK_USERS.clear()
        yield engine
    finally:
        if engine is not None:
            engine.dispose()
        if container_id:
            subprocess.run(["docker", "rm", "--force", container_id], check=True, capture_output=True, text=True)


def _assert_single_synthetic_link(engine, slack_id, slack_user_id, expected_user_id=None):
    with Session(engine) as session:
        slack_rows = session.scalars(select(SlackUser).where(SlackUser.slack_id == slack_id)).all()
        user_rows = session.scalars(select(User).where(User.id == slack_user_id)).all()
        assert len(session.scalars(select(SlackUser)).all()) == 1
        assert len(session.scalars(select(User)).all()) == 1
        assert len(slack_rows) == 1
        assert len(user_rows) == 1
        slack_user = slack_rows[0]
        user = user_rows[0]
        assert slack_user.user_id == user.id
        assert expected_user_id is None or slack_user.user_id == expected_user_id
        assert user.email == f"dev.staging-email-sink+{user.id}@f3nation.com"
        assert user.f3_name == f"F3 {user.id}"
        assert not user.email.startswith("dev.staging-email-sink+pending-")
        assert slack_user.email == user.email
        assert slack_user.user_name == f"F3 {user.id}"
        assert slack_user.avatar_url is None
        return slack_user, user


def test_direct_create_user_serial_calls_commit_and_return_synthetic_identity(isolated_postgres):
    slack_id = "U_TEST_SERIAL_1101"
    profile = {
        "email": "fabricated.serial@example.invalid",
        "real_name": "Fabricated Serial Name",
        "image_192": "https://example.invalid/fabricated-serial.png",
    }

    first = helper_functions.create_user({"id": slack_id, "profile": profile}, home_region_id=None)
    second = helper_functions.create_user({"id": slack_id, "profile": profile}, home_region_id=None)

    assert first.id == second.id
    assert first.slack_id == second.slack_id == slack_id
    assert first.user_id == second.user_id
    persisted, user = _assert_single_synthetic_link(isolated_postgres, slack_id, first.user_id)
    assert persisted.email != profile["email"]
    assert persisted.user_name != profile["real_name"]
    assert persisted.avatar_url != profile["image_192"]
    assert user.home_region_id is None


def _assert_contended_create(isolated_postgres, slack_id, initial_orphan=False):
    original_slack_user_id = None
    if initial_orphan:
        with isolated_postgres.begin() as connection:
            result = connection.execute(
                text(
                    """INSERT INTO slack_users
                       (slack_id, user_name, email, is_admin, is_owner, is_bot, user_id, avatar_url, slack_team_id)
                       VALUES (:slack_id, :name, :email, false, false, false, NULL, :avatar, :team)
                       RETURNING id"""
                ),
                {
                    "slack_id": slack_id,
                    "name": "Original orphan profile",
                    "email": "orphan.profile@example.invalid",
                    "avatar": "https://example.invalid/orphan.png",
                    "team": "T_ORIGINAL_ORPHAN",
                },
            )
            original_slack_user_id = result.scalar_one()

    lock_acquired = threading.Event()
    release_lock_holder = threading.Event()
    second_started = threading.Event()
    first_statement_seen = False
    lock_key = int.from_bytes(hashlib.sha256(slack_id.encode("utf-8")).digest()[:8], "big", signed=True)

    def after_statement(_conn, _cursor, statement, _parameters, _context, _executemany):
        nonlocal first_statement_seen
        if "pg_advisory_xact_lock" in statement and not first_statement_seen:
            first_statement_seen = True
            lock_acquired.set()
            if not release_lock_holder.wait(timeout=10):
                raise TimeoutError("test did not release advisory lock holder")

    event.listen(isolated_postgres, "after_cursor_execute", after_statement)
    payload = {
        "id": slack_id,
        "profile": {
            "email": "fabricated.concurrent@example.invalid",
            "real_name": "Fabricated Concurrent Name",
            "image_192": "https://example.invalid/fabricated-concurrent.png",
        },
    }
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            first_future = executor.submit(helper_functions.create_user, payload, None)
            assert lock_acquired.wait(timeout=5), "first call did not acquire advisory lock"

            def second_call():
                second_started.set()
                return helper_functions.create_user(payload, None)

            second_future = executor.submit(second_call)
            assert second_started.wait(timeout=5)
            wait_deadline = time.monotonic() + 5
            while time.monotonic() < wait_deadline:
                with isolated_postgres.connect() as observer:
                    waiting = observer.execute(
                        text(
                            """SELECT 1
                               FROM pg_locks AS locks
                               JOIN pg_stat_activity AS activity ON activity.pid = locks.pid
                               WHERE locks.locktype = 'advisory'
                                 AND locks.granted = false
                                 AND locks.classid = CAST(:classid AS oid)
                                 AND locks.objid = CAST(:objid AS oid)
                                 AND locks.objsubid = 1
                                 AND activity.datname = current_database()
                                 AND activity.wait_event_type = 'Lock'
                                 AND activity.query ILIKE '%pg_advisory_xact_lock%'"""
                        ),
                        {"classid": (lock_key >> 32) & 0xFFFFFFFF, "objid": lock_key & 0xFFFFFFFF},
                    ).first()
                if waiting:
                    break
                if second_future.done():
                    pytest.fail("second create_user call completed before waiting on the advisory lock")
                time.sleep(0.05)
            else:
                pytest.fail("second create_user call never appeared as a PostgreSQL advisory-lock waiter")
            release_lock_holder.set()
            first = first_future.result(timeout=10)
            second = second_future.result(timeout=10)
    finally:
        release_lock_holder.set()
        event.remove(isolated_postgres, "after_cursor_execute", after_statement)

    assert first.id == second.id
    assert first.user_id == second.user_id
    persisted, user = _assert_single_synthetic_link(
        isolated_postgres,
        slack_id,
        first.user_id,
        expected_user_id=first.user_id,
    )
    assert persisted.email != payload["profile"]["email"]
    assert persisted.user_name != payload["profile"]["real_name"]
    assert persisted.avatar_url != payload["profile"]["image_192"]
    assert user.home_region_id is None
    if original_slack_user_id is not None:
        assert persisted.id == original_slack_user_id
        assert persisted.slack_team_id == "T_ORIGINAL_ORPHAN"


def test_concurrent_direct_create_user_for_absent_slack_user(isolated_postgres):
    _assert_contended_create(isolated_postgres, "U_TEST_CONCURRENT_1101")


def test_concurrent_direct_create_user_links_committed_orphan(isolated_postgres):
    _assert_contended_create(isolated_postgres, "U_TEST_ORPHAN_1101", initial_orphan=True)


IDENTITY_CONSTRAINT = "uq_slack_users_slack_id_team_id"
IDENTITY_MIGRATION = Path(__file__).resolve().parents[4] / "packages/db/drizzle/0034_slack_user_identity.sql"
INTEGRATION_FIELDS = (
    "strava_access_token",
    "strava_refresh_token",
    "strava_expires_at",
    "strava_athlete_id",
    "meta",
    "meta_is_sql_null",
    "meta_text",
)


def _legacy_slack_users(engine):
    with engine.begin() as connection:
        connection.execute(text(f"ALTER TABLE public.slack_users DROP CONSTRAINT {IDENTITY_CONSTRAINT}"))
        trigger_migration = IDENTITY_MIGRATION.with_name("0008_nice_leech.sql").read_text()
        function_start = trigger_migration.index("CREATE OR REPLACE FUNCTION public.set_updated_column()")
        function_end = trigger_migration.index("$function$;", function_start) + len("$function$;")
        connection.exec_driver_sql(trigger_migration[function_start:function_end])
        trigger_start = trigger_migration.index("CREATE TRIGGER set_updated_slack_users")
        trigger_end = trigger_migration.index(";", trigger_start) + 1
        connection.exec_driver_sql(trigger_migration[trigger_start:trigger_end])
        connection.execute(
            text(
                "INSERT INTO users (id, email, status) VALUES (1, 'one@example.invalid', 'active'), "
                "(2, 'two@example.invalid', 'active')"
            )
        )


def _insert_identity(connection, row_id, slack_id, **overrides):
    values = {
        "id": row_id,
        "slack_id": slack_id,
        "user_name": f"Synthetic profile {row_id}",
        "email": f"identity-{row_id}@example.invalid",
        "is_admin": row_id % 2 == 0,
        "is_owner": row_id % 3 == 0,
        "is_bot": False,
        "user_id": None,
        "avatar_url": f"https://example.invalid/avatar-{row_id}.png",
        "slack_team_id": "T_MIGRATION",
        "strava_access_token": None,
        "strava_refresh_token": None,
        "strava_expires_at": None,
        "strava_athlete_id": None,
        "meta": None,
        "slack_updated": row_id,
        "created": "2026-01-01 01:02:03",
        "updated": "2026-02-02 04:05:06",
        **overrides,
    }
    columns = ", ".join(values)
    parameters = ", ".join("CAST(:meta AS jsonb)" if key == "meta" else f":{key}" for key in values)
    connection.execute(text(f"INSERT INTO public.slack_users ({columns}) VALUES ({parameters})"), values)


def _identity_rows(engine):
    with engine.connect() as connection:
        return {
            row["id"]: dict(row)
            for row in connection.execute(
                text(
                    "SELECT *, meta IS NULL AS meta_is_sql_null, meta::text AS meta_text "
                    "FROM public.slack_users ORDER BY id"
                )
            ).mappings()
        }


def _apply_identity_migration(connection):
    for statement in IDENTITY_MIGRATION.read_text().split("--> statement-breakpoint"):
        if statement.strip():
            connection.exec_driver_sql(statement)


def _identity_constraint_exists(engine):
    with engine.connect() as connection:
        constraint_exists, index_exists = connection.execute(
            text(
                "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.slack_users'::regclass "
                "AND conname = :name AND contype = 'u'), to_regclass(:index_name) IS NOT NULL"
            ),
            {"name": IDENTITY_CONSTRAINT, "index_name": f"public.{IDENTITY_CONSTRAINT}"},
        ).one()
        assert constraint_exists == index_exists
        return constraint_exists


@pytest.mark.parametrize(
    "trigger_mode", [None, "O", "D", "R", "A"], ids=["absent", "origin", "disabled", "replica", "always"]
)
def test_slack_identity_migration_preserves_survivors_and_nonduplicates(isolated_postgres, trigger_mode):
    engine = isolated_postgres
    _legacy_slack_users(engine)
    with engine.begin() as connection:
        if trigger_mode is None:
            connection.exec_driver_sql("DROP TRIGGER set_updated_slack_users ON public.slack_users")
            connection.exec_driver_sql("DROP FUNCTION public.set_updated_column()")
        else:
            trigger_action = {"O": "ENABLE", "D": "DISABLE", "R": "ENABLE REPLICA", "A": "ENABLE ALWAYS"}[trigger_mode]
            connection.exec_driver_sql(
                f"ALTER TABLE public.slack_users {trigger_action} TRIGGER set_updated_slack_users"
            )
        _insert_identity(connection, 10, "U_LINKED")
        _insert_identity(connection, 11, "U_LINKED", user_id=1)
        _insert_identity(connection, 20, "U_LOWEST_LINKED", user_id=1)
        _insert_identity(connection, 21, "U_LOWEST_LINKED", user_id=1)
        _insert_identity(connection, 30, "U_DONOR", user_id=1)
        _insert_identity(
            connection,
            31,
            "U_DONOR",
            strava_access_token="synthetic-access",
            strava_refresh_token="synthetic-refresh",
            strava_expires_at="2027-03-04 05:06:07",
            strava_athlete_id=123,
            meta='{"nested":{"list":[null,0,"",false]},"empty":{}}',
        )
        _insert_identity(connection, 40, "U_UNLINKED_DATA")
        _insert_identity(connection, 41, "U_UNLINKED_DATA", meta="[]")
        _insert_identity(connection, 42, "U_UNLINKED_DATA")
        _insert_identity(connection, 50, "U_UNLINKED_EMPTY")
        _insert_identity(connection, 51, "U_UNLINKED_EMPTY")
        _insert_identity(connection, 60, "U_LINKED_DATA", user_id=1)
        _insert_identity(connection, 61, "U_LINKED_DATA", user_id=1, strava_refresh_token="synthetic-only")
        _insert_identity(connection, 70, "U_OTHER_ACCOUNT", user_id=1)
        _insert_identity(connection, 71, "U_LINKED", user_id=2, slack_team_id="T_OTHER")
        _insert_identity(connection, 72, "USLACKBOT", is_bot=True)
        _insert_identity(connection, 73, "U_CONTROL_DATA", meta='{"control":[1,2]}', strava_athlete_id=456)
    before = _identity_rows(engine)
    expected = {row_id: before[row_id].copy() for row_id in [11, 20, 30, 41, 50, 61, 70, 71, 72, 73]}
    for field in INTEGRATION_FIELDS:
        expected[30][field] = before[31][field]
    with engine.begin() as connection:
        _apply_identity_migration(connection)
    after = _identity_rows(engine)
    assert after[30]["updated"] == before[30]["updated"]
    assert after == expected
    assert _identity_constraint_exists(engine)
    with engine.begin() as connection:
        actual_mode = connection.execute(
            text(
                "SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'public.slack_users'::regclass "
                "AND tgname = 'set_updated_slack_users'"
            )
        ).scalar_one_or_none()
        assert actual_mode == trigger_mode
        updated = connection.execute(
            text("UPDATE public.slack_users SET user_name = user_name WHERE id = 30 RETURNING updated")
        ).scalar_one()
        if trigger_mode in ("O", "A"):
            assert updated != before[30]["updated"]
        else:
            assert updated == before[30]["updated"]


@pytest.mark.parametrize(
    ("first", "second"),
    [
        ({"user_id": 1}, {"user_id": 2}),
        ({"strava_access_token": "same"}, {"strava_access_token": "same"}),
        ({"strava_access_token": "access"}, {"strava_refresh_token": "refresh"}),
        ({"strava_refresh_token": ""}, {"strava_refresh_token": "refresh"}),
        ({"strava_expires_at": "2027-01-01"}, {"strava_expires_at": "2028-01-01"}),
        ({"strava_athlete_id": 0}, {"strava_athlete_id": 1}),
        ({"meta": "null"}, {"meta": "{}"}),
        ({"meta": "{}"}, {"meta": "[]"}),
        (
            {"strava_access_token": "a", "strava_refresh_token": "r", "meta": '{"same":true}'},
            {"strava_access_token": "a", "strava_refresh_token": "r", "meta": '{"same":true}'},
        ),
    ],
    ids=[
        "conflicting-links",
        "identical-access",
        "disjoint-fields",
        "refresh-only",
        "expiry-only",
        "athlete-only",
        "json-null",
        "empty-json",
        "identical-payloads",
    ],
)
def test_slack_identity_migration_rejects_ambiguous_groups_atomically(isolated_postgres, first, second):
    engine = isolated_postgres
    _legacy_slack_users(engine)
    with engine.begin() as connection:
        _insert_identity(connection, 1, "U_SAFE", user_id=1)
        _insert_identity(connection, 2, "U_SAFE", meta='{"donor":true}')
        _insert_identity(connection, 10, "U_CONFLICT", **first)
        _insert_identity(connection, 11, "U_CONFLICT", **second)
        _insert_identity(connection, 20, "U_CONTROL", user_id=2)
    before = _identity_rows(engine)
    with pytest.raises(DBAPIError) as error, engine.begin() as connection:
        _apply_identity_migration(connection)
    assert error.value.orig.pgcode == "P0001"
    assert error.value.orig.diag.message_primary == "Slack identity reconciliation requires manual resolution"
    assert _identity_rows(engine) == before
    assert not _identity_constraint_exists(engine)


@pytest.mark.parametrize(
    "payload",
    [
        {"strava_access_token": ""},
        {"strava_refresh_token": "synthetic-refresh-only"},
        {"strava_expires_at": "2027-01-02 03:04:05"},
        {"strava_athlete_id": 0},
        {"meta": "null"},
        {"meta": "{}"},
        {"meta": "[]"},
        {"meta": '{"empty":"","zero":0,"nested":[false,null,{"x":[]}]}'},
    ],
    ids=[
        "empty-access",
        "refresh",
        "expiry",
        "zero-athlete",
        "json-null",
        "empty-object",
        "empty-array",
        "nested-json",
    ],
)
def test_slack_identity_migration_keeps_partial_integration_payload(isolated_postgres, payload):
    engine = isolated_postgres
    _legacy_slack_users(engine)
    with engine.begin() as connection:
        _insert_identity(connection, 1, "U_PARTIAL", user_id=1)
        _insert_identity(connection, 2, "U_PARTIAL", **payload)
    before = _identity_rows(engine)
    expected = before[1].copy()
    for field in INTEGRATION_FIELDS:
        expected[field] = before[2][field]
    with engine.begin() as connection:
        _apply_identity_migration(connection)
    assert _identity_rows(engine) == {1: expected}


def test_slack_identity_unique_index_scopes_to_workspace(isolated_postgres):
    engine = isolated_postgres
    _legacy_slack_users(engine)
    with engine.begin() as connection:
        _insert_identity(connection, 1, "U_UNIQUE", user_id=1)
        _apply_identity_migration(connection)
    with pytest.raises(IntegrityError) as error, engine.begin() as connection:
        _insert_identity(connection, 2, "U_UNIQUE", user_id=2)
    assert error.value.orig.pgcode == "23505"
    assert error.value.orig.diag.constraint_name == IDENTITY_CONSTRAINT
    with engine.begin() as connection:
        _insert_identity(connection, 3, "U_UNIQUE", user_id=1, slack_team_id="T_OTHER")
        _insert_identity(connection, 4, "U_SECOND_ACCOUNT", user_id=1)
    assert set(_identity_rows(engine)) == {1, 3, 4}


def test_slack_identity_migration_later_failure_rolls_back_repair_and_constraint(isolated_postgres):
    engine = isolated_postgres
    _legacy_slack_users(engine)
    with engine.begin() as connection:
        _insert_identity(connection, 1, "U_ROLLBACK", user_id=1)
        _insert_identity(connection, 2, "U_ROLLBACK", meta='{"donor":true}')
    before = _identity_rows(engine)
    with pytest.raises(DBAPIError) as error, engine.begin() as connection:
        _apply_identity_migration(connection)
        connection.exec_driver_sql("DO $$ BEGIN RAISE EXCEPTION 'synthetic later migration failure'; END $$")
    assert error.value.orig.diag.message_primary == "synthetic later migration failure"
    assert _identity_rows(engine) == before
    assert not _identity_constraint_exists(engine)
    with engine.connect() as connection:
        assert (
            connection.execute(
                text(
                    "SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'public.slack_users'::regclass "
                    "AND tgname = 'set_updated_slack_users'"
                )
            ).scalar_one()
            == "O"
        )


def test_slack_identity_restore_rehearsal(isolated_postgres):
    engine = isolated_postgres
    _legacy_slack_users(engine)
    with engine.begin() as connection:
        _insert_identity(connection, 1, "U_RESTORE", user_id=1)
        _insert_identity(connection, 2, "U_RESTORE", strava_refresh_token="synthetic-donor", meta="null")
        _insert_identity(connection, 3, "U_CONTROL", meta='{"keep":true}')
    before = _identity_rows(engine)
    # Keep synthetic preimages across the migration commit on the same session.
    # Release recovery instead requires a verified durable backup of every affected row.
    with engine.connect() as connection:
        with connection.begin():
            connection.exec_driver_sql(
                "CREATE TEMP TABLE slack_users_restore ON COMMIT PRESERVE ROWS AS "
                "SELECT * FROM public.slack_users WHERE slack_id = 'U_RESTORE'"
            )
        with connection.begin():
            _apply_identity_migration(connection)
        assert _identity_rows(engine)[1]["strava_refresh_token"] == "synthetic-donor"
        with connection.begin():
            connection.exec_driver_sql("SET LOCAL lock_timeout = '3s'")
            connection.exec_driver_sql("LOCK TABLE public.slack_users IN SHARE ROW EXCLUSIVE MODE")
            connection.exec_driver_sql(f"ALTER TABLE public.slack_users DROP CONSTRAINT {IDENTITY_CONSTRAINT}")
            connection.exec_driver_sql(
                "DELETE FROM public.slack_users AS current_row USING pg_temp.slack_users_restore AS original_row "
                "WHERE current_row.slack_id = original_row.slack_id "
                "AND current_row.slack_team_id = original_row.slack_team_id"
            )
            connection.exec_driver_sql("INSERT INTO public.slack_users SELECT * FROM pg_temp.slack_users_restore")
        assert _identity_rows(engine) == before
        assert not _identity_constraint_exists(engine)
        with connection.begin():
            connection.exec_driver_sql("DROP TABLE pg_temp.slack_users_restore")
