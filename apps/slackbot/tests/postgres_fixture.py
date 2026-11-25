"""A disposable Postgres container for Slackbot integration tests.

A test module imports `isolated_postgres` and `requires_postgres`, and defines
a `postgres_schema` fixture that returns a callable taking the engine and
creating the tables the module needs. One container serves the whole pytest
session; each test gets its own freshly created database in it, dropped
afterwards, so no test sees another's schema, rows or connections. The fixture
points `f3_data_models.utils.get_session` at that database, so
`session_scope()` in application code writes to it.
"""

import os
import subprocess
import time
import uuid

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


def _url(port, database):
    return URL.create(
        "postgresql+psycopg2",
        username="slackbot_test",
        password="slackbot_test",
        host="127.0.0.1",
        port=port,
        database=database,
    )


@pytest.fixture(scope="session")
def postgres_server():
    """Start the session's container and yield an autocommit engine on its maintenance database."""
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
        engine = create_engine(_url(port, "slackbot_test"), isolation_level="AUTOCOMMIT", pool_pre_ping=True)

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

        yield engine
    finally:
        if engine is not None:
            engine.dispose()
        if container_id:
            subprocess.run(["docker", "rm", "--force", container_id], check=True, capture_output=True, text=True)


@pytest.fixture
def isolated_postgres(monkeypatch, postgres_schema, postgres_server):
    database = f"test_{uuid.uuid4().hex}"
    with postgres_server.connect() as connection:
        # Roles belong to the server, not the database, so they outlive the drop below.
        roles_before = set(connection.exec_driver_sql("SELECT rolname FROM pg_roles").scalars())
        connection.exec_driver_sql(f'CREATE DATABASE "{database}"')
    engine = None
    try:
        engine = create_engine(
            _url(postgres_server.url.port, database),
            pool_pre_ping=True,
        )
        postgres_schema(engine)

        session_factory = sessionmaker(bind=engine)
        monkeypatch.setattr(data_model_utils, "get_session", lambda backend=None: session_factory())
        yield engine
    finally:
        if engine is not None:
            engine.dispose()
        # FORCE ends connections a test leaked (an abandoned worker thread, say)
        # so the drop cannot hang.
        with postgres_server.connect() as connection:
            connection.exec_driver_sql(f'DROP DATABASE "{database}" WITH (FORCE)')
            roles_after = set(connection.exec_driver_sql("SELECT rolname FROM pg_roles").scalars())
            for role in sorted(roles_after - roles_before):
                drop = connection.execute(text("SELECT format('DROP ROLE %I', :role)"), {"role": role}).scalar_one()
                connection.exec_driver_sql(drop)
