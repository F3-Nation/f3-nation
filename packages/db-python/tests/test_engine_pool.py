"""The Postgres engine's connection pool is bounded (ADR 0004 §7 step 1).

create_engine is lazy, so these build real engines without a database.
"""

import pytest

from f3_data_models import utils


@pytest.fixture(autouse=True)
def _db_env(monkeypatch):
    for name, value in {
        "DATABASE_HOST": "localhost",
        "DATABASE_USER": "u",
        "DATABASE_PASSWORD": "p",
        "DATABASE_SCHEMA": "f3_test",
    }.items():
        monkeypatch.setenv(name, value)
    for name in ("DATABASE_POOL_SIZE", "DATABASE_MAX_OVERFLOW", "DATABASE_POOL_TIMEOUT"):
        monkeypatch.delenv(name, raising=False)


@pytest.mark.parametrize("use_proxy", ["false", "true"])
def test_default_pool_is_bounded(monkeypatch, use_proxy):
    monkeypatch.setenv("USE_GCP_AUTH_PROXY", use_proxy)
    pool = utils._create_postgresql_engine(echo=False).pool
    assert pool.size() == utils.DEFAULT_POOL_SIZE
    assert pool._max_overflow == utils.DEFAULT_MAX_OVERFLOW
    assert pool._timeout == utils.DEFAULT_POOL_TIMEOUT_SECONDS


def test_pool_bounds_are_overridable(monkeypatch):
    monkeypatch.setenv("DATABASE_POOL_SIZE", "3")
    monkeypatch.setenv("DATABASE_MAX_OVERFLOW", "0")
    monkeypatch.setenv("DATABASE_POOL_TIMEOUT", "5")
    pool = utils._create_postgresql_engine(echo=False).pool
    assert (pool.size(), pool._max_overflow, pool._timeout) == (3, 0, 5)


DEFAULTS = {
    "DATABASE_POOL_SIZE": utils.DEFAULT_POOL_SIZE,
    "DATABASE_MAX_OVERFLOW": utils.DEFAULT_MAX_OVERFLOW,
    "DATABASE_POOL_TIMEOUT": utils.DEFAULT_POOL_TIMEOUT_SECONDS,
}


def _bounds(pool):
    return {
        "DATABASE_POOL_SIZE": pool.size(),
        "DATABASE_MAX_OVERFLOW": pool._max_overflow,
        "DATABASE_POOL_TIMEOUT": pool._timeout,
    }


@pytest.mark.parametrize("name", list(DEFAULTS))
@pytest.mark.parametrize("bad", ["abc", "-1", " "])
def test_invalid_overrides_fall_back_to_defaults(monkeypatch, name, bad):
    monkeypatch.setenv(name, bad)
    assert _bounds(utils._create_postgresql_engine(echo=False).pool) == DEFAULTS


# pool_size=0 would make the pool unlimited and pool_timeout=0 would fail every
# busy checkout, so zero falls back for both; zero overflow is a real setting.
@pytest.mark.parametrize("name", ["DATABASE_POOL_SIZE", "DATABASE_POOL_TIMEOUT"])
def test_zero_pool_size_and_timeout_fall_back(monkeypatch, name):
    monkeypatch.setenv(name, "0")
    assert _bounds(utils._create_postgresql_engine(echo=False).pool) == DEFAULTS


def test_zero_overflow_is_allowed(monkeypatch):
    monkeypatch.setenv("DATABASE_MAX_OVERFLOW", "0")
    pool = utils._create_postgresql_engine(echo=False).pool
    assert pool._max_overflow == 0
