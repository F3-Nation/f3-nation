from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, ClassVar

import pytest
from google.api_core.exceptions import PreconditionFailed

from analytics.materializations import MATERIALIZATION_REGISTRY
from analytics.publication import GcsPublisher, ObjectMetadata, PointerConflictError, publish
from analytics.settings import Settings
from analytics.source import MaterializationArtifacts


def settings(tmp_path: Path) -> Settings:
    extension_dir = tmp_path / "extensions"
    extension_dir.mkdir()
    extension = extension_dir / "postgres_scanner.duckdb_extension"
    extension.touch()
    return Settings.from_env(
        {
            "ANALYTICS_ENVIRONMENT": "test",
            "DUCKDB_EXTENSION_DIR": str(extension_dir),
            "DUCKDB_POSTGRES_EXTENSION_PATH": str(extension),
            "ANALYTICS_POSTGRES_SOCKET_DIR": "/cloudsql/f3data:us-central1:f3data-nonprod",
            "ANALYTICS_POSTGRES_USER": "user",
            "ANALYTICS_POSTGRES_PASSWORD": "password",
            "ANALYTICS_POSTGRES_DATABASE": "f3_staging",
        }
    )


class Blob:
    generation_counter = 0
    objects = {}
    after_reload: ClassVar[Callable[[Any], None] | None] = None

    def __init__(self, name):
        self.name = name

    def upload_from_filename(self, filename, **kwargs):
        self._store(Path(filename).read_bytes(), kwargs["if_generation_match"])

    def upload_from_string(self, value, **kwargs):
        self._store(value, kwargs["if_generation_match"])

    def _store(self, value, expected):
        current = Blob.objects.get(self.name)
        actual = 0 if current is None else current.generation
        if actual != expected:
            raise PreconditionFailed("generation conflict")
        Blob.generation_counter += 1
        self.generation, self.size, self.crc32c, self.content = Blob.generation_counter, len(value), "crc", value
        Blob.objects[self.name] = self

    def reload(self):
        current = Blob.objects.get(self.name)
        if current is None:
            from google.api_core.exceptions import NotFound

            raise NotFound("missing")
        self.__dict__.update(current.__dict__)
        hook = Blob.after_reload
        Blob.after_reload = None
        if hook is not None:
            hook(self)


class Bucket:
    def blob(self, name):
        return Blob(name)


class Storage:
    def bucket(self, name):
        return Bucket()


def test_publication_durably_writes_manifest_before_pointer(tmp_path):
    Blob.objects.clear()
    Blob.after_reload = None
    definition = MATERIALIZATION_REGISTRY["pv_regions"]
    publisher = GcsPublisher(Storage(), settings(tmp_path), definition)
    root = tmp_path / "root"
    root.mkdir()
    parquet = root / "regions.parquet"
    parquet.write_bytes(b"parquet")
    status = publish(
        publisher, "run-1", MaterializationArtifacts(root, (parquet,), 2), "source", "published", definition
    )
    assert status.manifest_object.uri.endswith("run-1/manifest.json")
    assert status.pointer.uri.endswith("current.json")
    stored = json.loads(Blob.objects["parquets/pv_regions/run-1/manifest.json"].content)
    assert stored["row_count"] == 2
    pointer = json.loads(Blob.objects["parquets/pv_regions/current.json"].content)
    assert pointer["manifest_uri"] == status.manifest_object.uri


def test_publication_emits_only_gcs_phase_events(tmp_path):
    Blob.objects.clear()
    Blob.after_reload = None
    events = []
    definition = MATERIALIZATION_REGISTRY["pv_regions"]
    root = tmp_path / "root"
    root.mkdir()
    parquet = root / "regions.parquet"
    parquet.write_bytes(b"parquet")
    publish(
        GcsPublisher(Storage(), settings(tmp_path), definition),
        "run-events",
        MaterializationArtifacts(root, (parquet,), 4),
        "source",
        "published",
        definition,
        emit=lambda event, context: events.append((event, context)),
    )
    assert [event for event, _ in events] == ["analytics.etl.gcs_committed", "analytics.etl.pointer_advanced"]


def test_pointer_conflict_leaves_durable_manifest_and_is_observable(tmp_path):
    Blob.objects.clear()
    Blob.after_reload = None
    definition = MATERIALIZATION_REGISTRY["pv_regions"]
    publisher = GcsPublisher(Storage(), settings(tmp_path), definition)
    root = tmp_path / "root"
    root.mkdir()
    parquet = root / "regions.parquet"
    parquet.write_bytes(b"parquet")
    publisher.advance_current = lambda *args, **kwargs: (_ for _ in ()).throw(PreconditionFailed("conflict"))
    with pytest.raises(PointerConflictError) as raised:
        publish(publisher, "run-3", MaterializationArtifacts(root, (parquet,), 1), "source", "published", definition)
    assert raised.value.metadata["stage"] == "pointer_update"
    assert raised.value.metadata["manifest_uri"].endswith("run-3/manifest.json")
    assert "parquets/pv_regions/run-3/manifest.json" in Blob.objects
    assert "parquets/pv_regions/current.json" not in Blob.objects


def test_pointer_race_reports_the_winning_generation(tmp_path):
    Blob.objects.clear()
    Blob.after_reload = None
    definition = MATERIALIZATION_REGISTRY["pv_regions"]
    publisher = GcsPublisher(Storage(), settings(tmp_path), definition)
    first_manifest = ObjectMetadata("gs://bucket/manifest-1", "manifest-1", 1, "crc")
    second_manifest = ObjectMetadata("gs://bucket/manifest-2", "manifest-2", 1, "crc")
    publisher.advance_current(first_manifest, None)
    captured_generation = publisher.current_generation()
    publisher.advance_current(second_manifest, captured_generation)
    winning_generation = publisher.current_generation()

    root = tmp_path / "root"
    root.mkdir()
    parquet = root / "regions.parquet"
    parquet.write_bytes(b"parquet")

    def advance_after_read(blob):
        if blob.name != "parquets/pv_regions/current.json":
            Blob.after_reload = advance_after_read
            return
        publisher.advance_current(second_manifest, str(blob.generation))

    Blob.after_reload = advance_after_read
    with pytest.raises(PointerConflictError) as raised:
        publish(publisher, "run-race", MaterializationArtifacts(root, (parquet,), 1), "source", "published", definition)

    assert raised.value.metadata["stage"] == "pointer_update"
    assert raised.value.metadata["expected_pointer_generation"] == winning_generation
    assert raised.value.metadata["current_pointer_generation"] != winning_generation
    current_pointer = Blob.objects["parquets/pv_regions/current.json"]
    assert raised.value.metadata["current_pointer_generation"] == str(current_pointer.generation)


def test_publication_uploads_sorted_nested_artifacts_and_exact_manifest(tmp_path):
    Blob.objects.clear()
    definition = MATERIALIZATION_REGISTRY["pv_events"]
    root = tmp_path / "events"
    (root / "region_org_id=2").mkdir(parents=True)
    (root / "region_org_id=1").mkdir()
    first = root / "region_org_id=2" / "data_1.parquet"
    second = root / "region_org_id=1" / "data_0.parquet"
    first.write_bytes(b"one")
    second.write_bytes(b"two!!")
    artifacts = MaterializationArtifacts(root, (first, second), 7)

    status = publish(
        GcsPublisher(Storage(), settings(tmp_path), definition), "multi", artifacts, "source", "published", definition
    )

    assert [item.uri for item in status.parquet_files] == [
        "gs://f3-analytics-nonprod/parquets/pv_events/multi/region_org_id=1/data_0.parquet",
        "gs://f3-analytics-nonprod/parquets/pv_events/multi/region_org_id=2/data_1.parquet",
    ]
    assert status.manifest["run_prefix"] == "gs://f3-analytics-nonprod/parquets/pv_events/multi"
    assert status.manifest["dataset"] == "pv_events"
    assert status.manifest["file_count"] == 2
    assert status.manifest["byte_count"] == 8
    assert [item["uri"] for item in status.manifest["objects"]] == [item.uri for item in status.parquet_files]
