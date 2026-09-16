from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

import analytics.local_export as local_export_module
from analytics.local_export import export_local
from analytics.materializations import MATERIALIZATION_REGISTRY
from analytics.settings import Settings, SettingsError
from analytics.source import MaterializationArtifacts

_RUN_ONE = "20260102T000000.000000Z-00000000000000000000000000000001"
_RUN_FAIL = "20260102T000000.000000Z-00000000000000000000000000000002"
_RUN_TWO = "20260102T000000.000000Z-00000000000000000000000000000003"


def _settings(tmp_path: Path, environment: str = "local") -> Settings:
    extension_dir = tmp_path / "extensions"
    extension_dir.mkdir(exist_ok=True)
    extension = extension_dir / "postgres.duckdb_extension"
    extension.touch()
    values = {
        "ANALYTICS_ENVIRONMENT": environment,
        "DUCKDB_EXTENSION_DIR": str(extension_dir),
        "DUCKDB_POSTGRES_EXTENSION_PATH": str(extension),
        "ANALYTICS_POSTGRES_USER": "analytics",
        "ANALYTICS_POSTGRES_PASSWORD": "synthetic",
        "ANALYTICS_POSTGRES_DATABASE": "f3_staging",
        "ANALYTICS_POSTGRES_HOST": "localhost",
        "ANALYTICS_POSTGRES_PORT": "5433",
    }
    if environment != "local":
        values["ANALYTICS_POSTGRES_SOCKET_DIR"] = "/cloudsql/f3data:us-central1:f3data-nonprod"
        values.pop("ANALYTICS_POSTGRES_HOST")
        values.pop("ANALYTICS_POSTGRES_PORT")
    return Settings.from_env(values)


def test_export_local_keeps_persistent_run_scoped_outputs(monkeypatch, tmp_path: Path):
    settings = _settings(tmp_path)
    output_dir = tmp_path / "exports"
    output_dir.mkdir(mode=0o700)
    definition = MATERIALIZATION_REGISTRY["pv_regions"]
    closed = []

    class Connection:
        def close(self):
            closed.append(True)

    def fake_materialize(_connection, root, materialization, _refreshed_at, _as_of_date):
        root.mkdir(parents=True)
        parquet = root / materialization.output_filename
        parquet.write_bytes(b"synthetic parquet")
        return MaterializationArtifacts(root, (parquet,), 2)

    monkeypatch.setattr(local_export_module, "attach_postgres", lambda *_args: None)
    monkeypatch.setattr(local_export_module, "materialize", fake_materialize)
    results = export_local(
        settings,
        output_dir,
        (definition.name,),
        connection_factory=lambda _settings: Connection(),
        run_id=_RUN_ONE,
    )

    output = output_dir / _RUN_ONE / definition.name / definition.output_filename
    assert output.exists()
    assert results[definition.name].root == output_dir / _RUN_ONE / definition.name
    assert closed == [True]


def test_export_local_samples_each_materialization_independently(monkeypatch, tmp_path: Path):
    settings = _settings(tmp_path)
    output_dir = tmp_path / "exports"
    output_dir.mkdir(mode=0o700)
    definitions = (MATERIALIZATION_REGISTRY["pv_regions"], MATERIALIZATION_REGISTRY["pv_pax"])
    sampled = []
    timestamps = iter(
        (
            datetime(2026, 1, 2, 23, 30, tzinfo=timezone.utc),
            datetime(2026, 1, 3, 0, 30, tzinfo=timezone.utc),
        )
    )

    class Connection:
        def close(self):
            pass

    def materialize_with_inputs(_connection, root, materialization, refreshed_at, as_of_date):
        sampled.append((materialization.name, refreshed_at, as_of_date))
        root.mkdir(parents=True)
        parquet = root / materialization.output_filename
        parquet.write_bytes(b"synthetic parquet")
        return MaterializationArtifacts(root, (parquet,), 1)

    monkeypatch.setattr(local_export_module, "select_materializations", lambda _names: definitions)
    monkeypatch.setattr(local_export_module, "attach_postgres", lambda *_args: None)
    monkeypatch.setattr(local_export_module, "materialize", materialize_with_inputs)
    export_local(
        settings,
        output_dir,
        tuple(definition.name for definition in definitions),
        connection_factory=lambda _settings: Connection(),
        now=lambda: next(timestamps),
        run_id=_RUN_ONE,
    )

    assert sampled == [
        ("pv_regions", "2026-01-02T23:30:00+00:00", "2026-01-02"),
        ("pv_pax", "2026-01-03T00:30:00+00:00", "2026-01-03"),
    ]


def test_export_local_removes_staging_on_multi_materialization_failure(monkeypatch, tmp_path: Path):
    settings = _settings(tmp_path)
    output_dir = tmp_path / "exports"
    output_dir.mkdir(mode=0o700)
    definitions = (MATERIALIZATION_REGISTRY["pv_regions"], MATERIALIZATION_REGISTRY["pv_pax"])
    calls = []

    class Connection:
        def close(self):
            pass

    def fail_second(_connection, root, materialization, _refreshed_at, _as_of_date):
        calls.append(materialization.name)
        if materialization.name == "pv_pax":
            raise RuntimeError("synthetic failure")
        root.mkdir(parents=True)
        parquet = root / materialization.output_filename
        parquet.write_bytes(b"synthetic parquet")
        return MaterializationArtifacts(root, (parquet,), 1)

    monkeypatch.setattr(local_export_module, "select_materializations", lambda _names: definitions)
    monkeypatch.setattr(local_export_module, "attach_postgres", lambda *_args: None)
    monkeypatch.setattr(local_export_module, "materialize", fail_second)
    with pytest.raises(RuntimeError, match="synthetic failure"):
        export_local(
            settings, output_dir, ("pv_regions",), connection_factory=lambda _settings: Connection(), run_id=_RUN_FAIL
        )
    assert calls == ["pv_regions", "pv_pax"]
    assert not (output_dir / _RUN_FAIL).exists()
    assert not (output_dir / f".staging-{_RUN_FAIL}").exists()


def test_export_local_rejects_invalid_run_id(tmp_path: Path):
    output_dir = tmp_path / "exports"
    output_dir.mkdir(mode=0o700)
    with pytest.raises(ValueError, match="invalid run"):
        export_local(_settings(tmp_path), output_dir, ("pv_regions",), run_id="../escape")


def test_export_local_preserves_primary_failure_when_close_fails(monkeypatch, tmp_path: Path):
    output_dir = tmp_path / "exports"
    output_dir.mkdir(mode=0o700)

    class Connection:
        def close(self):
            raise RuntimeError("close failure")

    monkeypatch.setattr(local_export_module, "attach_postgres", lambda *_args: None)
    monkeypatch.setattr(
        local_export_module,
        "materialize",
        lambda *_args: (_ for _ in ()).throw(RuntimeError("primary")),
    )
    with pytest.raises(RuntimeError, match="primary"):
        export_local(
            _settings(tmp_path),
            output_dir,
            ("pv_regions",),
            connection_factory=lambda _settings: Connection(),
            run_id=_RUN_TWO,
        )


def test_export_local_returns_finalized_output_when_close_fails(monkeypatch, tmp_path: Path):
    output_dir = tmp_path / "exports"
    output_dir.mkdir(mode=0o700)
    definition = MATERIALIZATION_REGISTRY["pv_regions"]

    class Connection:
        def close(self):
            raise RuntimeError("close failure")

    def materialize_output(_connection, root, materialization, _refreshed_at, _as_of_date):
        root.mkdir(parents=True)
        parquet = root / materialization.output_filename
        parquet.write_bytes(b"synthetic parquet")
        return MaterializationArtifacts(root, (parquet,), 1)

    monkeypatch.setattr(local_export_module, "attach_postgres", lambda *_args: None)
    monkeypatch.setattr(local_export_module, "materialize", materialize_output)
    results = export_local(
        _settings(tmp_path),
        output_dir,
        (definition.name,),
        connection_factory=lambda _settings: Connection(),
        run_id=_RUN_TWO,
    )
    assert results[definition.name].root == output_dir / _RUN_TWO / definition.name
    assert (results[definition.name].root / definition.output_filename).exists()


@pytest.mark.parametrize("bad", ("relative", "missing", "link", "permissive"))
def test_export_local_rejects_unsafe_output_directory(tmp_path: Path, bad: str):
    settings = _settings(tmp_path)
    if bad == "relative":
        output_dir = Path("relative")
    elif bad == "missing":
        output_dir = tmp_path / "missing"
    elif bad == "link":
        target = tmp_path / "target"
        target.mkdir()
        output_dir = tmp_path / "link"
        output_dir.symlink_to(target, target_is_directory=True)
    else:
        output_dir = tmp_path / "permissive"
        output_dir.mkdir(mode=0o755)
    with pytest.raises(ValueError, match="output-dir"):
        export_local(settings, output_dir, ("pv_regions",))


def test_export_local_rejects_prohibited_environment_and_selection(tmp_path: Path):
    output_dir = tmp_path / "exports"
    output_dir.mkdir(mode=0o700)
    with pytest.raises(SettingsError, match="local"):
        export_local(_settings(tmp_path, "test"), output_dir, ("pv_regions",))
    with pytest.raises(ValueError, match="unknown"):
        export_local(_settings(tmp_path), output_dir, ("pv_unknown",))


def test_export_local_path_has_no_gcs_side_effects(monkeypatch, tmp_path: Path):
    settings = _settings(tmp_path)
    output_dir = tmp_path / "exports"
    output_dir.mkdir(mode=0o700)
    called = []
    monkeypatch.setattr(local_export_module, "attach_postgres", lambda *_args: None)
    monkeypatch.setattr(
        local_export_module,
        "materialize",
        lambda *_args: called.append(True) or MaterializationArtifacts(tmp_path, (), 0),
    )
    monkeypatch.setattr("google.cloud.storage.Client", lambda: pytest.fail("GCS client must not be created"))
    export_local(
        settings,
        output_dir,
        ("pv_regions",),
        connection_factory=lambda _settings: type("C", (), {"close": lambda self: None})(),
        run_id=_RUN_TWO,
    )
    assert called == [True]


def test_cli_export_local_rejects_nonlocal_and_unsafe_paths(monkeypatch, tmp_path: Path, capsys):
    from analytics.cli import main

    monkeypatch.setattr("google.cloud.storage.Client", lambda: pytest.fail("GCS client must not be created"))
    settings = _settings(tmp_path, "test")
    monkeypatch.setattr("analytics.cli.Settings.from_env", lambda *_args, **_kwargs: settings)
    monkeypatch.setattr("sys.argv", ["analytics-etl", "export-local", "--output-dir", str(tmp_path)])
    assert main() == 1
    assert "analytics.etl.cli_failed" in capsys.readouterr().err

    monkeypatch.setattr("sys.argv", ["analytics-etl", "--output-dir", str(tmp_path), "export-local"])
    with pytest.raises(SystemExit, match="2"):
        main()

    monkeypatch.setattr("analytics.cli.Settings.from_env", lambda *_args, **_kwargs: _settings(tmp_path))
    monkeypatch.setattr("sys.argv", ["analytics-etl", "export-local", "--output-dir", str(tmp_path / "missing")])
    assert main() == 1
    assert "analytics.etl.cli_failed" in capsys.readouterr().err


def test_cli_export_local_success_never_enters_gcs_branch(monkeypatch, tmp_path: Path):
    import builtins

    from analytics.cli import main

    output_dir = tmp_path / "exports"
    output_dir.mkdir(mode=0o700)
    settings = _settings(tmp_path)
    calls = []

    def fake_export(_settings, destination, materializations, run_id):
        calls.append((destination, materializations, run_id))
        (destination / run_id).mkdir(mode=0o700)
        return {}

    real_import = builtins.__import__

    def fail_gcs_import(name, *args, **kwargs):
        if name == "google.cloud.storage":
            raise AssertionError("export-local must not import GCS")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr("analytics.cli.Settings.from_env", lambda *_args, **_kwargs: settings)
    monkeypatch.setattr("analytics.local_export.export_local", fake_export)
    monkeypatch.setattr("google.cloud.storage.Client", lambda: pytest.fail("GCS client must not be created"))
    monkeypatch.setattr(builtins, "__import__", fail_gcs_import)
    monkeypatch.setattr(
        "sys.argv",
        ["analytics-etl", "export-local", "--output-dir", str(output_dir), "--materialization", "pv_regions"],
    )

    assert main() == 0
    assert len(calls) == 1
    destination, materializations, run_id = calls[0]
    assert destination == output_dir
    assert materializations == ("pv_regions",)
    assert (output_dir / run_id).is_dir()
