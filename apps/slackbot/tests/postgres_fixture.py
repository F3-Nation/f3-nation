"""A disposable Postgres container for Slackbot integration tests.

A test module imports `isolated_postgres` and `requires_postgres`, and defines
a `postgres_schema` fixture that returns a callable taking the engine and
creating the tables the module needs. The fixture points
`f3_data_models.utils.get_session` at the container, so `session_scope()` in
application code writes to it.
"""

import os
import subprocess
import time

import pytest
from f3_data_models import utils as data_model_utils
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL
from sqlalchemy.orm import sessionmaker

POSTGRES_IMAGE = os.environ.get(
    "SLACKBOT_POSTGRES_IMAGE",
    "postgres:18.6-trixie@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280",
)
requires_postgres = pytest.mark.skipif(
    os.environ.get("SLACKBOT_POSTGRES_TESTS") != "1",
    reason="set SLACKBOT_POSTGRES_TESTS=1 to run disposable-Postgres integration tests",
)


@pytest.fixture
def isolated_postgres(monkeypatch, postgres_schema):
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

        postgres_schema(engine)

        session_factory = sessionmaker(bind=engine)
        monkeypatch.setattr(data_model_utils, "get_session", lambda backend=None: session_factory())
        yield engine
    finally:
        if engine is not None:
            engine.dispose()
        if container_id:
            subprocess.run(["docker", "rm", "--force", container_id], check=True, capture_output=True, text=True)
