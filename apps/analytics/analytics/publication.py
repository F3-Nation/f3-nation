"""Dependency-injected GCS publication boundaries."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

from google.api_core.exceptions import NotFound, PreconditionFailed

from .materializations import MATERIALIZATIONS_BY_NAME, Materialization
from .settings import Settings
from .source import MaterializationArtifacts


@dataclass(frozen=True, slots=True)
class ObjectMetadata:
    uri: str
    generation: str
    size: int
    crc32c: str


@dataclass(frozen=True, slots=True)
class PublicationStatus:
    manifest: dict[str, Any]
    parquet_files: tuple[ObjectMetadata, ...]
    manifest_object: ObjectMetadata
    pointer: ObjectMetadata
    expected_pointer_generation: str | None


def _prefix_parts(prefix: str) -> tuple[str, str]:
    parsed = urlparse(prefix)
    return parsed.netloc, parsed.path.lstrip("/")


def _metadata(blob: Any, bucket: str, name: str) -> ObjectMetadata:
    blob.reload()
    checksum = getattr(blob, "crc32c", None)
    if not checksum:
        raise ValueError("GCS object did not return a CRC32C checksum")
    return ObjectMetadata(
        uri=f"gs://{bucket}/{name}",
        generation=str(blob.generation),
        size=int(blob.size),
        crc32c=checksum,
    )


class GcsPublisher:
    def __init__(self, client: Any, settings: Settings, materialization: Materialization) -> None:
        self.client = client
        self.materialization = materialization
        self.bucket_name, self.prefix = _prefix_parts(settings.target(materialization)[0])
        self.bucket = client.bucket(self.bucket_name)

    def _name(self, run_id: str, filename: str) -> str:
        return f"{self.prefix}/{run_id}/{filename}"

    def run_prefix(self, run_id: str) -> str:
        return f"gs://{self.bucket_name}/{self.prefix}/{run_id}"

    def upload_parquet(self, run_id: str, path: Path) -> ObjectMetadata:
        name = self._name(run_id, path.name)
        blob = self.bucket.blob(name)
        blob.upload_from_filename(str(path), if_generation_match=0, checksum="crc32c")
        return _metadata(blob, self.bucket_name, name)

    def upload_parquet_files(self, run_id: str, artifacts: MaterializationArtifacts) -> tuple[ObjectMetadata, ...]:
        root = artifacts.root.resolve()
        if not root.is_dir():
            raise ValueError("artifact root must be a directory")
        relative_paths = []
        for path in artifacts.sorted_parquet_files:
            resolved = path.resolve()
            try:
                relative = resolved.relative_to(root)
            except ValueError as error:
                raise ValueError("artifact is outside its root") from error
            if path.is_symlink() or not resolved.is_file():
                raise ValueError("artifact must be a regular file")
            relative_paths.append(relative.as_posix())
        if len(set(relative_paths)) != len(relative_paths):
            raise ValueError("artifact paths must be unique")
        ordered = sorted(zip(relative_paths, artifacts.sorted_parquet_files, strict=True))
        return tuple(self._upload_relative(run_id, path, relative_path) for relative_path, path in ordered)

    def _upload_relative(self, run_id: str, path: Path, relative_path: str) -> ObjectMetadata:
        name = self._name(run_id, relative_path)
        blob = self.bucket.blob(name)
        blob.upload_from_filename(str(path), if_generation_match=0, checksum="crc32c")
        return _metadata(blob, self.bucket_name, name)

    def upload_manifest(self, run_id: str, manifest: dict[str, Any]) -> ObjectMetadata:
        name = self._name(run_id, "manifest.json")
        blob = self.bucket.blob(name)
        payload = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
        blob.upload_from_string(payload, content_type="application/json", if_generation_match=0, checksum="crc32c")
        return _metadata(blob, self.bucket_name, name)

    def current_generation(self) -> str | None:
        name = f"{self.prefix}/current.json"
        blob = self.bucket.blob(name)
        try:
            blob.reload()
        except NotFound:
            return None
        return str(blob.generation)

    def advance_current(self, manifest: ObjectMetadata, expected_generation: str | None) -> ObjectMetadata:
        name = f"{self.prefix}/current.json"
        blob = self.bucket.blob(name)
        payload = json.dumps(
            {"manifest_generation": manifest.generation, "manifest_uri": manifest.uri},
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        expected = 0 if expected_generation is None else int(expected_generation)
        blob.upload_from_string(
            payload,
            content_type="application/json",
            if_generation_match=expected,
            checksum="crc32c",
        )
        return _metadata(blob, self.bucket_name, name)


def build_manifest(
    run_id: str,
    parquet_files: tuple[ObjectMetadata, ...],
    committed_run_prefix: str,
    row_count: int,
    source_read_at: str,
    published_at: str,
    materialization: Materialization,
) -> dict[str, Any]:
    if MATERIALIZATIONS_BY_NAME.get(materialization.name) is not materialization:
        raise ValueError("materialization is not in the approved registry")
    if not parquet_files:
        raise ValueError("publication requires parquet files")
    objects = [
        {"uri": item.uri, "generation": item.generation, "size": item.size, "crc32c": item.crc32c}
        for item in parquet_files
    ]
    return {
        "schema_version": materialization.schema_version,
        "run_id": run_id,
        "dataset": materialization.name,
        "run_prefix": committed_run_prefix,
        "committed_run_prefix": committed_run_prefix,
        "file_count": len(objects),
        "byte_count": sum(item["size"] for item in objects),
        "objects": objects,
        "row_count": row_count,
        "source_read_timestamp": source_read_at,
        "publication_timestamp": published_at,
    }


class PointerConflictError(RuntimeError):
    """The current pointer changed before this run could commit."""

    def __init__(self, metadata: dict[str, Any]) -> None:
        super().__init__("current pointer conditional update failed; rerun the complete ETL")
        self.metadata = metadata


def publish(
    gcs: GcsPublisher,
    run_id: str,
    artifacts: MaterializationArtifacts,
    source_read_at: str,
    published_at: str,
    materialization: Materialization,
    emit: Callable[[str, dict[str, Any]], None] | None = None,
) -> PublicationStatus:
    started = time.perf_counter()
    if (
        MATERIALIZATIONS_BY_NAME.get(materialization.name) is not materialization
        or gcs.materialization is not materialization
    ):
        raise ValueError("publication components use different materialization definitions")
    definition = materialization
    parquet_files = gcs.upload_parquet_files(run_id, artifacts)
    manifest = build_manifest(
        run_id,
        parquet_files,
        gcs.run_prefix(run_id),
        artifacts.row_count,
        source_read_at,
        published_at,
        definition,
    )
    manifest_object = gcs.upload_manifest(run_id, manifest)
    if emit is not None:
        emit(
            "analytics.etl.gcs_committed",
            {
                "run_id": run_id,
                "materialization": definition.name,
                "file_count": manifest["file_count"],
                "byte_count": manifest["byte_count"],
                "duration_ms": round((time.perf_counter() - started) * 1000, 3),
            },
        )
    expected_generation = gcs.current_generation()
    try:
        pointer = gcs.advance_current(manifest_object, expected_generation)
        if emit is not None:
            emit(
                "analytics.etl.pointer_advanced",
                {
                    "run_id": run_id,
                    "materialization": definition.name,
                    "pointer_generation": pointer.generation,
                    "expected_pointer_generation": expected_generation,
                },
            )
    except (NotFound, PreconditionFailed) as error:
        current_generation = gcs.current_generation()
        raise PointerConflictError(
            {
                "stage": "pointer_update",
                "materialization": definition.name,
                "run_id": run_id,
                "parquet_uris": [item.uri for item in parquet_files],
                "parquet_generations": [item.generation for item in parquet_files],
                "manifest_uri": manifest_object.uri,
                "manifest_generation": manifest_object.generation,
                "expected_pointer_generation": expected_generation,
                "current_pointer_generation": current_generation,
            }
        ) from error
    return PublicationStatus(
        manifest=manifest,
        parquet_files=parquet_files,
        manifest_object=manifest_object,
        pointer=pointer,
        expected_pointer_generation=expected_generation,
    )
