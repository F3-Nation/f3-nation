from __future__ import annotations

import json
from pathlib import Path

import pytest
from google.api_core.exceptions import NotFound, PreconditionFailed

from analytics.materializations import MATERIALIZATION_REGISTRY
from analytics.publication import CatalogConflictError, GcsPublisher, build_release_manifest, publish
from analytics.settings import Settings
from analytics.source import MaterializationArtifacts


class Stored:
    def __init__(self, value=b"", generation=0):
        self.generation = generation
        self.metageneration = 1
        self.size = len(value)
        self.crc32c = "crc"
        self.content = value
        self.metadata = {}


class Blob:
    objects: dict[str, Stored] = {}
    next_generation = 0
    conflict = False

    def __init__(self, name: str):
        self.name = name

    def reload(self):
        if self.name not in self.objects:
            raise NotFound("missing")

    def __getattr__(self, name):
        if name in {"generation", "metageneration", "size", "crc32c", "content", "metadata"}:
            return getattr(self.objects[self.name], name)
        raise AttributeError(name)

    def __setattr__(self, name, value):
        if name == "metadata" and "name" in self.__dict__ and self.name in self.objects:
            self.__dict__["pending_metadata"] = value
        else:
            object.__setattr__(self, name, value)

    def upload_from_filename(self, filename, **kwargs):
        self._put(Path(filename).read_bytes(), kwargs["if_generation_match"])

    def upload_from_string(self, value, **kwargs):
        self._put(value, kwargs["if_generation_match"])

    def _put(self, value, expected):
        current = self.objects.get(self.name)
        if (current.generation if current else 0) != expected:
            raise PreconditionFailed("generation conflict")
        type(self).next_generation += 1
        stored = Stored(value, type(self).next_generation)
        stored.metadata = self.__dict__.get("pending_metadata", self.__dict__.get("metadata", {}))
        self.objects[self.name] = stored

    def patch(self, **kwargs):
        current = self.objects[self.name]
        if kwargs["if_metageneration_match"] != current.metageneration:
            raise PreconditionFailed("metageneration conflict")
        if self.conflict:
            type(self).conflict = False
            current.metadata = dict(current.metadata)
            current.metadata.update(
                {"competing_winner": "yes", "current_source_order": "s2", "high_water_source_order": "s2"}
            )
            current.metageneration += 1
            raise PreconditionFailed("metageneration conflict")
        current.metadata = self.__dict__.pop("pending_metadata", current.metadata)
        current.metageneration += 1


class Bucket:
    def blob(self, name):
        return Blob(name)


class Storage:
    def bucket(self, _name):
        return Bucket()


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


def artifacts(tmp_path: Path, name: str, content: bytes = b"data") -> MaterializationArtifacts:
    root = tmp_path / name
    root.mkdir()
    path = root / f"{name}.parquet"
    path.write_bytes(content)
    return MaterializationArtifacts(root, (path,), 1)


def test_failed_dataset_has_no_release_or_catalog(tmp_path):
    Blob.objects.clear()
    storage = Storage()
    publisher = GcsPublisher(storage, settings(tmp_path))
    first = MATERIALIZATION_REGISTRY["pv_regions"]
    second = MATERIALIZATION_REGISTRY["pv_pax"]
    status = publish(publisher, "batch-1", artifacts(tmp_path, "regions"), "source", "published", first)
    with pytest.raises(ValueError):
        publish(
            publisher, "batch-1", MaterializationArtifacts(tmp_path / "missing", (), 0), "source", "published", second
        )
    assert "parquets/releases/batch-1/release.json" not in Blob.objects
    assert "parquets/catalog.json" not in Blob.objects
    assert status.manifest_object.uri.endswith("releases/batch-1/pv_regions/manifest.json")


def test_fake_gcs_catalog_create_and_patch_races_are_real_cas_operations():
    Blob.objects.clear()
    Blob.next_generation = 0
    creator_a, creator_b = Blob("parquets/catalog.json"), Blob("parquets/catalog.json")
    with pytest.raises(NotFound):
        creator_a.reload()
    with pytest.raises(NotFound):
        creator_b.reload()
    creator_a.upload_from_string(b"", if_generation_match=0)
    with pytest.raises(PreconditionFailed):
        creator_b.upload_from_string(b"", if_generation_match=0)

    creator_a.reload()
    creator_b.reload()
    creator_a.metadata = {"winner": "old"}
    creator_b.metadata = {"winner": "new"}
    creator_b.patch(if_metageneration_match=1)
    with pytest.raises(PreconditionFailed):
        creator_a.patch(if_metageneration_match=1)
    stored = Blob.objects["parquets/catalog.json"]
    assert stored.metadata == {"winner": "new"}
    assert stored.generation == 1
    assert stored.metageneration == 2


def test_release_manifest_and_catalog_are_committed_once_all_datasets_succeed(tmp_path):
    Blob.objects.clear()
    publisher = GcsPublisher(Storage(), settings(tmp_path))
    statuses = {
        item.name: publish(publisher, "batch-2", artifacts(tmp_path, item.name), "s", "p", item)
        for item in MATERIALIZATION_REGISTRY.values()
    }
    release = publisher.upload_release_manifest("batch-2", build_release_manifest("batch-2", statuses, "p", "s"))
    catalog = publisher.commit_catalog("batch-2", release, "s")
    assert release.uri.endswith("releases/batch-2/release.json")
    assert set(json.loads(Blob.objects["parquets/releases/batch-2/release.json"].content)["datasets"]) == set(
        MATERIALIZATION_REGISTRY
    )
    assert catalog.metadata["current_release"] == "batch-2"
    assert catalog.metadata["catalog_schema_version"] == "analytics.catalog.v1"
    assert catalog.metadata["current_release_manifest_uri"] == release.uri
    assert catalog.metadata["current_release_manifest_generation"] == release.generation
    assert catalog.generation == Blob.objects["parquets/catalog.json"].generation
    assert catalog.metageneration == 1
    assert catalog.metadata["current_source_order"] == "s"
    assert statuses["pv_regions"].manifest["run_prefix"].endswith("/batch-2/pv_regions")
    assert "parquets/current.json" not in Blob.objects


def test_release_rejects_missing_extra_and_mismatched_statuses(tmp_path):
    Blob.objects.clear()
    publisher = GcsPublisher(Storage(), settings(tmp_path))
    statuses = {
        item.name: publish(publisher, "batch-contract", artifacts(tmp_path, item.name), "s", "p", item)
        for item in MATERIALIZATION_REGISTRY.values()
    }
    with pytest.raises(ValueError, match="exact approved"):
        build_release_manifest(
            "batch-contract", {name: status for name, status in statuses.items() if name != "pv_pax"}, "p"
        )
    with pytest.raises(ValueError, match="exact approved"):
        build_release_manifest("batch-contract", {**statuses, "unexpected": next(iter(statuses.values()))}, "p")
    wrong_run = dict(statuses)
    wrong_run["pv_pax"] = type(statuses["pv_pax"])(
        {**statuses["pv_pax"].manifest, "run_id": "other-run"},
        statuses["pv_pax"].parquet_files,
        statuses["pv_pax"].manifest_object,
    )
    with pytest.raises(ValueError, match="mismatched"):
        build_release_manifest("batch-contract", wrong_run, "p")


def test_catalog_advance_is_metadata_cas_and_conflict_is_safe(tmp_path):
    Blob.objects.clear()
    publisher = GcsPublisher(Storage(), settings(tmp_path))
    statuses = {
        item.name: publish(publisher, "batch-3", artifacts(tmp_path, item.name), "s", "p", item)
        for item in MATERIALIZATION_REGISTRY.values()
    }
    release = publisher.upload_release_manifest("batch-3", build_release_manifest("batch-3", statuses, "p", "s"))
    publisher.commit_catalog("batch-3", release, "s")
    Blob.conflict = True
    statuses2 = {
        item.name: publish(publisher, "batch-4", artifacts(tmp_path, f"{item.name}2"), "s", "p", item)
        for item in MATERIALIZATION_REGISTRY.values()
    }
    release2 = publisher.upload_release_manifest("batch-4", build_release_manifest("batch-4", statuses2, "p", "t"))
    publisher.commit_catalog("batch-4", release2, "t")
    assert Blob.objects["parquets/catalog.json"].metadata["current_release"] == "batch-4"
    assert Blob.objects["parquets/catalog.json"].metageneration == 3
    catalog = publisher.rollback_catalog(
        "3", release_manifest_uri=release.uri, release_manifest_generation=release.generation, release_id="batch-3"
    )
    assert catalog.metadata["current_release"] == "batch-3"
    assert catalog.metadata["current_release_manifest_generation"] == release.generation
    assert catalog.metadata["previous_source_order"] == "t"
    assert catalog.metadata["high_water_source_order"] == "t"
    assert catalog.generation == Blob.objects["parquets/catalog.json"].generation
    assert catalog.metageneration == 4
    with pytest.raises(CatalogConflictError):
        publisher.commit_catalog("batch-3", release, "s")
