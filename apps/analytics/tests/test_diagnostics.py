from __future__ import annotations

import io
import json
from pathlib import Path
from types import SimpleNamespace
from typing import cast

import duckdb

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


def test_full_query_single_thread_mode_forwards_only_diagnostic_connection_option(monkeypatch):
    connections = []
    factory_options = []
    attachments = []

    def make_connection(_settings, **options):
        factory_options.append(options)
        connection = _Connection()
        connections.append(connection)
        return connection

    monkeypatch.setattr(diagnostics, "attach_postgres", lambda connection, _settings: attachments.append(connection))
    result = diagnostics.run_full_query_diagnostics(
        _settings(), connection_factory=make_connection, scanner_mode="single-thread"
    )

    assert all(item["status"] == "succeeded" for item in result.values())
    assert factory_options == [{"diagnostic_single_thread": True}] * 2
    assert attachments == connections
    assert all(
        any(statement.startswith("CREATE TEMP TABLE diagnostic_full_") for statement, _ in connection.sql)
        for connection in connections
    )


def test_full_query_rejects_invalid_scanner_mode():
    try:
        diagnostics.run_full_query_diagnostics(_settings(), scanner_mode="invalid")
    except ValueError as error:
        assert str(error) == "invalid full-query scanner mode"
    else:
        raise AssertionError("invalid scanner mode was accepted")


def test_staged_events_uses_one_read_only_chunked_session_and_local_query(monkeypatch):
    postgres_sessions = []
    duckdb_connections = []
    duckdb_directories = []
    events = []

    class Cursor:
        def __init__(self, rows, commands, fetch_sizes):
            self.rows = rows
            self.commands = commands
            self.fetch_sizes = fetch_sizes
            self.used = False
            self.closed = False

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            self.closed = True
            return False

        def execute(self, statement, parameters=()):
            self.commands.append((statement, parameters))
            self.statement = statement
            self.parameters = parameters

        def fetchmany(self, size):
            self.fetch_sizes.append(size)
            if self.used:
                return []
            self.used = True
            return self.rows

    class Transaction:
        def __init__(self, session, options):
            self.session = session
            self.options = options

        def __enter__(self):
            self.session.transaction_options = self.options
            return self

        def __exit__(self, *_args):
            self.session.rolled_back = True
            return False

    class Postgres:
        def __init__(self):
            self.read_only = False
            self.closed = False
            self.cursors = []
            self.commands = []
            self.fetch_sizes = []

        def transaction(self, **options):
            return Transaction(self, options)

        def cursor(self, name=None):
            rows = [(1,)] if name else []
            cursor = Cursor(rows, self.commands, self.fetch_sizes)
            self.cursors.append((name, cursor))
            return cursor

        def close(self):
            self.closed = True

    class Duckdb:
        def __init__(self):
            self.statements = []
            self.inserts = []
            self.closed = False

        def execute(self, statement, parameters=()):
            self.statements.append((statement, parameters))
            if statement.startswith("SELECT count(*)"):
                return _Result([(11,)])
            return _Result([])

        def executemany(self, statement, rows):
            self.inserts.append((statement, list(rows)))

        def close(self):
            self.closed = True

    def make_postgres(**_kwargs):
        session = Postgres()
        postgres_sessions.append(session)
        return session

    def make_duckdb(_directory):
        duckdb_directories.append(Path(_directory))
        connection = Duckdb()
        duckdb_connections.append(connection)
        return connection

    monkeypatch.setattr(diagnostics.psycopg, "connect", make_postgres)
    production_sql = diagnostics.load_sql(diagnostics.MATERIALIZATION_REGISTRY["pv_events"])
    monkeypatch.setattr(diagnostics, "load_sql", lambda _definition: production_sql)
    monkeypatch.setattr(
        diagnostics,
        "attach_postgres",
        lambda *_args: (_ for _ in ()).throw(AssertionError("scanner attach is forbidden")),
    )
    result = diagnostics.run_staged_events_diagnostic(
        _settings(), duckdb_connection_factory=make_duckdb, logger=cast(JsonLogger, _logger(events))
    )

    assert result == {"status": "succeeded", "row_count": 11}
    assert len(postgres_sessions) == 1
    session = postgres_sessions[0]
    assert session.read_only is True
    assert session.transaction_options == {"force_rollback": True}
    assert session.rolled_back is True
    assert session.closed is True
    assert all(cursor.closed for _, cursor in session.cursors)
    assert session.commands[:2] == [
        ("SELECT set_config('statement_timeout', %s, true)", ("15min",)),
        ("SELECT set_config('idle_in_transaction_session_timeout', %s, true)", ("15min",)),
    ]
    assert session.fetch_sizes and set(session.fetch_sizes) == {diagnostics._STAGED_EVENTS_CHUNK_SIZE}
    assert len(duckdb_connections) == 1
    connection = duckdb_connections[0]
    assert connection.closed is True
    assert all(not directory.exists() for directory in duckdb_directories)
    assert (
        sum("CREATE TEMP TABLE diagnostic_staged_pv_events AS" in statement for statement, _ in connection.statements)
        == 1
    )
    statements = [statement for statement, _ in connection.statements]
    assert all(
        any(statement.startswith(f"CREATE TABLE staged.{table} ") for statement in statements)
        for table, *_ in diagnostics._STAGED_EVENTS_TABLES
    )
    local_query = next(
        statement for statement in statements if "CREATE TEMP TABLE diagnostic_staged_pv_events AS" in statement
    )
    assert "pg.public." not in local_query
    assert all(f"staged.{table}" in local_query for table, *_ in diagnostics._STAGED_EVENTS_TABLES)
    event_schema = next(
        statement for statement in statements if statement.startswith("CREATE TABLE staged.event_instances ")
    )
    assert "end_date" not in event_schema and "highlight" not in event_schema and "is_private" not in event_schema
    assert len(connection.inserts) == len(diagnostics._STAGED_EVENTS_TABLES)
    phases = [context["phase"] for event, context in events if event.endswith("phase_succeeded")]
    assert phases[-2:] == ["local_full_query", "cleanup"]
    assert all(context["probe"] == "pv_events" for event, context in events)


def test_staged_events_failure_isolated_and_redacted(monkeypatch):
    stream = io.StringIO()
    closed = []

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, statement, _parameters=()):
            if statement.startswith("SELECT") and "set_config" not in statement:
                raise RuntimeError("raw SQL rows secret@example.test")

        def fetchmany(self, _size):
            return []

    class Transaction:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    class Postgres:
        read_only = False

        def transaction(self, **_options):
            return Transaction()

        def cursor(self, name=None):
            return Cursor()

        def close(self):
            closed.append("postgres")

    class Duckdb:
        def execute(self, *_args):
            return _Result([])

        def close(self):
            closed.append("duckdb")

    monkeypatch.setattr(diagnostics.psycopg, "connect", lambda **_kwargs: Postgres())
    monkeypatch.setattr(diagnostics, "attach_postgres", lambda *_args: (_ for _ in ()).throw(AssertionError()))
    result = diagnostics.run_staged_events_diagnostic(
        _settings(), duckdb_connection_factory=lambda _directory: Duckdb(), logger=JsonLogger(stream=stream)
    )

    assert result == {"status": "failed", "error_type": "RuntimeError"}
    assert closed == ["postgres", "duckdb"]
    output = stream.getvalue()
    assert "raw SQL" not in output
    assert "secret@example.test" not in output
    assert '"phase":"psycopg_source_extract"' in output
    assert '"phase":"cleanup"' in output


def test_staged_events_actual_sql_runs_against_all_fixed_local_tables(tmp_path):
    connection = duckdb.connect(":memory:", config={"temp_directory": str(tmp_path)})
    connection.execute("CREATE SCHEMA staged")
    rows = {
        "orgs": [
            (1, None, "Sector", "sector"),
            (2, 1, "Territory", "territory"),
            (3, 2, "Area", "area"),
            (4, 3, "Region", "region"),
            (5, 4, "AO", "ao"),
        ],
        "event_instances": [(1, 5, True, 10, 2, "{}", "Workout", "2026-01-01")],
        "event_instances_x_event_types": [(1, 1)],
        "event_types": [(1, "Run", "Running", "first_f")],
        "event_tags_x_event_instances": [(1, 7)],
        "event_tags": [(7, "Morning", "Morning workout")],
        "attendance": [(1, 1, 1, False)],
        "users": [(1, "Alpha", "a@example.com", "alpha.png")],
        "attendance_x_attendance_types": [(1, 2)],
        "attendance_types": [(2, "Q")],
    }
    for table, _source_sql, create_sql, insert_sql in diagnostics._STAGED_EVENTS_TABLES:
        connection.execute(create_sql)
        connection.executemany(insert_sql, rows[table])

    connection.execute(
        "CREATE TEMP TABLE diagnostic_staged_pv_events AS " + diagnostics._staged_events_local_sql(),
        ["2026-01-03T00:00:00Z", "2026-01-03"],
    )
    columns = connection.execute("DESCRIBE diagnostic_staged_pv_events").fetchall()
    names = [column[0] for column in columns]
    assert names[:5] == ["refreshed_at", "event_id", "event_date", "event_name", "pax_count"]
    assert names[-3:] == ["types", "tags", "attendance"]
    assert connection.execute("SELECT count(*) FROM diagnostic_staged_pv_events").fetchone()[0] == 1
    assert connection.execute("SELECT types, tags, attendance FROM diagnostic_staged_pv_events").fetchone()[0]
    connection.close()


def test_staged_events_local_ingestion_failure_has_local_phase(monkeypatch):
    events = []

    class Cursor:
        def __init__(self, source):
            self.source = source
            self.used = False

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, _statement, _parameters=()):
            pass

        def fetchmany(self, _size):
            if self.source and not self.used:
                self.used = True
                return [(1,)]
            return []

    class Transaction:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    class Postgres:
        read_only = False

        def transaction(self, **_options):
            return Transaction()

        def cursor(self, name=None):
            return Cursor(name is not None)

        def close(self):
            pass

    class Duckdb:
        def execute(self, statement, _parameters=()):
            return _Result([])

        def executemany(self, _statement, _rows):
            raise RuntimeError("raw local rows")

        def close(self):
            pass

    monkeypatch.setattr(
        diagnostics,
        "psycopg",
        type("Psycopg", (), {"connect": staticmethod(lambda **_kwargs: Postgres())}),
    )
    result = diagnostics.run_staged_events_diagnostic(
        _settings(), duckdb_connection_factory=lambda _directory: Duckdb(), logger=cast(JsonLogger, _logger(events))
    )

    assert result == {"status": "failed", "error_type": "RuntimeError"}
    failure = next(item for item in events if item[0].endswith("phase_failed"))
    assert failure[1]["phase"] == "duckdb_ingestion"
    assert failure[1]["error_type"] == "RuntimeError"


def test_ctas_events_stages_tables_detaches_then_runs_local_query(monkeypatch):
    connections = []
    attached = []
    events = []

    class Connection:
        def __init__(self):
            self.statements = []
            self.closed = False

        def execute(self, statement, parameters=()):
            self.statements.append((statement, parameters))
            if statement.startswith("SELECT count(*)"):
                return _Result([(3,)])
            return _Result([])

        def close(self):
            self.closed = True

    directories = []

    def make_connection(_settings, directory):
        directories.append(Path(directory))
        connection = Connection()
        connections.append(connection)
        return connection

    monkeypatch.setattr(diagnostics, "attach_postgres", lambda connection, _settings: attached.append(connection))
    result = diagnostics.run_ctas_events_diagnostic(
        _settings(), connection_factory=make_connection, logger=cast(JsonLogger, _logger(events))
    )

    assert result == {"status": "succeeded", "row_count": 3}
    connection = connections[0]
    statements = [statement for statement, _ in connection.statements]
    assert len(attached) == 1
    assert connection.closed is True
    assert all(not directory.exists() for directory in directories)
    ctas = [statement for statement in statements if statement.startswith("CREATE TABLE staged.")]
    assert len(ctas) == len(diagnostics._CTAS_EVENTS_TABLES)
    assert statements.index("DETACH pg") < next(
        index
        for index, statement in enumerate(statements)
        if "CREATE TEMP TABLE diagnostic_ctas_pv_events" in statement
    )
    assert any(context["phase"] == "local_full_query" for event, context in events)
    assert any(event.endswith("table_started") for event, _ in events)
    assert any(event.endswith("table_completed") for event, _ in events)


def test_ctas_events_failure_reports_source_phase_and_cleanup(monkeypatch):
    events = []

    class Connection:
        def execute(self, statement, _parameters=()):
            if statement.startswith("CREATE TABLE staged.event_types"):
                raise RuntimeError("raw SQL PII secret@example.test")
            return _Result([(0,)])

        def close(self):
            pass

    monkeypatch.setattr(diagnostics, "attach_postgres", lambda *_args: None)
    result = diagnostics.run_ctas_events_diagnostic(
        _settings(),
        connection_factory=lambda _settings, _directory: Connection(),
        logger=cast(JsonLogger, _logger(events)),
    )

    assert result == {"status": "failed", "error_type": "RuntimeError"}
    failure = next(item for item in events if item[0].endswith("phase_failed"))
    assert failure[1]["phase"] == "source_staging"
    assert any(item[0].endswith("phase_succeeded") and item[1]["phase"] == "cleanup" for item in events)


def test_ctas_events_local_query_failure_is_classified_after_detach(monkeypatch):
    events = []

    class Connection:
        def execute(self, statement, _parameters=()):
            if statement.startswith("CREATE TEMP TABLE diagnostic_ctas_pv_events"):
                raise RuntimeError("local query failed")
            return _Result([(0,)])

        def close(self):
            pass

    monkeypatch.setattr(diagnostics, "attach_postgres", lambda *_args: None)
    result = diagnostics.run_ctas_events_diagnostic(
        _settings(),
        connection_factory=lambda _settings, _directory: Connection(),
        logger=cast(JsonLogger, _logger(events)),
    )

    assert result == {"status": "failed", "error_type": "RuntimeError"}
    failure = next(item for item in events if item[0].endswith("phase_failed"))
    assert failure[1]["phase"] == "local_full_query"


def test_ctas_events_deadline_interrupts_blocking_operation_and_cleans_up(monkeypatch):
    events = []
    directories = []

    class Connection:
        def __init__(self):
            self.interrupted = False
            self.closed = False

        def execute(self, statement, _parameters=()):
            if statement.startswith("CREATE TABLE staged.orgs"):
                while not self.interrupted:
                    pass
                raise RuntimeError("interrupted")
            return _Result([(0,)])

        def interrupt(self):
            self.interrupted = True

        def close(self):
            self.closed = True

    connection = Connection()

    def make_connection(_settings, directory):
        directories.append(Path(directory))
        return connection

    monkeypatch.setattr(diagnostics, "attach_postgres", lambda *_args: None)
    result = diagnostics.run_ctas_events_diagnostic(
        _settings(),
        connection_factory=make_connection,
        logger=cast(JsonLogger, _logger(events)),
        deadline_seconds=0.01,
    )

    assert result == {"status": "failed", "error_type": "RuntimeError"}
    assert connection.interrupted is True and connection.closed is True
    assert all(not directory.exists() for directory in directories)
    failure = next(item for item in events if item[0].endswith("phase_failed"))
    assert failure[1]["phase"] == "source_staging"


def test_ctas_events_real_ctas_detach_and_local_production_query(tmp_path):
    connection = duckdb.connect(":memory:", config={"temp_directory": str(tmp_path)})
    connection.execute("ATTACH ':memory:' AS pg")
    connection.execute("CREATE SCHEMA pg.public")
    rows = {
        "orgs": [
            (1, None, "Sector", "sector"),
            (2, 1, "Territory", "territory"),
            (3, 2, "Area", "area"),
            (4, 3, "Region", "region"),
            (5, 4, "AO", "ao"),
        ],
        "event_instances": [(1, 5, True, 10, 2, "{}", "Workout", "2026-01-01")],
        "event_instances_x_event_types": [(1, 1)],
        "event_types": [(1, "Run", "Running", "first_f")],
        "event_tags_x_event_instances": [(1, 7)],
        "event_tags": [(7, "Morning", "Morning workout")],
        "attendance": [(1, 1, 1, False)],
        "users": [(1, "Alpha", "a@example.com", "alpha.png")],
        "attendance_x_attendance_types": [(1, 2)],
        "attendance_types": [(2, "Q")],
    }
    for table, _source_sql, create_sql, insert_sql in diagnostics._STAGED_EVENTS_TABLES:
        connection.execute(create_sql.replace("staged.", "pg.public."))
        connection.executemany(insert_sql.replace("staged.", "pg.public."), rows[table])
    connection.execute("CREATE SCHEMA staged")
    for _table, statement in diagnostics._CTAS_EVENTS_TABLES:
        connection.execute(statement)
    assert connection.execute("SELECT count(*) FROM staged.event_instances").fetchone()[0] == 1
    connection.execute("DETACH pg")
    connection.execute(
        "CREATE TEMP TABLE diagnostic_ctas_pv_events AS " + diagnostics._staged_events_local_sql(),
        ["2026-01-03T00:00:00Z", "2026-01-03"],
    )
    assert connection.execute("SELECT count(*) FROM diagnostic_ctas_pv_events").fetchone()[0] == 1
    assert connection.execute("SELECT attendance FROM diagnostic_ctas_pv_events").fetchone()[0]
    connection.close()


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
