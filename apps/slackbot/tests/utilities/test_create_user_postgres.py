import hashlib
import os
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError

import pytest
from f3_data_models import utils as data_model_utils
from f3_data_models.models import Base, SlackUser, User
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.engine import URL
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
