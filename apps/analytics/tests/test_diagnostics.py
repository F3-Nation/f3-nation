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
    def __init__(self, close_error: Exception | None = None):
        self.sql = []
        self.close_error = close_error

    def execute(self, statement, parameters=()):
        self.sql.append((statement, parameters))
        if statement.startswith("SELECT count(*)"):
            return _Result([(7,)])
        return _Result([])

    def close(self):
        if self.close_error:
            raise self.close_error


def _logger(events):
    return SimpleNamespace(
        info=lambda event, **context: events.append((event, context)),
        error=lambda event, error=None, **context: events.append((event, context, error)),
    )


def test_diagnostics_use_bounded_source_queries_and_one_materialization_execution(monkeypatch):
    connections = []

    def make_connection(_settings):
        connection = _Connection()
        connections.append(connection)
        return connection

    monkeypatch.setattr(diagnostics, "attach_postgres", lambda *_args: None)
    monkeypatch.setattr(
        diagnostics,
        "load_sql",
        lambda *_args: (_ for _ in ()).throw(AssertionError("production SQL")),
        raising=False,
    )
    events = []

    result = diagnostics.run_diagnostics(
        cast(Settings, SimpleNamespace()), connection_factory=make_connection, logger=cast(JsonLogger, _logger(events))
    )

    assert set(result) == {
        "postgres_scan",
        "territory_count",
        "local_parquet_copy",
        "pv_sectors_materialization",
        "pv_areas_materialization",
    }
    assert all(item["status"] == "succeeded" for item in result.values())
    assert len(connections) == 5
    statements = [statement for connection in connections for statement, _ in connection.sql]
    source_queries = [statement for statement in statements if "postgres_query('pg'" in statement]
    assert len(source_queries) == 4
    assert all("LIMIT 100" in statement for statement in source_queries)
    assert sum("CREATE TEMP TABLE diagnostic_pv_sectors AS" in statement for statement in statements) == 1
    assert sum("CREATE TEMP TABLE diagnostic_pv_areas AS" in statement for statement in statements) == 1
    assert not any("load_sql" in statement or "GcsPublisher" in statement for statement in statements)
    assert not any("diagnostic_sample" in statement for statement in statements)
    assert result["pv_sectors_materialization"]["row_count"] == 7
    assert result["pv_areas_materialization"]["source_sample_limit"] == 100


def test_cleanup_error_isolated_from_later_probes(monkeypatch):
    connections = []

    def make_connection(_settings):
        connection = _Connection(RuntimeError("close failed")) if not connections else _Connection()
        connections.append(connection)
        return connection

    monkeypatch.setattr(diagnostics, "attach_postgres", lambda *_args: None)
    events = []
    result = diagnostics.run_diagnostics(
        cast(Settings, SimpleNamespace()), connection_factory=make_connection, logger=cast(JsonLogger, _logger(events))
    )

    assert len(connections) == 5
    assert result["territory_count"]["status"] == "succeeded"
    cleanup_events = [event for event in events if event[0] == "analytics.etl.diagnostic_cleanup_failed"]
    assert len(cleanup_events) == 1
    assert cleanup_events[0][1]["probe"] == "postgres_scan"


def test_diagnostic_error_is_structured_without_secret_or_rows():
    stream = io.StringIO()
    logger = JsonLogger(stream=stream)
    logger.error(
        "analytics.etl.diagnostic_failed",
        RuntimeError("Catalog Error: password=top-secret; value 'person@example.test'"),
        probe="pv_areas_materialization",
    )

    record = json.loads(stream.getvalue())
    assert "top-secret" not in stream.getvalue()
    assert "person@example.test" not in record["error"]["detail"]
    assert record["error"]["type"] == "RuntimeError"
