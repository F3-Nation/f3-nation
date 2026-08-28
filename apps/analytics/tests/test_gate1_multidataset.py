from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

import analytics.materializations as materializations_module
import analytics.pipeline as pipeline_module
from analytics.lease import GcsLease, LeaseActiveError
from analytics.materializations import (
    MATERIALIZATION_REGISTRY,
    MATERIALIZATIONS,
    select_materializations,
)
from analytics.pipeline import BatchRunError, run
from analytics.publication import BigQueryPublisher, GcsPublisher, PointerConflictError, publish
from analytics.settings import Settings, SettingsError


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
def test_registry_has_exact_environment_targets(definition):
    assert definition.target("nonprod") == (
        f"gs://f3-analytics-nonprod/parquets/{definition.name}",
        f"f3data.paxVaultDuckStaging.{definition.name}",
    )
    assert definition.target("production") == (
        f"gs://analytics/parquets/{definition.name}",
        f"f3data.paxVaultDuck.{definition.name}",
    )
    assert definition.schema_version == f"{definition.name}.v1"
    assert definition.output_filename == f"{definition.name}.parquet"


def test_selectors_fail_closed_for_duplicate_unknown_and_unavailable(monkeypatch, tmp_path):
    with pytest.raises(ValueError, match="duplicate"):
        select_materializations(("pv_regions", "pv_regions"))
    with pytest.raises(ValueError, match="unknown"):
        select_materializations(("pv_nope",))
    monkeypatch.setattr(
        materializations_module,
        "_resource_exists",
        lambda materialization: materialization.name != "pv_pax",
    )
    with pytest.raises(ValueError, match="unavailable"):
        select_materializations(("pv_pax",))
    forged = replace(MATERIALIZATION_REGISTRY["pv_regions"], output_filename="unsafe.parquet")
    with pytest.raises(SettingsError, match="approved registry"):
        _settings(tmp_path).target(forged)


class _Blob:
    objects: dict[str, "_Blob"] = {}
    generation = 0

    def __init__(self, name):
        self.name = name

    def upload_from_filename(self, filename, **kwargs):
        self._save(Path(filename).read_bytes(), kwargs["if_generation_match"])

    def upload_from_string(self, value, **kwargs):
        self._save(value, kwargs["if_generation_match"])

    def _save(self, value, expected):
        current = self.objects.get(self.name)
        actual = 0 if current is None else current.generation
        if actual != expected:
            from google.api_core.exceptions import PreconditionFailed

            raise PreconditionFailed("synthetic generation conflict")
        type(self).generation += 1
        self.generation, self.size, self.crc32c, self.content = type(self).generation, len(value), "crc", value
        self.objects[self.name] = self

    def reload(self):
        from google.api_core.exceptions import NotFound

        if self.name not in self.objects:
            raise NotFound("synthetic missing")
        self.__dict__.update(self.objects[self.name].__dict__)


class _Bucket:
    def blob(self, name):
        return _Blob(name)


class _Storage:
    def bucket(self, name):
        return _Bucket()


class _Job:
    def result(self):
        return None


class _BigQuery:
    def __init__(self):
        self.queries = []

    def query(self, query):
        self.queries.append(query)
        return _Job()


def test_two_definitions_are_isolated_in_publication(tmp_path):
    _Blob.objects.clear()
    _Blob.generation = 0
    configured = _settings(tmp_path)
    bq = _BigQuery()
    statuses = []
    for definition in MATERIALIZATIONS[:2]:
        parquet = tmp_path / definition.output_filename
        parquet.write_bytes(definition.name.encode())
        gcs = GcsPublisher(_Storage(), configured, definition)
        statuses.append(
            publish(
                gcs,
                BigQueryPublisher(bq, configured, definition),
                "shared-run",
                parquet,
                1,
                "source",
                "published",
                definition,
            )
        )
    first, second = statuses
    assert first.parquet.uri != second.parquet.uri
    assert first.manifest_object.uri != second.manifest_object.uri
    assert first.pointer.uri != second.pointer.uri
    assert first.manifest["schema_version"] == "pv_regions.v1"
    assert second.manifest["schema_version"] == "pv_pax.v1"
    assert first.parquet.uri.endswith("pv_regions.parquet")
    assert second.parquet.uri.endswith("pv_pax.parquet")
    assert "paxVaultDuckStaging.pv_regions" in bq.queries[0]
    assert "paxVaultDuckStaging.pv_pax" in bq.queries[1]


def test_mismatched_publication_definitions_do_not_upload(tmp_path):
    _Blob.objects.clear()
    configured = _settings(tmp_path)
    first, second = MATERIALIZATIONS[:2]
    parquet = tmp_path / first.output_filename
    parquet.write_bytes(b"synthetic")
    with pytest.raises(ValueError, match="different materialization"):
        publish(
            GcsPublisher(_Storage(), configured, first),
            BigQueryPublisher(_BigQuery(), configured, second),
            "mismatch-run",
            parquet,
            1,
            "source",
            "published",
            first,
        )
    assert _Blob.objects == {}


@pytest.mark.parametrize("failure_stage", ("lease", "source", "bigquery", "pointer"))
def test_pipeline_continues_after_each_dataset_failure(monkeypatch, tmp_path, failure_stage):
    configured = _settings(tmp_path)
    first, second = MATERIALIZATIONS[:2]
    monkeypatch.setattr(
        pipeline_module,
        "select_materializations",
        lambda names: (first, second),
    )
    acquired = []
    closed = []

    class Lease:
        def __init__(self, _storage, _settings, definition):
            self.definition = definition

        def acquire(self, *_args):
            if self.definition is first and failure_stage == "lease":
                raise RuntimeError("first lease failed")
            acquired.append(self.definition.name)
            return object()

        def release(self, *_args):
            pass

    class Connection:
        def close(self):
            closed.append(True)

    monkeypatch.setattr(pipeline_module, "GcsLease", Lease)
    monkeypatch.setattr(pipeline_module, "attach_postgres", lambda *_args: None)
    monkeypatch.setattr(
        pipeline_module,
        "materialize",
        lambda _c, _p, definition, *_args: _materialize(definition, first, failure_stage),
    )
    monkeypatch.setattr(
        pipeline_module,
        "publish",
        lambda gcs, _bigquery, *_args, **_kwargs: _publish(gcs.materialization, first, failure_stage),
    )

    with pytest.raises(BatchRunError) as raised:
        run(configured, _Storage(), _BigQuery(), connection_factory=lambda _settings: Connection(), run_id="synthetic")
    assert set(raised.value.failures) == {first.name}
    assert second.name not in raised.value.failures
    assert second.name in acquired
    assert len(closed) == (1 if failure_stage == "lease" else 2)


def _materialize(definition, selected_definition, failure_stage):
    if definition is selected_definition and failure_stage == "source":
        raise RuntimeError("first source failed")
    return 1


def _publish(definition, selected_definition, failure_stage):
    if definition is selected_definition and failure_stage == "pointer":
        raise PointerConflictError({"stage": "pointer_update"})
    if definition is selected_definition and failure_stage == "bigquery":
        raise RuntimeError(f"first {failure_stage} failed")
    return object()


def test_pipeline_aggregates_all_named_failures(monkeypatch, tmp_path):
    configured = _settings(tmp_path)
    definitions = MATERIALIZATIONS[:4]
    monkeypatch.setattr(pipeline_module, "select_materializations", lambda _names: definitions)

    class Lease:
        def __init__(self, _storage, _settings, definition):
            self.definition = definition

        def acquire(self, *_args):
            return object()

        def release(self, *_args):
            pass

    class Connection:
        def close(self):
            pass

    monkeypatch.setattr(pipeline_module, "GcsLease", Lease)
    monkeypatch.setattr(pipeline_module, "attach_postgres", lambda *_args: None)
    monkeypatch.setattr(pipeline_module, "materialize", lambda *_args: (_ for _ in ()).throw(RuntimeError("failed")))
    with pytest.raises(BatchRunError) as raised:
        run(configured, _Storage(), _BigQuery(), connection_factory=lambda _settings: Connection(), run_id="all-failed")
    assert set(raised.value.failures) == {definition.name for definition in definitions}


def test_pipeline_records_lease_constructor_failure_and_continues(monkeypatch, tmp_path):
    configured = _settings(tmp_path)
    first, second = MATERIALIZATIONS[:2]
    monkeypatch.setattr(pipeline_module, "select_materializations", lambda _names: (first, second))
    constructed = []
    monkeypatch.setattr(
        pipeline_module,
        "GcsLease",
        lambda _storage, _settings, definition: (
            (_ for _ in ()).throw(RuntimeError("bucket failed"))
            if definition is first
            else _TestLease(constructed, definition)
        ),
    )
    monkeypatch.setattr(pipeline_module, "attach_postgres", lambda *_args: None)
    monkeypatch.setattr(pipeline_module, "materialize", lambda *_args: 1)
    monkeypatch.setattr(pipeline_module, "publish", lambda *_args, **_kwargs: object())
    with pytest.raises(BatchRunError) as raised:
        run(
            configured,
            _Storage(),
            _BigQuery(),
            connection_factory=lambda _settings: _TestConnection(),
            run_id="constructor",
        )
    assert isinstance(raised.value.failures[first.name], RuntimeError)
    assert second.name in constructed


class _TestLease:
    def __init__(self, constructed, definition):
        constructed.append(definition.name)

    def acquire(self, *_args):
        return object()

    def release(self, *_args):
        pass


class _TestConnection:
    def close(self):
        pass


def test_active_lease_metadata_distinguishes_owner_and_attempt(tmp_path):
    from datetime import datetime, timezone

    # Reuse the in-memory lease protocol used by the focused lease tests.
    class Blob:
        content = b'{"state":"active","run_id":"owner-run","expires_at":"2999-01-01T00:00:00Z"}'
        generation = 7

        def reload(self):
            return None

        def download_as_text(self):
            return self.content.decode()

    class Storage:
        def bucket(self, _name):
            return self

        def blob(self, _name):
            return Blob()

    error = None
    try:
        GcsLease(Storage(), _settings(tmp_path), MATERIALIZATION_REGISTRY["pv_regions"]).acquire(
            _settings(tmp_path), "attempt-run", {}, datetime.now(timezone.utc)
        )
    except LeaseActiveError as raised:
        error = raised
    assert error is not None
    assert error.metadata["lease_owner_run_id"] == "owner-run"
    assert "run_id" not in error.metadata
    assert error.metadata["materialization"] == "pv_regions"


@pytest.mark.parametrize("signal", (KeyboardInterrupt, SystemExit))
def test_pipeline_propagates_cancellation_without_later_dataset(monkeypatch, tmp_path, signal):
    configured = _settings(tmp_path)
    first, second = MATERIALIZATIONS[:2]
    attempted = []
    monkeypatch.setattr(pipeline_module, "select_materializations", lambda _names: (first, second))
    monkeypatch.setattr(
        pipeline_module,
        "GcsLease",
        lambda _storage, _settings, definition: _TestLease(attempted, definition),
    )
    monkeypatch.setattr(pipeline_module, "attach_postgres", lambda *_args: None)
    monkeypatch.setattr(pipeline_module, "materialize", lambda *_args: (_ for _ in ()).throw(signal()))
    with pytest.raises(signal):
        run(
            configured,
            _Storage(),
            _BigQuery(),
            connection_factory=lambda _settings: _TestConnection(),
            run_id="cancel",
        )
    assert attempted == [first.name]


def test_publication_events_include_materialization(tmp_path):
    definition = MATERIALIZATION_REGISTRY["pv_regions"]
    parquet = tmp_path / definition.output_filename
    parquet.write_bytes(b"synthetic")
    events = []
    publish(
        GcsPublisher(_Storage(), _settings(tmp_path), definition),
        BigQueryPublisher(_BigQuery(), _settings(tmp_path), definition),
        "events-run",
        parquet,
        1,
        "source",
        "published",
        definition,
        emit=lambda event, context: events.append((event, context)),
    )
    assert events
    assert all(context["materialization"] == definition.name for _, context in events)
