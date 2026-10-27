import os
import subprocess
import sys
import time

import pytest
from f3_data_models import utils as data_model_utils
from f3_data_models.models import Base, User
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL
from sqlalchemy.orm import Session, sessionmaker

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts import fng_reminders  # noqa: E402

POSTGRES_IMAGE = "postgres:18.6-trixie@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280"
pytestmark = pytest.mark.skipif(
    os.environ.get("SLACKBOT_POSTGRES_TESTS") != "1",
    reason="set SLACKBOT_POSTGRES_TESTS=1 to run disposable-Postgres integration tests",
)


@pytest.fixture
def isolated_postgres(monkeypatch):
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
                "POSTGRES_USER=fng_test",
                "--env",
                "POSTGRES_PASSWORD=fng_test",
                "--env",
                "POSTGRES_DB=fng_test",
                POSTGRES_IMAGE,
            ],
            text=True,
        ).strip()
        subprocess.run(["docker", "start", container_id], check=True, capture_output=True, text=True)
        published_port = subprocess.check_output(["docker", "port", container_id, "5432/tcp"], text=True).strip()
        port = int(published_port.rsplit(":", maxsplit=1)[1])
        url = URL.create(
            "postgresql+psycopg2",
            username="fng_test",
            password="fng_test",
            host="127.0.0.1",
            port=port,
            database="fng_test",
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
            # users.home_region_id references orgs; only the key is needed.
            connection.execute(text("CREATE TABLE orgs (id integer PRIMARY KEY)"))
        Base.metadata.tables["users"].create(engine)

        session_factory = sessionmaker(bind=engine)
        monkeypatch.setattr(data_model_utils, "get_session", lambda backend=None: session_factory())
        yield engine
    finally:
        if engine is not None:
            engine.dispose()
        if container_id:
            subprocess.run(["docker", "rm", "--force", container_id], check=True, capture_output=True, text=True)


def _insert_user(engine, meta):
    with Session(engine) as session:
        user = User(email="fng.reminders@example.invalid", f3_name="Chip", meta=meta)
        session.add(user)
        session.commit()
        return user.id


def _meta(engine, user_id):
    with Session(engine) as session:
        return session.get(User, user_id).meta


def test_saving_reminders_keeps_a_meta_change_made_after_the_job_read_it(isolated_postgres):
    user_id = _insert_user(isolated_postgres, {"battle_buddy": 7, "fng_reminders_sent": {"9": 1}})
    # The job has read meta; then a profile edit saves a new key before the reminder count is written.
    with isolated_postgres.begin() as connection:
        connection.execute(
            text("""UPDATE users SET meta = meta || '{"f3_name_origin": "edited"}'::jsonb WHERE id = :id"""),
            {"id": user_id},
        )

    fng_reminders.save_reminders_sent(user_id, {"9": 1, "7": 1})

    assert _meta(isolated_postgres, user_id) == {
        "battle_buddy": 7,
        "f3_name_origin": "edited",
        "fng_reminders_sent": {"9": 1, "7": 1},
    }


@pytest.mark.parametrize("sql_null", [False, True])
def test_saving_reminders_when_meta_is_null(isolated_postgres, sql_null):
    # The ORM stores None as JSON null; a raw write can leave SQL NULL.
    user_id = _insert_user(isolated_postgres, None)
    if sql_null:
        with isolated_postgres.begin() as connection:
            connection.execute(text("UPDATE users SET meta = NULL WHERE id = :id"), {"id": user_id})

    fng_reminders.save_reminders_sent(user_id, {"7": 1})

    assert _meta(isolated_postgres, user_id) == {"fng_reminders_sent": {"7": 1}}
