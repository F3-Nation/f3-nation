import hashlib
import json
import os
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from f3_data_models import utils as data_model_utils
from f3_data_models.models import Base, SlackUser, User
from sqlalchemy import create_engine, event, inspect, select, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from utilities import helper_functions

POSTGRES_IMAGE = os.environ.get(
    "SLACKBOT_POSTGRES_IMAGE",
    "postgres:18.6-trixie@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280",
)
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
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE slack_spaces (id integer PRIMARY KEY, team_id text NOT NULL)")
            connection.exec_driver_sql("CREATE TABLE orgs_x_slack_spaces (org_id integer, slack_space_id integer)")
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


def _assert_single_synthetic_link(engine, slack_id, slack_user_id, expected_user_id=None, expected_flags=False):
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
        assert slack_user.is_admin is expected_flags
        assert slack_user.is_owner is expected_flags
        assert slack_user.is_bot is expected_flags
        return slack_user, user


def test_direct_create_user_serial_calls_commit_and_return_synthetic_identity(isolated_postgres):
    slack_id = "U_TEST_SERIAL_1101"
    profile = {
        "email": "fabricated.serial@example.invalid",
        "real_name": "Fabricated Serial Name",
        "image_192": "https://example.invalid/fabricated-serial.png",
    }

    first = helper_functions.create_user({"id": slack_id, "profile": profile}, team_id="T_SERIAL")
    second = helper_functions.create_user({"id": slack_id, "profile": profile}, team_id="T_SERIAL")

    assert first.id == second.id
    assert first.slack_id == second.slack_id == slack_id
    assert first.user_id == second.user_id
    persisted, user = _assert_single_synthetic_link(isolated_postgres, slack_id, first.user_id)
    assert persisted.email != profile["email"]
    assert persisted.user_name != profile["real_name"]
    assert persisted.avatar_url != profile["image_192"]
    assert user.home_region_id is None


def _assert_contended_create(isolated_postgres, slack_id, initial_orphan=False, production=False):
    team_id = "T_ORIGINAL_ORPHAN" if initial_orphan else "T_CONCURRENT"
    original_slack_user_id = None
    if initial_orphan:
        with isolated_postgres.begin() as connection:
            result = connection.execute(
                text(
                    """INSERT INTO slack_users
                       (slack_id, user_name, email, is_admin, is_owner, is_bot, user_id, avatar_url, slack_team_id,
                        strava_access_token, meta)
                       VALUES (:slack_id, :name, :email, true, true, true, NULL, :avatar, :team,
                               'fabricated-orphan-token', '{"sentinel":"orphan"}')
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
    pair = json.dumps([team_id, slack_id], separators=(",", ":"))
    lock_key = int.from_bytes(hashlib.sha256(pair.encode("utf-8")).digest()[:8], "big", signed=True)

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
            first_future = executor.submit(helper_functions.create_user, payload, None, team_id)
            assert lock_acquired.wait(timeout=5), "first call did not acquire advisory lock"

            def second_call():
                second_started.set()
                return helper_functions.create_user(payload, None, team_id)

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
    assert inspect(first).detached and inspect(second).detached
    assert first.slack_team_id == second.slack_team_id == team_id
    if production:
        with Session(isolated_postgres) as session:
            identities = session.scalars(select(SlackUser)).all()
            users = session.scalars(select(User)).all()
            assert len(identities) == len(users) == 1
            assert identities[0].id == first.id
            assert identities[0].user_id == users[0].id == first.user_id
            assert users[0].email == "fabricated.concurrent@example.invalid"
            assert identities[0].is_admin is initial_orphan
            assert identities[0].is_owner is initial_orphan
            assert identities[0].is_bot is initial_orphan
            if initial_orphan:
                assert identities[0].strava_access_token == "fabricated-orphan-token"
                assert identities[0].meta == {"sentinel": "orphan"}
        return
    persisted, user = _assert_single_synthetic_link(
        isolated_postgres,
        slack_id,
        first.user_id,
        expected_user_id=first.user_id,
        expected_flags=initial_orphan,
    )
    assert persisted.email != payload["profile"]["email"]
    assert persisted.user_name != payload["profile"]["real_name"]
    assert persisted.avatar_url != payload["profile"]["image_192"]
    assert user.home_region_id is None
    if original_slack_user_id is not None:
        assert persisted.id == original_slack_user_id
        assert persisted.slack_team_id == "T_ORIGINAL_ORPHAN"
        assert persisted.strava_access_token == "fabricated-orphan-token"
        assert persisted.meta == {"sentinel": "orphan"}


def test_concurrent_direct_create_user_for_absent_slack_user(isolated_postgres):
    _assert_contended_create(isolated_postgres, "U_TEST_CONCURRENT_1101")


def test_concurrent_direct_create_user_links_committed_orphan(isolated_postgres):
    _assert_contended_create(isolated_postgres, "U_TEST_ORPHAN_1101", initial_orphan=True)


@pytest.mark.parametrize("orphan", [False, True])
def test_production_same_pair_concurrent_creation(isolated_postgres, monkeypatch, orphan):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    _assert_contended_create(isolated_postgres, "U_PRODUCTION_CONCURRENT", initial_orphan=orphan, production=True)


def test_production_distinct_pairs_concurrently_share_case_insensitive_email(isolated_postgres, monkeypatch):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    inserted = threading.Event()
    release = threading.Event()

    def hold_first_insert(_conn, _cursor, statement, _parameters, _context, _executemany):
        if statement.startswith("INSERT INTO users ") and not inserted.is_set():
            inserted.set()
            if not release.wait(timeout=10):
                raise TimeoutError("test did not release uncommitted email insert")

    def create(team, email):
        return helper_functions.create_user(
            {"id": "U_SHARED", "profile": {"email": email, "display_name": team}}, None, team
        )

    event.listen(isolated_postgres, "after_cursor_execute", hold_first_insert)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            try:
                first_future = executor.submit(create, "T_FIRST", "Same@example.invalid")
                assert inserted.wait(timeout=5), "first worker did not insert an uncommitted User"
                second_future = executor.submit(create, "T_SECOND", "same@EXAMPLE.invalid")
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    with isolated_postgres.connect() as observer:
                        waiting = observer.execute(
                            text(
                                "SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid "
                                "WHERE l.locktype = 'transactionid' AND NOT l.granted "
                                "AND a.datname = current_database() AND a.wait_event_type = 'Lock' "
                                "AND a.query LIKE 'INSERT INTO users %'"
                            )
                        ).first()
                    if waiting:
                        break
                    if second_future.done():
                        pytest.fail("second worker completed without waiting on the uncommitted email")
                    time.sleep(0.05)
                else:
                    pytest.fail("no PostgreSQL transaction-lock waiter for the conflicting email insert")
            finally:
                release.set()
            first = first_future.result(timeout=10)
            second = second_future.result(timeout=10)
    finally:
        release.set()
        event.remove(isolated_postgres, "after_cursor_execute", hold_first_insert)
    assert first.id != second.id
    assert first.user_id == second.user_id
    assert inspect(first).detached and inspect(second).detached
    with Session(isolated_postgres) as session:
        assert len(session.scalars(select(User)).all()) == 1
        assert {(row.slack_team_id, row.slack_id, row.user_id) for row in session.scalars(select(SlackUser))} == {
            ("T_FIRST", "U_SHARED", first.user_id),
            ("T_SECOND", "U_SHARED", first.user_id),
        }


@pytest.mark.parametrize("linked", [False, True])
def test_production_preserves_stored_identity_and_integrations(isolated_postgres, monkeypatch, linked):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    with Session(isolated_postgres) as session:
        user = User(email="stored@example.invalid", f3_name="Stored F3", avatar_url="stored-f3-avatar")
        session.add(user)
        session.flush()
        user_id = user.id
        identity = SlackUser(
            slack_id="U_STORED",
            slack_team_id="T_STORED",
            email=user.email,
            user_id=user.id if linked else None,
            user_name="Stored Slack",
            avatar_url="stored-avatar",
            is_admin=False,
            is_owner=False,
            is_bot=False,
            strava_access_token="fabricated-access",
            strava_refresh_token="fabricated-refresh",
            strava_expires_at=datetime(2026, 1, 2, 3, 4, 5),
            strava_athlete_id=5678,
            meta={"sentinel": "retained"},
        )
        session.add(identity)
        session.commit()
        identity_id = identity.id
    for profile in [None, {"email": "changed@example.invalid"}] if linked else [None]:
        result = helper_functions.create_user({"id": "U_STORED", "profile": profile}, team_id="T_STORED")
        assert result.id == identity_id and result.user_id == user_id
        assert inspect(result).detached
        assert result.user_name == "Stored Slack" and result.avatar_url == "stored-avatar"
        assert result.strava_access_token == "fabricated-access"
        assert result.strava_refresh_token == "fabricated-refresh"
        assert result.strava_expires_at == datetime(2026, 1, 2, 3, 4, 5) and result.strava_athlete_id == 5678
        assert result.meta == {"sentinel": "retained"}
    with Session(isolated_postgres) as session:
        assert len(session.scalars(select(User)).all()) == 1
        assert session.get(SlackUser, identity_id).user_id == user_id


def test_bulk_import_repeated_pairs_preserve_links_and_integrations(isolated_postgres, monkeypatch):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    member = {
        "id": "U_IMPORT",
        "updated": 17,
        "profile": {
            "email": "import@example.invalid",
            "display_name": "Import Name",
            "real_name": "Import Real",
            "image_192": "import-avatar",
        },
    }
    client = SimpleNamespace(users_list=lambda: {"members": [member, {**member, "id": "USLACKBOT"}]})
    for _ in range(2):
        helper_functions.populate_users(client, "T_IMPORT")
    with Session(isolated_postgres) as session:
        rows = session.scalars(select(SlackUser)).all()
        assert len(rows) == 1
        row = rows[0]
        assert row.slack_updated == 17 and row.user_id is not None
        identity_id, user_id = row.id, row.user_id
        row.strava_access_token = "fabricated-import-token"
        row.meta = {"sentinel": "import"}
        session.commit()
    helper_functions.populate_users(client, "T_IMPORT")
    helper_functions.populate_users(client, "T_OTHER")
    with Session(isolated_postgres) as session:
        rows = session.scalars(select(SlackUser)).all()
        assert len(rows) == 2
        retained = session.get(SlackUser, identity_id)
        assert retained.user_id == user_id and retained.strava_access_token == "fabricated-import-token"
        assert retained.meta == {"sentinel": "import"}
        assert {row.slack_team_id for row in rows} == {"T_IMPORT", "T_OTHER"}


def test_bulk_import_without_email_preserves_unlinked_workspace_identity(isolated_postgres, monkeypatch):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    member = {"id": "U_HIDDEN", "profile": {"display_name": "Hidden", "real_name": "", "image_192": None}}
    client = SimpleNamespace(users_list=lambda: {"members": [member]})
    for _ in range(2):
        helper_functions.populate_users(client, "T_IMPORT")
    with Session(isolated_postgres) as session:
        assert session.scalars(select(User)).all() == []
        rows = session.scalars(select(SlackUser)).all()
        assert len(rows) == 1
        assert rows[0].user_id is None and rows[0].user_name == "Hidden"
        identity_id = rows[0].id
    linked = helper_functions.create_user(
        {**member, "profile": {**member["profile"], "email": "member@example.invalid"}}, team_id="T_IMPORT"
    )
    assert linked.id == identity_id and linked.user_id is not None


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
            connection.exec_driver_sql(statement, execution_options={"no_parameters": True})


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
        _insert_identity(connection, 21, "U_LOWEST_LINKED", user_id=1)
        _insert_identity(connection, 20, "U_LOWEST_LINKED", user_id=1)
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
        _insert_identity(connection, 51, "U_UNLINKED_EMPTY")
        _insert_identity(connection, 50, "U_UNLINKED_EMPTY")
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
    assert error.value.orig.diag.message_detail == "1 ambiguous (slack_id, slack_team_id) groups"
    assert "distinct user_id" in error.value.orig.diag.message_hint
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


@pytest.mark.parametrize("legacy", [False, True])
def test_slack_identity_restore_rehearsal(isolated_postgres, legacy):
    engine = isolated_postgres
    _legacy_slack_users(engine)
    with engine.begin() as connection:
        _insert_identity(connection, 1, "U_RESTORE", user_id=1)
        _insert_identity(connection, 2, "U_RESTORE", strava_refresh_token="synthetic-donor", meta="null")
        _insert_identity(connection, 3, "U_CONTROL", meta='{"keep":true}')
        if legacy:
            connection.exec_driver_sql("INSERT INTO orgs VALUES (10)")
            connection.exec_driver_sql("UPDATE users SET home_region_id=10 WHERE id=1")
            connection.exec_driver_sql("INSERT INTO slack_spaces VALUES (1,'T_REGION')")
            connection.exec_driver_sql("INSERT INTO orgs_x_slack_spaces VALUES (10,1)")
            _insert_identity(connection, 4, "U_LEGACY_RESTORE", user_id=1, slack_team_id="NOT FOUND")
    before = _identity_rows(engine)
    # Keep synthetic preimages across the migration commit on the same session.
    # Release recovery instead requires a verified durable backup of every affected row.
    with engine.connect() as connection:
        with connection.begin():
            connection.exec_driver_sql(
                "CREATE TEMP TABLE slack_users_restore ON COMMIT PRESERVE ROWS AS "
                "SELECT * FROM public.slack_users WHERE slack_id IN ('U_RESTORE', 'U_LEGACY_RESTORE')"
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
                "WHERE current_row.id = original_row.id"
            )
            connection.exec_driver_sql("INSERT INTO public.slack_users SELECT * FROM pg_temp.slack_users_restore")
        assert _identity_rows(engine) == before
        assert not _identity_constraint_exists(engine)
        with connection.begin():
            connection.exec_driver_sql("DROP TABLE pg_temp.slack_users_restore")


@pytest.mark.parametrize("production", [False, True])
def test_failed_commit_rolls_back_all_identity_writes_and_cache(isolated_postgres, monkeypatch, production):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: production)
    retained = SimpleNamespace(user_id=9)
    helper_functions.SLACK_USERS[("T_OTHER", "U_RETAINED")] = retained

    def reject_commit(_session):
        raise RuntimeError("fabricated commit failure")

    event.listen(Session, "before_commit", reject_commit)
    try:
        with pytest.raises(RuntimeError, match="fabricated commit failure"):
            helper_functions.create_user(
                {"id": "U_ROLLBACK", "profile": {"email": "rollback@example.invalid", "display_name": "Rollback"}},
                team_id="T_ROLLBACK",
            )
    finally:
        event.remove(Session, "before_commit", reject_commit)
    assert helper_functions.SLACK_USERS == {("T_OTHER", "U_RETAINED"): retained}
    with Session(isolated_postgres) as session:
        assert session.scalars(select(User)).all() == []
        assert session.scalars(select(SlackUser)).all() == []


def test_nonproduction_same_slack_account_has_independent_workspace_links(isolated_postgres):
    first = helper_functions.create_user({"id": "U_MULTI"}, team_id="T_FIRST")
    second = helper_functions.create_user({"id": "U_MULTI"}, team_id="T_SECOND")
    assert first.id != second.id and first.user_id != second.user_id
    assert first.slack_team_id == "T_FIRST" and second.slack_team_id == "T_SECOND"
    with Session(isolated_postgres) as session:
        assert len(session.scalars(select(User)).all()) == 2
        assert len(session.scalars(select(SlackUser)).all()) == 2


@pytest.mark.parametrize("bot", [False, True])
def test_production_no_email_identity_waits_for_email_before_linking(isolated_postgres, monkeypatch, bot):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    result = helper_functions.create_user(
        {
            "id": "U_NO_EMAIL",
            "is_bot": bot,
            "updated": 12,
            "profile": {"display_name": "Display", "real_name": "Real", "image_192": "profile-avatar"},
        },
        team_id="T_NO_EMAIL",
    )
    assert result.email == "u_no_email" and result.user_id is None and result.is_bot is bot
    assert result.user_name == "Display" and result.avatar_url == "profile-avatar" and result.slack_updated == 12
    with Session(isolated_postgres) as session:
        assert session.scalars(select(User)).all() == []
        assert session.get(SlackUser, result.id).user_id is None
    linked = helper_functions.create_user(
        {"id": "U_NO_EMAIL", "profile": {"email": "Verified@Example.invalid", "display_name": "Display"}},
        team_id="T_NO_EMAIL",
    )
    assert linked.id == result.id and linked.user_id is not None
    other_workspace = helper_functions.create_user({"id": "U_NO_EMAIL", "profile": {}}, team_id="T_OTHER")
    assert other_workspace.user_id is None and other_workspace.id != linked.id
    with Session(isolated_postgres) as session:
        users = session.scalars(select(User)).all()
        assert len(users) == 1 and users[0].id == linked.user_id
        assert users[0].email == "verified@example.invalid"


def test_production_pair_insert_preserves_importer_winning_link(isolated_postgres, monkeypatch):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    with Session(isolated_postgres) as session:
        winner = User(email="winner@example.invalid", f3_name="Winner")
        session.add(winner)
        session.commit()
        winner_id = winner.id
    inserted = False

    def importer_wins(_conn, _cursor, statement, _parameters, _context, _executemany):
        nonlocal inserted
        if statement.startswith("INSERT INTO slack_users ") and not inserted:
            inserted = True
            with isolated_postgres.begin() as connection:
                connection.execute(
                    text(
                        "INSERT INTO slack_users (slack_id, slack_team_id, user_id, user_name, email, "
                        "strava_access_token, meta, is_admin, is_owner, is_bot) "
                        "VALUES ('U_WINNER', 'T_WINNER', :user_id, 'Importer Winner', 'winner@example.invalid', "
                        "'fabricated-winner', "
                        "CAST(:meta AS jsonb), false, false, false)"
                    ),
                    {"user_id": winner_id, "meta": json.dumps({"sentinel": True})},
                )

    event.listen(isolated_postgres, "before_cursor_execute", importer_wins)
    try:
        result = helper_functions.create_user(
            {"id": "U_WINNER", "profile": {"email": "request@example.invalid", "display_name": "Request"}},
            team_id="T_WINNER",
        )
    finally:
        event.remove(isolated_postgres, "before_cursor_execute", importer_wins)
    assert inserted and result.user_id == winner_id and result.user_name == "Importer Winner"
    assert result.strava_access_token == "fabricated-winner" and result.meta == {"sentinel": True}
    with Session(isolated_postgres) as session:
        rows = session.scalars(select(SlackUser)).all()
        assert len(rows) == 1 and rows[0].id == result.id and rows[0].user_id == winner_id


def test_production_existing_workspace_identity_is_unchanged_when_member_joins_another(isolated_postgres, monkeypatch):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    first = helper_functions.create_user(
        {
            "id": "U_SERIAL_TEAMS",
            "updated": 11,
            "is_admin": True,
            "is_owner": True,
            "profile": {
                "email": "Shared.Member@example.invalid",
                "display_name": "Workspace A Member",
                "real_name": "Workspace A Real Name",
                "image_192": "https://example.invalid/workspace-a-avatar.png",
            },
        },
        team_id="T_SERIAL_A",
    )
    with Session(isolated_postgres) as session:
        identity = session.get(SlackUser, first.id)
        identity.strava_access_token = "fabricated-workspace-a-access"
        identity.strava_refresh_token = "fabricated-workspace-a-refresh"
        identity.strava_expires_at = datetime(2026, 2, 3, 4, 5, 6)
        identity.strava_athlete_id = 9012
        identity.meta = {"sentinel": "workspace-a", "nested": {"retained": True}}
        identity.created = datetime(2026, 1, 1, 1, 2, 3)
        identity.updated = datetime(2026, 1, 2, 2, 3, 4)
        user = session.get(User, first.user_id)
        user.f3_name = "Existing F3 Profile"
        user.first_name = "Fabricated Existing First"
        user.last_name = "Fabricated Existing Last"
        user.avatar_url = "https://example.invalid/existing-f3-avatar.png"
        session.commit()
    first_before = _identity_rows(isolated_postgres)[first.id]
    with isolated_postgres.connect() as connection:
        user_before = dict(connection.execute(select(User.__table__)).mappings().one())

    second = helper_functions.create_user(
        {
            "id": "U_SERIAL_TEAMS",
            "updated": 22,
            "profile": {
                "email": "SHARED.MEMBER@EXAMPLE.invalid",
                "display_name": "Workspace B Member",
                "real_name": "Workspace B Real Name",
                "image_192": "https://example.invalid/workspace-b-avatar.png",
            },
        },
        team_id="T_SERIAL_B",
    )

    assert second.id != first.id
    assert second.user_id == first.user_id
    assert second.slack_team_id == "T_SERIAL_B" and second.slack_id == "U_SERIAL_TEAMS"
    assert second.user_name == "Workspace B Member"
    assert second.avatar_url == "https://example.invalid/workspace-b-avatar.png"
    assert second.slack_updated == 22 and second.is_admin is False and second.is_owner is False
    assert inspect(second).detached
    identities = _identity_rows(isolated_postgres)
    assert len(identities) == 2
    assert identities[first.id] == first_before
    assert {(row["slack_team_id"], row["slack_id"], row["user_id"]) for row in identities.values()} == {
        ("T_SERIAL_A", "U_SERIAL_TEAMS", first.user_id),
        ("T_SERIAL_B", "U_SERIAL_TEAMS", first.user_id),
    }
    with isolated_postgres.connect() as connection:
        assert [dict(row) for row in connection.execute(select(User.__table__)).mappings()] == [user_before]
    assert set(helper_functions.SLACK_USERS) == {("T_SERIAL_A", "U_SERIAL_TEAMS"), ("T_SERIAL_B", "U_SERIAL_TEAMS")}
    assert helper_functions.SLACK_USERS[("T_SERIAL_A", "U_SERIAL_TEAMS")] is first
    assert helper_functions.SLACK_USERS[("T_SERIAL_B", "U_SERIAL_TEAMS")] is second


@pytest.mark.parametrize("inherits_owner", [False, True])
def test_identity_migration_requires_effective_owner_privileges(isolated_postgres, inherits_owner):
    _legacy_slack_users(isolated_postgres)
    with isolated_postgres.begin() as connection:
        connection.exec_driver_sql("CREATE ROLE identity_migration_owner NOLOGIN")
        connection.exec_driver_sql("CREATE ROLE identity_migration_runner NOLOGIN INHERIT")
        connection.exec_driver_sql("ALTER TABLE public.slack_users OWNER TO identity_migration_owner")
        connection.exec_driver_sql("GRANT USAGE, CREATE ON SCHEMA public TO identity_migration_runner")
        connection.exec_driver_sql("GRANT ALL ON public.slack_users TO identity_migration_runner")
        connection.exec_driver_sql(
            "GRANT SELECT ON public.users, public.slack_spaces, public.orgs_x_slack_spaces TO identity_migration_runner"
        )
        if inherits_owner:
            connection.exec_driver_sql("GRANT identity_migration_owner TO identity_migration_runner")
    if inherits_owner:
        with isolated_postgres.begin() as connection:
            connection.exec_driver_sql("SET LOCAL ROLE identity_migration_runner")
            _apply_identity_migration(connection)
        assert _identity_constraint_exists(isolated_postgres)
    else:
        with pytest.raises(DBAPIError) as error, isolated_postgres.begin() as connection:
            connection.exec_driver_sql("SET LOCAL ROLE identity_migration_runner")
            _apply_identity_migration(connection)
        assert error.value.orig.diag.message_primary == (
            "Slack identity migration requires table-owner privileges on public.slack_users"
        )
        assert not _identity_constraint_exists(isolated_postgres)


@pytest.mark.parametrize("trigger_mode", [None, "O", "D", "R", "A"])
def test_migration_rehomes_legacy_identity_and_preserves_link(isolated_postgres, monkeypatch, trigger_mode):
    engine = isolated_postgres
    _legacy_slack_users(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql("INSERT INTO orgs VALUES (10)")
        connection.exec_driver_sql("UPDATE users SET home_region_id = 10 WHERE id = 1")
        connection.exec_driver_sql("INSERT INTO slack_spaces VALUES (1, 'T_REGION')")
        connection.exec_driver_sql("INSERT INTO orgs_x_slack_spaces VALUES (10, 1)")
        if trigger_mode is None:
            connection.exec_driver_sql("DROP TRIGGER set_updated_slack_users ON public.slack_users")
        else:
            action = {"O": "ENABLE", "D": "DISABLE", "R": "ENABLE REPLICA", "A": "ENABLE ALWAYS"}[trigger_mode]
            connection.exec_driver_sql(f"ALTER TABLE slack_users {action} TRIGGER set_updated_slack_users")
        _insert_identity(
            connection,
            10,
            "U_LEGACY",
            user_id=1,
            slack_team_id="NOT FOUND",
            strava_athlete_id=123,
            strava_access_token="synthetic-access",
            meta='{"keep":true}',
        )
    before = _identity_rows(engine)
    with engine.begin() as connection:
        _apply_identity_migration(connection)
    expected = before[10].copy()
    expected["slack_team_id"] = "T_REGION"
    assert _identity_rows(engine) == {10: expected}
    with engine.connect() as connection:
        assert (
            connection.exec_driver_sql(
                "SELECT tgenabled FROM pg_trigger WHERE tgrelid='slack_users'::regclass "
                "AND tgname='set_updated_slack_users'"
            ).scalar_one_or_none()
            == trigger_mode
        )
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    result = helper_functions.create_user({"id": "U_LEGACY", "profile": {}}, team_id="T_REGION")
    assert result.user_id == 1 and result.strava_athlete_id == 123
    with engine.connect() as connection:
        assert connection.exec_driver_sql("SELECT count(*) FROM users").scalar_one() == 2


@pytest.mark.parametrize("kind", ["missing-map", "ambiguous-map", "occupied-target", "unlinked"])
def test_migration_refuses_uncertain_legacy_mapping_atomically(isolated_postgres, kind):
    engine = isolated_postgres
    _legacy_slack_users(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql("INSERT INTO orgs VALUES (10)")
        connection.exec_driver_sql("UPDATE users SET home_region_id=10 WHERE id=1")
        connection.exec_driver_sql("INSERT INTO slack_spaces VALUES (1,'T_REGION'), (2,'T_OTHER')")
        if kind != "missing-map":
            connection.exec_driver_sql("INSERT INTO orgs_x_slack_spaces VALUES (10,1)")
        if kind == "ambiguous-map":
            connection.exec_driver_sql("INSERT INTO orgs_x_slack_spaces VALUES (10,2)")
        _insert_identity(
            connection,
            10,
            "U_LEGACY",
            user_id=None if kind == "unlinked" else 1,
            slack_team_id="NOT FOUND",
            strava_athlete_id=123,
        )
        if kind == "occupied-target":
            _insert_identity(connection, 11, "U_LEGACY", user_id=1, slack_team_id="T_REGION")
        _insert_identity(connection, 20, "U_SAFE", user_id=2)
        _insert_identity(connection, 21, "U_SAFE")
    before = _identity_rows(engine)
    with pytest.raises(DBAPIError) as error, engine.begin() as connection:
        _apply_identity_migration(connection)
    assert error.value.orig.diag.message_primary == "Slack legacy workspace reconciliation requires manual resolution"
    assert error.value.orig.diag.message_detail == "1 unresolved legacy identities"
    assert "workspace" in error.value.orig.diag.message_hint
    assert _identity_rows(engine) == before
    assert not _identity_constraint_exists(engine)


def test_legacy_rehome_rolls_back_on_later_failure(isolated_postgres):
    engine = isolated_postgres
    _legacy_slack_users(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql("INSERT INTO orgs VALUES (10)")
        connection.exec_driver_sql("UPDATE users SET home_region_id=10 WHERE id=1")
        connection.exec_driver_sql("INSERT INTO slack_spaces VALUES (1,'T_REGION')")
        connection.exec_driver_sql("INSERT INTO orgs_x_slack_spaces VALUES (10,1)")
        _insert_identity(connection, 10, "U_LEGACY", user_id=1, slack_team_id="NOT FOUND")
    before = _identity_rows(engine)
    with pytest.raises(DBAPIError), engine.begin() as connection:
        _apply_identity_migration(connection)
        connection.exec_driver_sql("SELECT 1/0")
    assert _identity_rows(engine) == before
    assert not _identity_constraint_exists(engine)


def test_migration_rejects_legacy_conflict_before_rehoming(isolated_postgres):
    engine = isolated_postgres
    _legacy_slack_users(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql("INSERT INTO orgs VALUES (10), (20)")
        connection.exec_driver_sql("UPDATE users SET home_region_id = id * 10")
        connection.exec_driver_sql("INSERT INTO slack_spaces VALUES (1, 'T_ONE'), (2, 'T_TWO')")
        connection.exec_driver_sql("INSERT INTO orgs_x_slack_spaces VALUES (10, 1), (20, 2)")
        _insert_identity(connection, 10, "U_CONFLICT", user_id=1, slack_team_id="NOT FOUND")
        _insert_identity(connection, 11, "U_CONFLICT", user_id=2, slack_team_id="NOT FOUND")
    before = _identity_rows(engine)
    with pytest.raises(DBAPIError) as error, engine.begin() as connection:
        _apply_identity_migration(connection)
    assert error.value.orig.pgcode == "P0001"
    assert error.value.orig.diag.message_detail == "1 ambiguous (slack_id, slack_team_id) groups"
    assert _identity_rows(engine) == before
    assert not _identity_constraint_exists(engine)


def test_identity_migration_blocks_writers_until_commit(isolated_postgres):
    engine = isolated_postgres
    _legacy_slack_users(engine)
    statements = IDENTITY_MIGRATION.read_text().split("--> statement-breakpoint")
    lock_index = next(
        (i for i, statement in enumerate(statements) if "LOCK TABLE public.slack_users" in statement), None
    )
    assert lock_index is not None, "Migration must explicitly lock writers before inspecting identities"
    assert "LOCK TABLE public.slack_users IN SHARE ROW EXCLUSIVE MODE" in statements[lock_index]
    inspection_index = next(i for i, statement in enumerate(statements) if "conflict_count" in statement)
    assert lock_index < inspection_index
    with engine.begin() as migration:
        for statement in statements[: lock_index + 1]:
            migration.exec_driver_sql(statement, execution_options={"no_parameters": True})
        with pytest.raises(DBAPIError) as error, engine.begin() as writer:
            writer.exec_driver_sql("SET LOCAL lock_timeout = '100ms'")
            _insert_identity(writer, 1, "U_BLOCKED")
        assert error.value.orig.pgcode == "55P03"
        for statement in statements[lock_index + 1 :]:
            if statement.strip():
                migration.exec_driver_sql(statement, execution_options={"no_parameters": True})
    with engine.begin() as writer:
        _insert_identity(writer, 1, "U_AFTER_COMMIT")
    assert _identity_rows(engine)[1]["slack_id"] == "U_AFTER_COMMIT"


def test_identity_migration_times_out_on_active_writer(isolated_postgres):
    engine = isolated_postgres
    _legacy_slack_users(engine)
    with engine.begin() as writer:
        _insert_identity(writer, 1, "U_ACTIVE")
        with pytest.raises(DBAPIError) as error, engine.begin() as migration:
            migration.exec_driver_sql("SET LOCAL statement_timeout = '5s'")
            _apply_identity_migration(migration)
        assert error.value.orig.pgcode == "55P03"
    assert not _identity_constraint_exists(engine)
    assert _identity_rows(engine)[1]["slack_id"] == "U_ACTIVE"
