"""The Postgres engine uses psycopg2, the only PostgreSQL driver the package depends on.

create_engine is lazy, so these build real engines without a database.
"""

import pytest

from f3_data_models import utils


@pytest.mark.parametrize("use_proxy", ["false", "true"])
def test_postgresql_engine_uses_psycopg2(monkeypatch, use_proxy):
    for name, value in {
        "DATABASE_HOST": "localhost",
        "DATABASE_USER": "u",
        "DATABASE_PASSWORD": "p",
        "DATABASE_SCHEMA": "f3_test",
        "USE_GCP_AUTH_PROXY": use_proxy,
    }.items():
        monkeypatch.setenv(name, value)
    engine = utils._create_postgresql_engine(echo=False)
    assert engine.dialect.driver == "psycopg2"
    assert engine.dialect.dbapi.__name__ == "psycopg2"
