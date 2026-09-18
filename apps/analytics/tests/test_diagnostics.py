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
        if "read_parquet" in statement:
            return _Result([(7, 7, 7, 7)] if "event_types" in statement else [(7, 7)])
        if statement.startswith("SELECT count(*)"):
            return _Result([(7,)])
        return _Result([])

    def executemany(self, statement, parameters):
        self.sql.append((statement, list(parameters)))

    def close(self):
        if self.close_error:
            raise self.close_error


def _logger(events):
    return SimpleNamespace(
        info=lambda event, **context: events.append((event, context)),
        error=lambda event, error=None, **context: events.append((event, context, error)),
    )


class _Cursor:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.closed = True
        return False

    def execute(self, statement, parameters=()):
        self.calls.append((statement, parameters))

    def fetchall(self):
        return self.rows


class _Transaction:
    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        self.connection.transaction_started = True
        return self

    def __exit__(self, *_args):
        self.connection.rolled_back = True
        return False


class _PostgresConnection:
    def __init__(self, kwargs):
        self.kwargs = kwargs
        self.read_only = False
        self.transaction_started = False
        self.rolled_back = False
        self.closed = False
        self.cursor_instance = _Cursor([(1, "event", "2026-01-01", 2, "ao", 3, "pax", "avatar")])

    def transaction(self, *, force_rollback):
        assert force_rollback is True
        return _Transaction(self)

    def cursor(self):
        return self.cursor_instance

    def close(self):
        self.closed = True


def _install_psycopg(monkeypatch):
    sessions = []

    def connect(**_kwargs):
        session = _PostgresConnection(_kwargs)
        sessions.append(session)
        return session

    monkeypatch.setattr(diagnostics.psycopg, "connect", connect)
    return sessions


def _settings():
    return cast(
        Settings,
        SimpleNamespace(
            postgres_database="f3_staging",
            postgres_user="analytics",
            postgres_password="password",
            postgres_socket_dir="/cloudsql/f3data:us-central1:f3data-nonprod",
            postgres_host=None,
            postgres_port=None,
        ),
    )


def test_diagnostics_use_bounded_source_queries_and_one_materialization_execution(monkeypatch):
    sessions = _install_psycopg(monkeypatch)
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
        _settings(), connection_factory=make_connection, logger=cast(JsonLogger, _logger(events))
    )

    assert set(result) == {
        "postgres_scan",
        "territory_count",
        "local_parquet_copy",
        "pv_sectors_materialization",
        "pv_areas_materialization",
        "pv_kotter",
        "pv_events",
    }
    assert all(item["status"] == "succeeded" for item in result.values()), result
    assert len(connections) == 7
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
    assert result["pv_kotter"]["phases"] == ["source_read", "query_aggregation", "local_parquet"]
    assert result["pv_events"]["phases"] == ["source_read", "query_aggregation", "local_parquet"]
    phase_successes = [
        (context["probe"], context["phase"])
        for event, context in events
        if event == "analytics.etl.diagnostic_phase_succeeded"
    ]
    assert phase_successes[-6:] == [
        ("pv_kotter", "source_read"),
        ("pv_kotter", "query_aggregation"),
        ("pv_kotter", "local_parquet"),
        ("pv_events", "source_read"),
        ("pv_events", "query_aggregation"),
        ("pv_events", "local_parquet"),
    ]
    kotter_aggregation = next(statement for statement in statements if "diagnostic_pv_kotter AS" in statement)
    events_aggregation = next(statement for statement in statements if "diagnostic_pv_events AS" in statement)
    assert "list(struct_pack" in kotter_aggregation
    assert "list(struct_pack" in events_aggregation
    assert "LIMIT 100" in kotter_aggregation and "LIMIT 100" in events_aggregation
    kotter_statements = [statement for statement in statements if "diagnostic_pv_kotter" in statement]
    assert any("COPY" in statement for statement in kotter_statements)
    assert any("count(nested_values)" in statement for statement in statements)
    assert "COALESCE" in events_aggregation
    assert "event_types" in events_aggregation and "event_tags" in events_aggregation
    assert any("count(event_types)" in statement and "count(event_tags)" in statement for statement in statements)
    assert not any("GcsPublisher" in statement or "materialize(" in statement for statement in statements)
    assert len(sessions) == 2
    assert all(
        session.kwargs
        == {
            "dbname": "f3_staging",
            "user": "analytics",
            "password": "password",
            "host": "/cloudsql/f3data:us-central1:f3data-nonprod",
        }
        for session in sessions
    )
    assert all(
        session.read_only and session.transaction_started and session.rolled_back and session.closed
        for session in sessions
    )
    assert all(session.cursor_instance.closed for session in sessions)
    for session in sessions:
        assert session.cursor_instance.calls[0] == (
            "SELECT set_config('statement_timeout', %s, true)",
            ("5s",),
        )
        assert session.cursor_instance.calls[1][1] == (100, 100)
        assert "postgres_query" not in session.cursor_instance.calls[1][0]
        assert "ORDER BY e.id" in session.cursor_instance.calls[1][0]
        assert "LIMIT %s" in session.cursor_instance.calls[1][0]


def test_production_uses_only_isolated_psycopg_nested_probes(monkeypatch):
    sessions = _install_psycopg(monkeypatch)
    connections = []
    events = []

    def make_connection(_settings):
        connection = _Connection()
        connections.append(connection)
        return connection

    def forbidden_attach(*_args):
        raise AssertionError("production diagnostics must not attach the DuckDB scanner")

    monkeypatch.setattr(diagnostics, "attach_postgres", forbidden_attach)
    production = cast(Settings, SimpleNamespace(**vars(_settings()), environment="production"))
    result = diagnostics.run_diagnostics(
        production, connection_factory=make_connection, logger=cast(JsonLogger, _logger(events))
    )

    assert result["postgres_scan"] == {"status": "skipped", "reason": "production_isolated_diagnostics"}
    assert result["local_parquet_copy"]["status"] == "skipped"
    assert result["pv_sectors_materialization"]["status"] == "skipped"
    assert result["pv_areas_materialization"]["status"] == "skipped"
    assert result["pv_kotter"]["status"] == "succeeded"
    assert result["pv_events"]["status"] == "succeeded"
    statements = [statement for connection in connections for statement, _ in connection.sql]
    assert not any("postgres_query" in statement or "pg.public" in statement for statement in statements)
    assert len(sessions) == 2
    skipped = [item for item in events if item[0] == "analytics.etl.diagnostic_skipped"]
    assert [(context["probe"], context["reason"]) for _, context in skipped] == [
        ("postgres_scan", "production_isolated_diagnostics"),
        ("territory_count", "production_isolated_diagnostics"),
        ("local_parquet_copy", "production_isolated_diagnostics"),
        ("pv_sectors_materialization", "production_isolated_diagnostics"),
        ("pv_areas_materialization", "production_isolated_diagnostics"),
    ]


def test_cleanup_error_isolated_from_later_probes(monkeypatch):
    _install_psycopg(monkeypatch)
    connections = []

    def make_connection(_settings):
        connection = _Connection(RuntimeError("close failed")) if not connections else _Connection()
        connections.append(connection)
        return connection

    monkeypatch.setattr(diagnostics, "attach_postgres", lambda *_args: None)
    events = []
    result = diagnostics.run_diagnostics(
        _settings(), connection_factory=make_connection, logger=cast(JsonLogger, _logger(events))
    )

    assert len(connections) == 7
    assert result["territory_count"]["status"] == "succeeded"
    cleanup_events = [event for event in events if event[0] == "analytics.etl.diagnostic_cleanup_failed"]
    assert len(cleanup_events) == 1
    assert cleanup_events[0][1]["probe"] == "postgres_scan"


def test_materialization_probe_failure_isolated_and_does_not_skip_later_probe(monkeypatch):
    _install_psycopg(monkeypatch)
    connections = []
    events = []

    class FailingConnection(_Connection):
        def execute(self, statement, parameters=()):
            if statement.startswith("CREATE TEMP TABLE diagnostic_pv_kotter AS"):
                raise RuntimeError("raw SQL, rows, and credentials must not escape")
            return super().execute(statement, parameters)

    def make_connection(_settings):
        connection = FailingConnection() if len(connections) == 5 else _Connection()
        connections.append(connection)
        return connection

    monkeypatch.setattr(diagnostics, "attach_postgres", lambda *_args: None)
    result = diagnostics.run_diagnostics(
        _settings(), connection_factory=make_connection, logger=cast(JsonLogger, _logger(events))
    )

    assert result["pv_kotter"] == {"status": "failed", "error_type": "RuntimeError"}
    assert result["pv_events"]["status"] == "succeeded"
    assert len(connections) == 7
    assert connections[5].sql[0][0].split()[0:3] == ["CREATE", "TEMP", "TABLE"]
    assert any("diagnostic_pv_events_source" in statement for statement, _ in connections[6].sql)
    phase_failures = [item for item in events if item[0] == "analytics.etl.diagnostic_phase_failed"]
    assert phase_failures == [
        (
            "analytics.etl.diagnostic_phase_failed",
            {
                "probe": "pv_kotter",
                "phase": "query_aggregation",
                "source_sample_limit": 100,
                "error_type": "RuntimeError",
            },
            None,
        )
    ]
    assert "raw SQL" not in repr(phase_failures)


def test_temporary_diagnostic_directories_are_always_closed(monkeypatch):
    _install_psycopg(monkeypatch)
    lifecycles = []

    class TemporaryDirectory:
        def __init__(self, **_kwargs):
            self.name = "/tmp/diagnostic-test"
            self.closed = False
            lifecycles.append(self)

        def __enter__(self):
            return self.name

        def __exit__(self, *_args):
            self.closed = True
            return False

    monkeypatch.setattr(diagnostics.tempfile, "TemporaryDirectory", TemporaryDirectory)
    monkeypatch.setattr(diagnostics, "attach_postgres", lambda *_args: None)
    diagnostics.run_diagnostics(
        _settings(),
        connection_factory=lambda _settings: _Connection(),
        logger=cast(JsonLogger, _logger([])),
    )

    assert lifecycles
    assert all(directory.closed for directory in lifecycles)


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


def test_full_query_diagnostics_runs_exact_sql_once_then_copies_temp_table(monkeypatch):
    connections = []
    attachments = []
    events = []

    def make_connection(_settings):
        connection = _Connection()
        connections.append(connection)
        return connection

    monkeypatch.setattr(diagnostics, "attach_postgres", lambda connection, _settings: attachments.append(connection))
    monkeypatch.setattr(diagnostics, "load_sql", lambda definition: f"SELECT '{definition.name}' AS dataset")

    result = diagnostics.run_full_query_diagnostics(
        _settings(), connection_factory=make_connection, logger=cast(JsonLogger, _logger(events))
    )

    assert set(result) == {"pv_kotter", "pv_events"}
    assert all(item["status"] == "succeeded" for item in result.values())
    assert len(connections) == 2
    assert len(attachments) == 2
    for connection, name in zip(connections, ("pv_kotter", "pv_events"), strict=True):
        statements = [statement for statement, _ in connection.sql]
        assert sum(f"CREATE TEMP TABLE diagnostic_full_{name} AS" in statement for statement in statements) == 1
        create = next(statement for statement in statements if statement.startswith("CREATE TEMP TABLE"))
        assert create.count(f"SELECT '{name}' AS dataset") == 1
        assert any(f"COPY (SELECT * FROM diagnostic_full_{name})" in statement for statement in statements)
        assert any("read_parquet(?)" in statement for statement in statements)
    phase_successes = [context["phase"] for event, context in events if event.endswith("phase_succeeded")]
    assert phase_successes == ["full_query", "local_parquet", "readback"] * 2
    assert all(context["scanner_mode"] == "binary-copy" for event, context in events)


def test_full_query_text_scanner_mode_sets_before_attach_on_each_fresh_connection(monkeypatch):
    connections = []
    attach_order = []
    factory_options = []
    events = []

    def make_connection(_settings, **options):
        factory_options.append(options)
        connection = _Connection()
        connections.append(connection)
        return connection

    def attach(connection, _settings):
        attach_order.append(connection)

    monkeypatch.setattr(diagnostics, "attach_postgres", attach)
    result = diagnostics.run_full_query_diagnostics(
        _settings(),
        connection_factory=make_connection,
        logger=cast(JsonLogger, _logger(events)),
        scanner_mode="text-copy",
    )

    assert all(item["status"] == "succeeded" for item in result.values())
    assert attach_order == connections
    assert factory_options == [{"diagnostic_text_copy": True}] * 2
    assert all(
        not any("pg_use_binary_copy" in statement for statement, _ in connection.sql) for connection in connections
    )
    assert all(context["scanner_mode"] == "text-copy" for event, context in events)


def test_full_query_rejects_invalid_scanner_mode():
    try:
        diagnostics.run_full_query_diagnostics(_settings(), scanner_mode="invalid")
    except ValueError as error:
        assert str(error) == "invalid full-query scanner mode"
    else:
        raise AssertionError("invalid scanner mode was accepted")


def test_full_query_diagnostics_isolates_failure_and_redacts_error(monkeypatch):
    connections = []
    stream = io.StringIO()

    class FirstFails(_Connection):
        def execute(self, statement, parameters=()):
            if statement.startswith("CREATE TEMP TABLE"):
                raise RuntimeError("raw SQL rows password=secret person@example.test")
            return super().execute(statement, parameters)

    def make_connection(_settings):
        connection = FirstFails() if not connections else _Connection()
        connections.append(connection)
        return connection

    monkeypatch.setattr(diagnostics, "attach_postgres", lambda *_args: None)
    result = diagnostics.run_full_query_diagnostics(
        _settings(), connection_factory=make_connection, logger=JsonLogger(stream=stream)
    )

    assert result["pv_kotter"]["status"] == "failed"
    assert result["pv_events"]["status"] == "succeeded"
    assert len(connections) == 2
    records = [json.loads(line) for line in stream.getvalue().splitlines()]
    failure = next(record for record in records if record["event"].endswith("phase_failed"))
    assert failure["context"]["phase"] == "full_query"
    assert failure["context"]["error_type"] == "RuntimeError"
    assert "raw SQL" not in stream.getvalue()
    assert "person@example.test" not in stream.getvalue()
