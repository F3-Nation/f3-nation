from __future__ import annotations

import hashlib
import io
import json
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pytest

import analytics.materializations as materializations_module
import analytics.pipeline as pipeline_module
from analytics.logging import JsonLogger
from analytics.materializations import (
    ANALYTICS_NAMES,
    MATERIALIZATION_REGISTRY,
    MATERIALIZATIONS,
    select_materializations,
)
from analytics.pipeline import BatchRunError, run
from analytics.publication import ObjectMetadata, PointerConflictError, PublicationStatus
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
            "ANALYTICS_PRODUCER_REVISION": "gate2-test-revision",
        }
    )


@pytest.mark.parametrize("definition", MATERIALIZATIONS)
def test_registry_contract_is_unchanged(definition):
    assert definition.product == "pax-vault"
    assert definition.target("nonprod") == (
        f"gs://f3-analytics-nonprod/pax-vault/{definition.name}",
        "",
    )
    assert definition.target("production") == (f"gs://f3-analytics/pax-vault/{definition.name}", "")
    schema_versions = {
        "pv_regions": "pv_regions.v1",
        "pv_pax": "pv_pax.v2",
        "pv_kotter": "pv_kotter.v1",
        "pv_upcoming": "pv_upcoming.v1",
        "pv_sectors": "pv_sectors.v2",
        "pv_territories": "pv_territories.v1",
        "pv_areas": "pv_areas.v2",
        "pv_aos": "pv_aos.v1",
        "pv_events": "pv_events.v2",
    }
    assert definition.schema_version == schema_versions[definition.name]
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


def test_product_selection_uses_exact_analytics_materialization_set():
    assert tuple(item.name for item in select_materializations(None, product="analytics")) == ANALYTICS_NAMES


@pytest.mark.parametrize("part_sizes", ((3,), (1, 2)))
def test_candidate_count_golden_reads_real_single_and_multi_file_parquet(tmp_path, part_sizes):
    definition = MATERIALIZATION_REGISTRY["pv_events"]
    paths = []
    connection = duckdb.connect(":memory:")
    try:
        for index, size in enumerate(part_sizes):
            path = tmp_path / f"part-{index}.parquet"
            connection.execute(f"COPY (SELECT * FROM range({size})) TO '{path}' (FORMAT PARQUET)")
            paths.append(path)

        artifacts = MaterializationArtifacts(tmp_path, tuple(paths), sum(part_sizes))
        golden = pipeline_module._candidate_count_golden(connection, artifacts, definition)

        assert golden["query"] == "SELECT COUNT(*) AS row_count FROM pv_events"
        assert golden["canonicalization"] == "rows-json-v1"
        assert golden["artifact"] == f'[[{{"$bigint":"{sum(part_sizes)}"}}]]'.encode()
        assert golden["sha256"] == hashlib.sha256(golden["artifact"]).hexdigest()
        with pytest.raises(ValueError, match="row count"):
            pipeline_module._candidate_count_golden(
                connection,
                MaterializationArtifacts(tmp_path, tuple(paths), sum(part_sizes) + 1),
                definition,
            )
    finally:
        connection.close()


def test_real_subset_run_rejects_before_source_or_pointer(monkeypatch, tmp_path):
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
    commit_error: PointerConflictError | None = None
    uploaded_release: dict | None = None

    def __init__(self, *_args, **_kwargs):
        self.release_uploaded = False
        self.pointer_committed = False
        self.__class__.instances.append(self)

    def upload_release_manifest(self, run_id, manifest):
        self.release_uploaded = True
        self.__class__.uploaded_release = manifest
        return ObjectMetadata(f"gs://bucket/releases/{run_id}/release.json", "9", 10, "crc")

    def commit_pointer(self, run_id, release, digest, source_order, producer_revision, created_at):
        if self.commit_error is not None:
            self.pointer_committed = self.commit_error.committed
            raise self.commit_error
        self.pointer_committed = True
        return {
            "generation": "2",
            "releaseId": run_id,
            "releaseSequence": 1,
            "manifestUri": release.uri,
            "manifestGeneration": release.generation,
            "manifestSha256": digest,
            "sourceOrder": source_order,
            "producerRevision": producer_revision,
            "createdAtUtc": created_at,
        }


def _status(definition, run_id="run", source_order="source-order"):
    object_metadata = ObjectMetadata(f"gs://bucket/releases/run/{definition.name}/data.parquet", "1", 1, "crc")
    manifest_object = ObjectMetadata(f"gs://bucket/releases/run/{definition.name}/manifest.json", "2", 2, "crc")
    manifest = {
        "dataset": definition.name,
        "run_id": run_id,
        "schemaVersion": definition.schema_version,
        "sourceReadTimestampUtc": "2026-01-01T00:00:00+00:00",
        "sourceReadPolicy": "ordered-sequential-per-dataset",
        "sourceOrder": source_order,
    }
    return PublicationStatus(manifest, (object_metadata,), manifest_object)


class _Connection:
    def __init__(self, on_close=None):
        self.on_close = on_close

    def execute(self, *_args):
        return self

    def fetchone(self):
        return (1,)

    def close(self):
        if self.on_close:
            self.on_close()


def test_failed_dataset_has_no_release_or_pointer_commit_and_connections_close(monkeypatch, tmp_path):
    first, second = MATERIALIZATIONS[:2]
    closed = []
    FakePublisher.instances.clear()
    monkeypatch.setattr(pipeline_module, "GcsPublisher", FakePublisher)
    monkeypatch.setattr(pipeline_module, "select_materializations", lambda _names, **_kwargs: (first, second))
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
            connection_factory=lambda _settings: _Connection(lambda: closed.append(True)),
            run_id="run",
        )
    assert set(raised.value.failures) == {second.name}
    assert closed == [True, True]
    assert not any(item.release_uploaded or item.pointer_committed for item in FakePublisher.instances)


def test_failed_dataset_log_has_bounded_phase_and_artifact_state(monkeypatch, tmp_path):
    definition = MATERIALIZATIONS[0]
    stream = io.StringIO()
    failure = RuntimeError("raw SQL secret/path email@example.test")
    failure.__dict__["materialization_phase"] = "copy_query_to_parquet"
    monkeypatch.setattr(pipeline_module, "GcsPublisher", FakePublisher)
    monkeypatch.setattr(pipeline_module, "select_materializations", lambda _names, **_kwargs: (definition,))
    monkeypatch.setattr(pipeline_module, "attach_postgres", lambda *_args: None)
    monkeypatch.setattr(pipeline_module, "materialize", lambda *_args: (_ for _ in ()).throw(failure))

    with pytest.raises(BatchRunError):
        run(
            _settings(tmp_path),
            object(),
            connection_factory=lambda _settings: _Connection(),
            logger=JsonLogger(stream=stream),
            run_id="safe-failure",
        )

    records = [json.loads(line) for line in stream.getvalue().splitlines()]
    failed = next(record for record in records if record["event"] == "analytics.etl.dataset_failed")
    assert failed["context"]["phase"] == "copy_query_to_parquet"
    assert isinstance(failed["context"]["output_exists"], bool)
    assert failed["context"]["output_size_bucket"] in {"none", "small", "medium", "large", "unknown"}
    assert "raw SQL" not in stream.getvalue()
    assert "email@example.test" not in stream.getvalue()


def test_failed_dataset_log_captures_partial_output_before_workspace_cleanup(monkeypatch, tmp_path):
    definition = MATERIALIZATIONS[0]
    stream = io.StringIO()

    def fail_after_partial_output(_connection, root, *_args):
        root.mkdir(parents=True)
        (root / definition.output_filename).write_bytes(b"partial")
        failure = RuntimeError("unlogged raw failure")
        failure.__dict__["materialization_phase"] = "copy_query_to_parquet"
        raise failure

    monkeypatch.setattr(pipeline_module, "select_materializations", lambda _names, **_kwargs: (definition,))
    monkeypatch.setattr(pipeline_module, "attach_postgres", lambda *_args: None)
    monkeypatch.setattr(pipeline_module, "materialize", fail_after_partial_output)

    with pytest.raises(BatchRunError):
        run(
            _settings(tmp_path),
            object(),
            connection_factory=lambda _settings: _Connection(),
            logger=JsonLogger(stream=stream),
            run_id="partial-failure",
        )

    records = [json.loads(line) for line in stream.getvalue().splitlines()]
    failed = next(record for record in records if record["event"] == "analytics.etl.dataset_failed")
    assert failed["context"]["phase"] == "copy_query_to_parquet"
    assert failed["context"]["output_exists"] is True
    assert failed["context"]["output_size_bucket"] == "tiny"


@pytest.mark.parametrize(
    ("failure", "event", "outcome", "committed"),
    (
        (PointerConflictError("pointer conflict"), "analytics.etl.pointer_conflict", "not_committed", False),
        (
            PointerConflictError("candidate became stale after an ambiguous pointer write"),
            "analytics.etl.pointer_commit_ambiguous",
            "ambiguous",
            False,
        ),
        (
            PointerConflictError("candidate was committed and immediately superseded", committed=True),
            "analytics.etl.pointer_commit_superseded",
            "committed_superseded",
            True,
        ),
    ),
)
def test_pointer_conflict_fails_safely_after_release_upload(monkeypatch, tmp_path, failure, event, outcome, committed):
    definitions = MATERIALIZATIONS
    stream = io.StringIO()
    FakePublisher.instances.clear()
    FakePublisher.commit_error = failure
    monkeypatch.setattr(pipeline_module, "GcsPublisher", FakePublisher)
    monkeypatch.setattr(pipeline_module, "select_materializations", lambda _names, **_kwargs: definitions)
    monkeypatch.setattr(pipeline_module, "attach_postgres", lambda *_args: None)
    monkeypatch.setattr(pipeline_module, "materialize", lambda *_args: MaterializationArtifacts(Path("/tmp"), (), 1))
    monkeypatch.setattr(
        pipeline_module,
        "publish",
        lambda _gcs, _run, _artifacts, _source, _published, definition, **_kw: _status(
            definition, "conflict", _kw["source_order"]
        ),
    )
    try:
        with pytest.raises(BatchRunError) as raised:
            run(
                _settings(tmp_path),
                object(),
                connection_factory=lambda _settings: _Connection(),
                logger=JsonLogger(stream=stream),
                run_id="conflict",
            )
        assert raised.value.failures["batch"] is failure
        assert FakePublisher.instances[-1].release_uploaded
        assert FakePublisher.instances[-1].pointer_committed is committed
        records = [json.loads(line) for line in stream.getvalue().splitlines()]
        pointer_record = next(record for record in records if record["event"] == event)
        assert pointer_record["context"]["pointer_outcome"] == outcome
        assert pointer_record["context"]["pointer_committed"] is committed
    finally:
        FakePublisher.commit_error = None


def test_dataset_manifest_publish_times_are_captured_before_release_commit(monkeypatch, tmp_path):
    published_times = []
    read_times = []
    observed_goldens = []
    clock_values = iter(range(10, 31))
    monkeypatch.setattr(pipeline_module, "GcsPublisher", FakePublisher)
    monkeypatch.setattr(pipeline_module, "select_materializations", lambda _names, **_kwargs: MATERIALIZATIONS)
    monkeypatch.setattr(pipeline_module, "attach_postgres", lambda *_args: None)
    monkeypatch.setattr(pipeline_module, "materialize", lambda *_args: MaterializationArtifacts(Path("/tmp"), (), 1))

    def fake_materialize(_connection, _root, definition, refreshed_at, _as_of_date):
        read_times.append((definition.name, refreshed_at))
        return MaterializationArtifacts(Path("/tmp"), (), 1)

    def fake_publish(_gcs, _run, _artifacts, source_read_at, published_at, definition, **_kw):
        published_times.append((definition.name, source_read_at, published_at))
        observed_goldens.append((definition.name, _kw["goldens"], _kw["source_order"]))
        return _status(definition, _run, _kw["source_order"])

    monkeypatch.setattr(pipeline_module, "materialize", fake_materialize)
    monkeypatch.setattr(pipeline_module, "publish", fake_publish)
    statuses = run(
        _settings(tmp_path),
        object(),
        connection_factory=lambda _settings: _Connection(),
        now=lambda: datetime.fromtimestamp(next(clock_values), timezone.utc),
        run_id="publish-times",
    )
    assert [source for _, source, _ in published_times] == [
        f"1970-01-01T00:00:{second:02d}+00:00" for second in (11, 13, 15, 17, 19, 21, 23, 25, 27)
    ]
    assert [published for _, _, published in published_times] == [
        f"1970-01-01T00:00:{second:02d}+00:00" for second in (12, 14, 16, 18, 20, 22, 24, 26, 28)
    ]
    assert all(source == refreshed for (_, source, _), (_, refreshed) in zip(published_times, read_times, strict=True))
    assert all(
        golden["query"] == f"SELECT COUNT(*) AS row_count FROM {name}"
        and golden["canonicalization"] == "rows-json-v1"
        and golden["artifact"] == b'[[{"$bigint":"1"}]]'
        and golden["sha256"] == hashlib.sha256(golden["artifact"]).hexdigest()
        and source_order == "19700101T000010.000000Z"
        for name, goldens, source_order in observed_goldens
        for golden in goldens
    )
    pointers = [status.pointer for status in statuses.values()]
    assert all(pointer is not None for pointer in pointers)
    pointer = pointers[0]
    assert pointer is not None
    assert pointer["releaseId"] == "publish-times"
    assert pointer["manifestUri"].endswith("/release.json")
    assert pointer["manifestGeneration"] == "9"
    assert len(pointer["manifestSha256"]) == 64
    assert pointer["sourceOrder"] == "19700101T000010.000000Z"
    assert pointer["producerRevision"] == "gate2-test-revision"
    assert pointer["createdAtUtc"] == "1970-01-01T00:00:29+00:00"
    release = FakePublisher.uploaded_release
    assert release is not None
    assert release["producerRevision"] == "gate2-test-revision"
    assert all(item == pointer for item in pointers)


@pytest.mark.parametrize("signal", (KeyboardInterrupt, SystemExit))
def test_pipeline_propagates_cancellation_without_later_dataset(monkeypatch, tmp_path, signal):
    first, second = MATERIALIZATIONS[:2]
    attempted = []
    monkeypatch.setattr(pipeline_module, "select_materializations", lambda _names, **_kwargs: (first, second))
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
            connection_factory=lambda _settings: _Connection(),
            run_id="cancel",
        )
    assert attempted == [first.name]
