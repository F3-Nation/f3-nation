from __future__ import annotations

import io
import json
from types import SimpleNamespace
from typing import cast

import analytics.diagnostics as diagnostics
from analytics.logging import JsonLogger
from analytics.settings import Settings


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def fetchone(self):
        return self.rows[0]

    def fetchall(self):
        return self.rows


class _Connection:
    def __init__(self):
        self.sql = []

    def execute(self, statement, parameters=()):
        self.sql.append((statement, parameters))
        if statement.startswith("SELECT count(*)"):
            return _Result([(7,)])
        return _Result([])

    def close(self):
        pass


def test_diagnostics_is_bounded_and_has_no_publication_side_effects(monkeypatch):
    connections = []

    def make_connection(_settings):
        connection = _Connection()
        connections.append(connection)
        return connection

    monkeypatch.setattr(diagnostics, "attach_postgres", lambda *_args: None)
    logger = SimpleNamespace(info=lambda *_args, **_kwargs: None, error=lambda *_args, **_kwargs: None)

    result = diagnostics.run_diagnostics(
        cast(Settings, SimpleNamespace()),
        connection_factory=make_connection,
        logger=cast(JsonLogger, logger),
    )

    assert set(result) == {
        "postgres_scan",
        "territory_count",
        "local_parquet_copy",
        "pv_sectors_query",
        "pv_sectors_copy",
        "pv_areas_query",
        "pv_areas_copy",
    }
    assert all(item["status"] == "succeeded" for item in result.values())
    assert len(connections) == 7
    statements = [item for connection in connections for item in connection.sql]
    assert all("LIMIT 100" in statement or statement.startswith("SELECT count(*)") for statement, _ in statements)
    assert not any("GcsPublisher" in statement for statement, _ in statements)
    query_params = [parameters for statement, parameters in statements if "diagnostic_sample" in statement]
    assert len(query_params) == 4
    assert all(len(parameters) == 2 for parameters in query_params)


def test_internal_exception_does_not_reuse_invalidated_connection(monkeypatch):
    import duckdb

    connections = []

    def make_connection(_settings):
        connection = _Connection()
        if not connections:
            original_execute = connection.execute

            def fail_once(statement, parameters=()):
                if statement.startswith("SELECT count(*)"):
                    raise duckdb.InternalException("internal failure")
                return original_execute(statement, parameters)

            connection.execute = fail_once
        connections.append(connection)
        return connection

    monkeypatch.setattr(diagnostics, "attach_postgres", lambda *_args: None)
    result = diagnostics.run_diagnostics(
        cast(Settings, SimpleNamespace()),
        connection_factory=make_connection,
        logger=cast(
            JsonLogger, SimpleNamespace(info=lambda *_args, **_kwargs: None, error=lambda *_args, **_kwargs: None)
        ),
    )

    assert result["postgres_scan"]["status"] == "failed"
    assert result["territory_count"]["status"] == "succeeded"
    assert len(connections) == 7


def test_diagnostic_error_is_structured_without_secret_or_rows():
    stream = io.StringIO()
    logger = JsonLogger(stream=stream)
    logger.error(
        "analytics.etl.diagnostic_failed",
        RuntimeError("Catalog Error: password=top-secret; value 'person@example.test'"),
        probe="pv_areas_query",
    )

    record = json.loads(stream.getvalue())
    assert "top-secret" not in stream.getvalue()
    assert "person@example.test" not in record["error"]["detail"]
    assert record["error"]["type"] == "RuntimeError"
