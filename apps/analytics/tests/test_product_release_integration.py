from __future__ import annotations

import base64
import hashlib
import io
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import duckdb
import google_crc32c
from google.api_core.exceptions import NotFound, PreconditionFailed

from analytics import pipeline, source
from analytics.materializations import MATERIALIZATIONS_BY_PRODUCT
from analytics.schema_registry import SCHEMAS_BY_NAME
from analytics.settings import Settings


class _Object:
    def __init__(self, content: bytes, generation: int) -> None:
        self.content = content
        self.generation = generation
        self.size = len(content)
        checksum = google_crc32c.Checksum()
        checksum.update(content)
        self.crc32c = base64.b64encode(checksum.digest()).decode("ascii")


class _Blob:
    def __init__(self, storage: _Storage, name: str) -> None:
        self.storage = storage
        self.name = name
        self.uploaded_generation: int | None = None

    def reload(self) -> None:
        if self.name not in self.storage.objects:
            raise NotFound("object not found")

    def __getattr__(self, name: str) -> Any:
        if name == "generation" and self.uploaded_generation is not None:
            return self.uploaded_generation
        return getattr(self.storage.objects[self.name], name)

    def upload_from_filename(self, filename: str, *, if_generation_match: int, **_kwargs: Any) -> None:
        self._upload(Path(filename).read_bytes(), if_generation_match)

    def upload_from_string(self, content: bytes, *, if_generation_match: int, **_kwargs: Any) -> None:
        self._upload(content, if_generation_match)

    def _upload(self, content: bytes, expected_generation: int) -> None:
        current = self.storage.objects.get(self.name)
        if (current.generation if current is not None else 0) != expected_generation:
            raise PreconditionFailed("generation precondition failed")
        self.storage.next_generation += 1
        self.uploaded_generation = self.storage.next_generation
        self.storage.objects[self.name] = _Object(content, self.uploaded_generation)

    def open(self, mode: str, *, if_generation_match: int) -> io.BytesIO:
        assert mode == "rb"
        stored = self.storage.objects[self.name]
        if stored.generation != if_generation_match:
            raise PreconditionFailed("pinned generation mismatch")
        return io.BytesIO(stored.content)

    def download_to_filename(self, filename: str, *, if_generation_match: int, **_kwargs: Any) -> None:
        Path(filename).write_bytes(self.open("rb", if_generation_match=if_generation_match).read())


class _Bucket:
    def __init__(self, storage: _Storage) -> None:
        self.storage = storage

    def blob(self, name: str) -> _Blob:
        return _Blob(self.storage, name)


class _Storage:
    """Small generation-faithful fake: create-only uploads and pinned reads."""

    def __init__(self) -> None:
        self.objects: dict[str, _Object] = {}
        self.next_generation = 0

    def bucket(self, _name: str) -> _Bucket:
        return _Bucket(self)


class _QuietLogger:
    def info(self, *_args: Any, **_kwargs: Any) -> None:
        pass

    def error(self, *_args: Any, **_kwargs: Any) -> None:
        pass


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        environment="test",
        extension_directory=tmp_path,
        postgres_extension_path=tmp_path / "unused-extension",
        postgres_socket_dir=None,
        postgres_host=None,
        postgres_port=None,
        postgres_user="synthetic",
        postgres_password="synthetic",
        postgres_database="f3_staging",
        producer_revision="pipeline-integration",
    )


def _synthetic_query(dataset: str) -> str:
    schema = SCHEMAS_BY_NAME[dataset]
    projection = ", ".join(
        f'CAST(NULL AS {column.duckdb_type}) AS "{column.name.replace(chr(34), chr(34) * 2)}"'
        for column in schema.columns
    )
    # These are the actual refreshed_at/as_of_date parameter positions used by
    # source.materialize; filtering on them retains exactly one synthetic row.
    return f"SELECT {projection} WHERE ? IS NOT NULL AND ? IS NOT NULL"


def _clock():
    instant = datetime(2026, 9, 23, 12, 0, tzinfo=timezone.utc)
    counter = 0

    def now() -> datetime:
        nonlocal counter
        value = instant + timedelta(seconds=counter)
        counter += 1
        return value

    return now


def test_synthetic_duckdb_materialization_publishes_complete_product_releases(monkeypatch, tmp_path):
    monkeypatch.setattr(source, "load_sql", lambda definition: _synthetic_query(definition.name))
    monkeypatch.setattr(pipeline, "attach_postgres", lambda *_args, **_kwargs: None)
    storage = _Storage()
    statuses_by_product = {}
    for product in ("pax-vault", "analytics"):
        statuses_by_product[product] = pipeline.run(
            _settings(tmp_path),
            storage,
            connection_factory=lambda _settings: duckdb.connect(":memory:"),
            logger=_QuietLogger(),
            now=_clock(),
            run_id=f"{product}-synthetic",
            product=product,
        )

    assert {name for name in storage.objects if name.endswith("/current.json")} == {
        "pax-vault/current.json",
        "analytics/current.json",
    }
    for product, statuses in statuses_by_product.items():
        expected_names = {definition.name for definition in MATERIALIZATIONS_BY_PRODUCT[product]}
        assert set(statuses) == expected_names
        pointer_name = f"{product}/current.json"
        pointer = json.loads(storage.objects[pointer_name].content)
        assert pointer["releaseId"] == f"{product}-synthetic"
        assert pointer["prefix"].startswith(f"gs://f3-analytics-nonprod/{product}/releases/")
        assert pointer["releaseSequence"] == 1
        confirmed_pointer = next(iter(statuses.values())).pointer
        assert confirmed_pointer is not None
        assert confirmed_pointer["publicationOutcome"] == "committed"
        assert confirmed_pointer["pointerGeneration"] == str(storage.objects[pointer_name].generation)

        release_path = f"{product}/releases/{product}-synthetic/release.json"
        release_object = storage.objects[release_path]
        release = json.loads(release_object.content)
        assert release["contractVersion"] == ("pv-release.v2" if product == "pax-vault" else "analytics-release.v1")
        assert release["sourceReadPolicy"] == "ordered-sequential-per-dataset"
        assert set(release["datasets"]) == expected_names
        assert hashlib.sha256(release_object.content).hexdigest() == pointer["manifestSha256"]

        for name in expected_names:
            status = statuses[name]
            dataset_manifest = status.manifest
            assert dataset_manifest["contractVersion"] == release["contractVersion"]
            assert dataset_manifest["schemaVersion"] == SCHEMAS_BY_NAME[name].schema_version
            assert dataset_manifest["rowCount"] == 1
            assert dataset_manifest["sourceReadPolicy"] == release["sourceReadPolicy"]
            assert dataset_manifest["sourceOrder"] == release["sourceOrder"]
            entry = release["datasets"][name]
            assert entry["manifestUri"] == status.manifest_object.uri
            assert entry["manifestGeneration"] == status.manifest_object.generation
            golden = dataset_manifest["goldens"][0]
            assert golden["query"] == f"SELECT COUNT(*) AS row_count FROM {name}"
            assert golden["canonicalization"] == "rows-json-v1"
            golden_object_name = golden["uri"].removeprefix("gs://f3-analytics-nonprod/")
            golden_bytes = storage.objects[golden_object_name].content
            assert golden_bytes == b'[[{"$bigint":"1"}]]'
            assert hashlib.sha256(golden_bytes).hexdigest() == golden["sha256"]

    # This test exercises synthetic SQL only. It does not claim source-query or
    # real-GCS compatibility; those remain separate integration gates.
