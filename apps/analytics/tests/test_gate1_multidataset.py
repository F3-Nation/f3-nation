from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

import pytest

import analytics.materializations as materializations_module
import analytics.pipeline as pipeline_module
from analytics.materializations import MATERIALIZATION_REGISTRY, MATERIALIZATIONS, select_materializations
from analytics.pipeline import BatchRunError, run
from analytics.publication import CatalogConflictError, ObjectMetadata, PublicationStatus
from analytics.settings import Settings, SettingsError
from analytics.source import MaterializationArtifacts


def _settings(tmp_path: Path) -> Settings:
    extension_dir = tmp_path / "extensions"
    extension_dir.mkdir(exist_ok=True)
    extension = extension_dir / "postgres.duckdb_extension"
    extension.touch()
    return Settings.from_env(
        {
            "ANALYTICS_ENVIRONMENT": "test",
            "DUCKDB_EXTENSION_DIR": str(extension_dir),
            "DUCKDB_POSTGRES_EXTENSION_PATH": str(extension),
            "ANALYTICS_POSTGRES_SOCKET_DIR": "/cloudsql/f3data:us-central1:f3data-nonprod",
            "ANALYTICS_POSTGRES_USER": "analytics",
            "ANALYTICS_POSTGRES_PASSWORD": "synthetic",
            "ANALYTICS_POSTGRES_DATABASE": "f3_staging",
        }
    )


@pytest.mark.parametrize("definition", MATERIALIZATIONS)
def test_registry_contract_is_unchanged(definition):
    assert definition.target("nonprod") == (f"gs://f3-analytics-nonprod/parquets/{definition.name}", "")
    assert definition.target("production") == (f"gs://f3-analytics/parquets/{definition.name}", "")
    assert definition.schema_version == f"{definition.name}.v1"
    assert definition.output_filename == f"{definition.name}.parquet"


def test_selectors_fail_closed_for_duplicate_unknown_and_unavailable(monkeypatch, tmp_path):
    with pytest.raises(ValueError, match="duplicate"):
        select_materializations(("pv_regions", "pv_regions"))
    with pytest.raises(ValueError, match="unknown"):
        select_materializations(("pv_nope",))
    monkeypatch.setattr(materializations_module, "_resource_exists", lambda item: item.name != "pv_pax")
    with pytest.raises(ValueError, match="unavailable"):
        select_materializations(("pv_pax",))
    forged = replace(MATERIALIZATION_REGISTRY["pv_regions"], output_filename="unsafe.parquet")
    with pytest.raises(SettingsError, match="approved registry"):
        _settings(tmp_path).target(forged)


def test_real_subset_run_rejects_before_source_or_catalog(monkeypatch, tmp_path):
    source_calls = []
    publisher_calls = []

    def connection_factory(_settings):
        source_calls.append(True)
        return type("Connection", (), {"close": lambda self: None})()

    monkeypatch.setattr(pipeline_module, "GcsPublisher", lambda *_args: publisher_calls.append(True))
    with pytest.raises(ValueError, match="exact approved"):
        run(
            _settings(tmp_path),
            object(),
            connection_factory=connection_factory,
            run_id="subset",
            materializations=("pv_regions",),
        )
    assert source_calls == []
    assert publisher_calls == []


class FakePublisher:
    instances: list["FakePublisher"] = []
    fail_commit = False

    def __init__(self, *_args):
        self.release_uploaded = False
        self.catalog_committed = False
        self.__class__.instances.append(self)

    def upload_release_manifest(self, run_id, manifest):
        self.release_uploaded = True
        return ObjectMetadata(f"gs://bucket/releases/{run_id}/release.json", "9", 10, "crc")

    def commit_catalog(self, run_id, release, source_order):
        if self.fail_commit:
            raise CatalogConflictError({"stage": "catalog_update", "run_id": run_id})
        self.catalog_committed = True
        return type("Catalog", (), {"generation": 2})()


def _status(definition, run_id="run"):
    object_metadata = ObjectMetadata(f"gs://bucket/releases/run/{definition.name}/data.parquet", "1", 1, "crc")
    manifest_object = ObjectMetadata(f"gs://bucket/releases/run/{definition.name}/manifest.json", "2", 2, "crc")
    manifest = {
        "dataset": definition.name,
        "run_id": run_id,
        "schema_version": definition.schema_version,
        "file_count": 1,
        "byte_count": 1,
    }
    return PublicationStatus(manifest, (object_metadata,), manifest_object)


def test_failed_dataset_has_no_release_or_catalog_commit_and_connections_close(monkeypatch, tmp_path):
    first, second = MATERIALIZATIONS[:2]
    closed = []
    FakePublisher.instances.clear()
    monkeypatch.setattr(pipeline_module, "GcsPublisher", FakePublisher)
    monkeypatch.setattr(pipeline_module, "select_materializations", lambda _names: (first, second))
    monkeypatch.setattr(pipeline_module, "attach_postgres", lambda *_args: None)
    monkeypatch.setattr(pipeline_module, "materialize", lambda *_args: MaterializationArtifacts(Path("/tmp"), (), 1))
    monkeypatch.setattr(
        pipeline_module,
        "publish",
        lambda _gcs, _run, _artifacts, _source, _published, definition, **_kw: (
            _status(definition) if definition is first else (_ for _ in ()).throw(RuntimeError("failed"))
        ),
    )
    with pytest.raises(BatchRunError) as raised:
        run(
            _settings(tmp_path),
            object(),
            connection_factory=lambda _settings: type("C", (), {"close": lambda self: closed.append(True)})(),
            run_id="run",
        )
    assert set(raised.value.failures) == {second.name}
    assert closed == [True, True]
    assert not any(item.release_uploaded or item.catalog_committed for item in FakePublisher.instances)


def test_catalog_conflict_fails_safely_after_release_upload(monkeypatch, tmp_path):
    definitions = MATERIALIZATIONS
    FakePublisher.instances.clear()
    FakePublisher.fail_commit = True
    monkeypatch.setattr(pipeline_module, "GcsPublisher", FakePublisher)
    monkeypatch.setattr(pipeline_module, "select_materializations", lambda _names: definitions)
    monkeypatch.setattr(pipeline_module, "attach_postgres", lambda *_args: None)
    monkeypatch.setattr(pipeline_module, "materialize", lambda *_args: MaterializationArtifacts(Path("/tmp"), (), 1))
    monkeypatch.setattr(
        pipeline_module,
        "publish",
        lambda _gcs, _run, _artifacts, _source, _published, definition, **_kw: _status(definition, "conflict"),
    )
    try:
        with pytest.raises(BatchRunError) as raised:
            run(
                _settings(tmp_path),
                object(),
                connection_factory=lambda _settings: type("C", (), {"close": lambda self: None})(),
                run_id="conflict",
            )
        assert isinstance(raised.value.failures["batch"], CatalogConflictError)
        assert FakePublisher.instances[-1].release_uploaded
        assert not FakePublisher.instances[-1].catalog_committed
    finally:
        FakePublisher.fail_commit = False


def test_dataset_manifest_publish_times_are_captured_before_release_commit(monkeypatch, tmp_path):
    published_times = []
    clock_values = iter(range(10, 22))
    monkeypatch.setattr(pipeline_module, "GcsPublisher", FakePublisher)
    monkeypatch.setattr(pipeline_module, "select_materializations", lambda _names: MATERIALIZATIONS)
    monkeypatch.setattr(pipeline_module, "attach_postgres", lambda *_args: None)
    monkeypatch.setattr(pipeline_module, "materialize", lambda *_args: MaterializationArtifacts(Path("/tmp"), (), 1))

    def fake_publish(_gcs, _run, _artifacts, _source, published_at, definition, **_kw):
        published_times.append((definition.name, published_at))
        return _status(definition, _run)

    monkeypatch.setattr(pipeline_module, "publish", fake_publish)
    run(
        _settings(tmp_path),
        object(),
        connection_factory=lambda _settings: type("C", (), {"close": lambda self: None})(),
        now=lambda: datetime.fromtimestamp(next(clock_values), timezone.utc),
        run_id="publish-times",
    )
    assert [value for _, value in published_times] == [
        f"1970-01-01T00:00:{second:02d}+00:00" for second in range(11, 20)
    ]


@pytest.mark.parametrize("signal", (KeyboardInterrupt, SystemExit))
def test_pipeline_propagates_cancellation_without_later_dataset(monkeypatch, tmp_path, signal):
    first, second = MATERIALIZATIONS[:2]
    attempted = []
    monkeypatch.setattr(pipeline_module, "select_materializations", lambda _names: (first, second))
    monkeypatch.setattr(pipeline_module, "attach_postgres", lambda *_args: None)
    monkeypatch.setattr(
        pipeline_module,
        "materialize",
        lambda *_args: (attempted.append(first.name), (_ for _ in ()).throw(signal()))[1],
    )
    with pytest.raises(signal):
        run(
            _settings(tmp_path),
            object(),
            connection_factory=lambda _settings: type("C", (), {"close": lambda self: None})(),
            run_id="cancel",
        )
    assert attempted == [first.name]
