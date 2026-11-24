"""Pins the shared-container, per-test-database contract of `isolated_postgres`.

The second test reads what the first one left behind, so they run in file order.
"""

import pytest
from sqlalchemy import text

from tests import postgres_fixture

pytestmark = postgres_fixture.requires_postgres
isolated_postgres = postgres_fixture.isolated_postgres

ROLE = "fixture_contract_role"
_first_test = {}


def _cluster_id(connection):
    return connection.execute(text("SELECT system_identifier FROM pg_control_system()")).scalar_one()


@pytest.fixture
def postgres_schema():
    def create(engine):
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE marker (id integer PRIMARY KEY)")

    return create


def test_first_test_leaves_a_database_role_and_row(isolated_postgres):
    with isolated_postgres.begin() as connection:
        assert connection.execute(text("SELECT count(*) FROM marker")).scalar_one() == 0
        connection.exec_driver_sql("INSERT INTO marker VALUES (1)")
        connection.exec_driver_sql(f"CREATE ROLE {ROLE} NOLOGIN")
        _first_test["database"] = connection.execute(text("SELECT current_database()")).scalar_one()
        _first_test["cluster"] = _cluster_id(connection)


def test_next_test_shares_the_server_but_not_the_database(isolated_postgres, postgres_server):
    if not _first_test:
        pytest.skip("runs after test_first_test_leaves_a_database_role_and_row")
    with isolated_postgres.connect() as connection:
        assert _cluster_id(connection) == _first_test["cluster"]
        assert connection.execute(text("SELECT current_database()")).scalar_one() != _first_test["database"]
        assert connection.execute(text("SELECT count(*) FROM marker")).scalar_one() == 0
    with postgres_server.connect() as connection:
        leftover_databases = connection.execute(
            text("SELECT count(*) FROM pg_database WHERE datname = :name"), {"name": _first_test["database"]}
        ).scalar_one()
        leftover_roles = connection.execute(
            text("SELECT count(*) FROM pg_roles WHERE rolname = :name"), {"name": ROLE}
        ).scalar_one()
    assert leftover_databases == 0
    assert leftover_roles == 0
