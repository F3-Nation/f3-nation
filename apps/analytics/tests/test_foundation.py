from __future__ import annotations

import io
import json
from datetime import datetime, timezone

import pytest

from analytics.cli import main
from analytics.duckdb import connect
from analytics.logging import JsonLogger
from analytics.run_id import RunId
from analytics.settings import Settings, SettingsError
from analytics.source import postgres_attach_sql


def extension_env(tmp_path):
    extension_dir = tmp_path / "extensions"
    extension_dir.mkdir(exist_ok=True)
    extension = extension_dir / "postgres_scanner.duckdb_extension"
    extension.write_bytes(b"fixture")
    return {
        "ANALYTICS_ENVIRONMENT": "test",
        "DUCKDB_EXTENSION_DIR": str(extension_dir),
        "DUCKDB_POSTGRES_EXTENSION_PATH": str(extension),
        "ANALYTICS_POSTGRES_SOCKET_DIR": "/cloudsql/f3data:us-central1:f3data-nonprod",
        "ANALYTICS_POSTGRES_USER": "analytics",
        "ANALYTICS_POSTGRES_PASSWORD": "password",
        "ANALYTICS_POSTGRES_DATABASE": "f3_staging",
    }


def test_settings_validate_paths(tmp_path):
    settings = Settings.from_env(extension_env(tmp_path))
    assert settings.environment == "test"


def test_settings_reject_missing_extension(tmp_path):
    values = extension_env(tmp_path)
    values["DUCKDB_POSTGRES_EXTENSION_PATH"] = str(tmp_path / "missing")
    with pytest.raises(SettingsError):
        Settings.from_env(values)


def test_settings_require_safe_environment(tmp_path):
    values = extension_env(tmp_path)
    values.pop("ANALYTICS_ENVIRONMENT")
    with pytest.raises(SettingsError):
        Settings.from_env(values)


def test_settings_reject_adversarial_postgres_components(tmp_path):
    values = extension_env(tmp_path)
    for key, value in (
        ("ANALYTICS_POSTGRES_SOCKET_DIR", "/cloudsql/f3data:us-central1:f3data/other"),
        ("ANALYTICS_POSTGRES_SOCKET_DIR", "/cloudsql/f3data:us-central1:f3data?bad"),
        ("ANALYTICS_POSTGRES_DATABASE", "f3?admin"),
        ("ANALYTICS_POSTGRES_DATABASE", "f3/admin"),
    ):
        values[key] = value
        with pytest.raises(SettingsError):
            Settings.from_env(values)
        values = extension_env(tmp_path)


def test_settings_derive_publication_targets_from_registry(tmp_path):
    values = extension_env(tmp_path)
    settings = Settings.from_env(values)
    from analytics.materializations import MATERIALIZATION_REGISTRY

    assert settings.target(MATERIALIZATION_REGISTRY["pv_regions"]) == (
        "gs://f3-analytics-nonprod/parquets/pv_regions",
        "",
    )


def local_tcp_env(tmp_path):
    values = extension_env(tmp_path)
    values["ANALYTICS_ENVIRONMENT"] = "local"
    values.pop("ANALYTICS_POSTGRES_SOCKET_DIR")
    values["ANALYTICS_POSTGRES_HOST"] = "localhost"
    values["ANALYTICS_POSTGRES_PORT"] = "5433"
    return values


def test_local_tcp_endpoint_is_accepted_and_quoted(tmp_path):
    settings = Settings.from_env(
        local_tcp_env(tmp_path) | {"ANALYTICS_POSTGRES_PASSWORD": "p'a;ss", "ANALYTICS_POSTGRES_PORT": "15432"}
    )
    assert settings.postgres_host == "localhost"
    assert settings.postgres_port == 15432
    statement = postgres_attach_sql(settings)
    assert "postgresql://analytics:p%27a%3Bss@localhost:15432/f3_staging" in statement
    assert "READ_ONLY" in statement


@pytest.mark.parametrize(
    ("host", "port"),
    (
        ("db.example.test", "5433"),
        ("localhost", "not-a-port"),
        ("localhost", "0"),
        ("localhost", "-1"),
        ("localhost", "65536"),
        ("localhost", ""),
        ("", "5433"),
    ),
)
def test_local_tcp_endpoint_rejects_unapproved_or_incomplete_values(tmp_path, host, port):
    values = local_tcp_env(tmp_path)
    values["ANALYTICS_POSTGRES_HOST"] = host
    values["ANALYTICS_POSTGRES_PORT"] = port
    with pytest.raises(SettingsError):
        Settings.from_env(values)


def test_local_rejects_socket_and_tcp_together(tmp_path):
    values = local_tcp_env(tmp_path)
    values["ANALYTICS_POSTGRES_SOCKET_DIR"] = "/cloudsql/f3data:us-central1:f3data-nonprod"
    with pytest.raises(SettingsError):
        Settings.from_env(values)


def test_nonprod_rejects_tcp_configuration(tmp_path):
    values = extension_env(tmp_path)
    values["ANALYTICS_POSTGRES_HOST"] = "localhost"
    values["ANALYTICS_POSTGRES_PORT"] = "5433"
    with pytest.raises(SettingsError):
        Settings.from_env(values)


def test_production_rejects_tcp_configuration(tmp_path):
    values = extension_env(tmp_path)
    values.update(
        {
            "ANALYTICS_ENVIRONMENT": "production",
            "ANALYTICS_POSTGRES_DATABASE": "f3_prod",
            "ANALYTICS_POSTGRES_HOST": "localhost",
            "ANALYTICS_POSTGRES_PORT": "5433",
        }
    )
    values.pop("ANALYTICS_POSTGRES_SOCKET_DIR")
    with pytest.raises(SettingsError):
        Settings.from_env(values)


def test_production_target_is_distinct_and_socket_pinned(tmp_path):
    values = extension_env(tmp_path)
    values.update(
        {
            "ANALYTICS_ENVIRONMENT": "production",
            "ANALYTICS_POSTGRES_SOCKET_DIR": "/cloudsql/f3data:us-central1:f3data",
            "ANALYTICS_POSTGRES_DATABASE": "f3_prod",
        }
    )
    assert Settings.from_env(values).environment == "production"
    values["ANALYTICS_ENVIRONMENT"] = "Prod!"
    with pytest.raises(SettingsError):
        Settings.from_env(values)


def test_logging_is_json_and_redacts_secrets():
    stream = io.StringIO()
    JsonLogger(stream=stream).info("analytics.etl.started", run_id="run", password="hidden", rows=2)
    record = json.loads(stream.getvalue())
    assert record["event"] == "analytics.etl.started"
    assert record["context"]["password"] == "[REDACTED]"
    assert "hidden" not in stream.getvalue()


def test_logging_supports_exceptions():
    stream = io.StringIO()
    error = RuntimeError("postgres://etl:password@db.example.test/f3")
    JsonLogger(stream=stream).error(
        "analytics.etl.failed",
        error,
        dsn="postgres://etl:password@db.example.test/f3",
        private_key="secret-key",
    )
    record = json.loads(stream.getvalue())
    assert record["error"]["type"] == "RuntimeError"
    assert record["error"]["module"] == "builtins"
    assert record["context"]["dsn"] == "[REDACTED]"
    assert record["context"]["private_key"] == "[REDACTED]"
    assert "password" not in stream.getvalue()
    assert "postgres://" not in stream.getvalue()


def test_logging_exception_origin_is_safe_and_terminal():
    stream = io.StringIO()

    def raise_error():
        raise RuntimeError("dsn=postgres://user:password@example.test token=email@example.test")

    with pytest.raises(RuntimeError):
        raise_error()
    try:
        raise_error()
    except RuntimeError as error:
        JsonLogger(stream=stream).error("analytics.etl.failed", error)
    record = json.loads(stream.getvalue())
    assert record["error"]["origin"]["file"] == "test_foundation.py"
    assert isinstance(record["error"]["origin"]["line"], int)
    assert record["error"]["origin"]["function"] == "raise_error"
    assert "postgres://" not in stream.getvalue()
    assert "password" not in stream.getvalue()
    assert "token" not in stream.getvalue()
    assert "email@example.test" not in stream.getvalue()


def test_run_ids_are_unique_and_stable_format():
    now = datetime(2026, 1, 2, tzinfo=timezone.utc)
    first, second = RunId.create(now), RunId.create(now)
    assert first.value.startswith("20260102T000000.000000Z-")
    assert first != second


def test_duckdb_loads_explicit_extension_without_install(tmp_path):
    values = extension_env(tmp_path)
    settings = Settings.from_env(values)
    calls = []

    class Connection:
        def load_extension(self, name):
            calls.append(("LOAD", name))

        def execute(self, sql, *parameters):
            calls.append((sql, parameters))

        def close(self):
            calls.append(("CLOSE",))

    class Duckdb:
        @staticmethod
        def connect(database, config):
            assert database == ":memory:"
            assert config["autoinstall_known_extensions"] == "false"
            assert config["autoload_known_extensions"] == "false"
            return Connection()

    connection = connect(settings, Duckdb)
    assert connection is not None
    assert calls[0] == ("LOAD", "postgres")
    assert calls[-1][0].startswith("SET lock_configuration")


def test_duckdb_closes_connection_when_loading_fails(tmp_path):
    settings = Settings.from_env(extension_env(tmp_path))
    closed = []

    class Connection:
        def load_extension(self, name):
            raise RuntimeError(name)

        def close(self):
            closed.append(True)

    class Duckdb:
        @staticmethod
        def connect(database, config):
            return Connection()

    with pytest.raises(RuntimeError):
        connect(settings, Duckdb)
    assert closed == [True]


def test_postgres_attach_literal_is_escaped_and_read_only(tmp_path):
    configured = Settings.from_env(extension_env(tmp_path) | {"ANALYTICS_POSTGRES_PASSWORD": "p'a;ss"})
    statement = postgres_attach_sql(configured)
    assert "READ_ONLY" in statement
    assert ";" not in statement
    assert "%27" in statement


def test_cli_failure_returns_nonzero(monkeypatch, capsys):
    monkeypatch.setenv("ANALYTICS_ENVIRONMENT", "test")
    monkeypatch.setenv("DUCKDB_EXTENSION_DIR", "/missing")
    monkeypatch.setenv("DUCKDB_POSTGRES_EXTENSION_PATH", "/missing/postgres_scanner.duckdb_extension")
    monkeypatch.setattr("sys.argv", ["analytics-etl", "preflight"])
    assert main() == 1
    assert "analytics.etl.cli_failed" in capsys.readouterr().err


def test_cli_success_returns_zero(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("ANALYTICS_ENVIRONMENT", "test")
    monkeypatch.setenv("ANALYTICS_POSTGRES_SOCKET_DIR", "/cloudsql/f3data:us-central1:f3data-nonprod")
    monkeypatch.setenv("ANALYTICS_POSTGRES_USER", "analytics")
    monkeypatch.setenv("ANALYTICS_POSTGRES_PASSWORD", "password")
    monkeypatch.setenv("ANALYTICS_POSTGRES_DATABASE", "f3_staging")
    monkeypatch.setenv("DUCKDB_EXTENSION_DIR", str(tmp_path))
    extension = tmp_path / "postgres_scanner.duckdb_extension"
    extension.touch()
    monkeypatch.setenv("DUCKDB_POSTGRES_EXTENSION_PATH", str(extension))
    monkeypatch.setattr(
        "analytics.cli.connect", lambda settings: type("Connection", (), {"close": lambda self: None})()
    )
    monkeypatch.setattr("sys.argv", ["analytics-etl", "preflight"])
    assert main() == 0
    assert "analytics.etl.preflight_succeeded" in capsys.readouterr().out


def test_cli_batch_failure_has_deterministic_structured_event(monkeypatch, tmp_path, capsys):
    from analytics.pipeline import BatchRunError

    settings = Settings.from_env(extension_env(tmp_path))
    monkeypatch.setattr("analytics.cli.Settings.from_env", lambda *_args, **_kwargs: settings)
    monkeypatch.setattr("google.cloud.storage.Client", lambda: object())
    monkeypatch.setattr(
        "analytics.pipeline.run",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            BatchRunError(
                {"pv_z": TypeError("ignored"), "pv_a": ValueError("ignored")},
                {"pv_a": {"connection_close": RuntimeError("ignored")}},
            )
        ),
    )
    monkeypatch.setattr("sys.argv", ["analytics-etl", "run", "--materialization", "pv_regions"])

    assert main() == 1
    stderr = capsys.readouterr().err
    records = [json.loads(line) for line in stderr.splitlines()]
    batch_records = [record for record in records if record["event"] == "analytics.etl.cli_batch_failed"]
    assert len(batch_records) == 1
    context = batch_records[0]["context"]
    assert context["dataset_failure_count"] == 2
    assert [item["materialization"] for item in context["dataset_failures"]] == ["pv_a", "pv_z"]
    assert context["cleanup_failure_count"] == 1
    assert context["cleanup_failures"] == [
        {"materialization": "pv_a", "cleanup": "connection_close", "type": "RuntimeError"}
    ]
    assert "ignored" not in stderr
