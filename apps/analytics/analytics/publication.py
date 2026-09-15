"""Append-only, batch publication to GCS.

Dataset objects are written before the commit record, but are not discoverable
as current until the single release manifest and catalog CAS both succeed.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

from google.api_core.exceptions import NotFound, PreconditionFailed
from google.cloud.storage import Client as StorageClient  # type: ignore[import-untyped]

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
    release_object: ObjectMetadata | None = None
    catalog_metageneration: str | None = None


def _prefix_parts(prefix: str) -> tuple[str, str]:
    parsed = urlparse(prefix)
    return parsed.netloc, parsed.path.lstrip("/")


def _metadata(blob: Any, bucket: str, name: str) -> ObjectMetadata:
    blob.reload()
    checksum = getattr(blob, "crc32c", None)
    if not checksum:
        raise ValueError("GCS object did not return a CRC32C checksum")
    return ObjectMetadata(f"gs://{bucket}/{name}", str(blob.generation), int(blob.size), checksum)


class CatalogConflictError(RuntimeError):
    """The fixed catalog changed while this release was committing."""

    def __init__(self, metadata: dict[str, Any]) -> None:
        super().__init__("analytics release catalog conditional update conflicted")
        self.metadata = metadata


# Kept as an import compatibility alias for callers that used the phase-one
# name. There is no per-dataset pointer in the phase-two implementation.
PointerConflictError = CatalogConflictError


class GcsPublisher:
    def __init__(
        self, client: StorageClient, settings: Settings, materialization: Materialization | None = None
    ) -> None:
        self.client = client
        self.bucket_name, dataset_prefix = _prefix_parts(
            settings.target(materialization or MATERIALIZATIONS_BY_NAME["pv_regions"])[0]
        )
        # Existing settings point each dataset at parquets/<dataset>; phase 2
        # deliberately moves the release namespace up to the shared parent.
        self.prefix = dataset_prefix.rsplit("/", 1)[0]
        self.bucket = client.bucket(self.bucket_name)

    @classmethod
    def from_catalog(cls, client: StorageClient, settings: Any) -> "GcsPublisher":
        """Build only the fixed-catalog boundary; no database settings required."""
        publisher = cls.__new__(cls)
        publisher.client = client
        publisher.bucket_name = settings.bucket_name
        publisher.prefix = settings.catalog_object.rsplit("/", 1)[0]
        publisher.bucket = client.bucket(publisher.bucket_name)
        return publisher

    def _name(self, run_id: str, dataset: str, filename: str) -> str:
        return f"{self.prefix}/releases/{run_id}/{dataset}/{filename}"

    def run_prefix(self, run_id: str, dataset: str) -> str:
        return f"gs://{self.bucket_name}/{self.prefix}/releases/{run_id}/{dataset}"

    def upload_parquet_files(
        self, run_id: str, definition: Materialization, artifacts: MaterializationArtifacts
    ) -> tuple[ObjectMetadata, ...]:
        root = artifacts.root.resolve()
        if not root.is_dir():
            raise ValueError("artifact root must be a directory")
        paths: list[tuple[str, Path]] = []
        for path in artifacts.sorted_parquet_files:
            resolved = path.resolve()
            try:
                relative = resolved.relative_to(root)
            except ValueError as error:
                raise ValueError("artifact is outside its root") from error
            if path.is_symlink() or not resolved.is_file():
                raise ValueError("artifact must be a regular file")
            paths.append((relative.as_posix(), path))
        if len({item[0] for item in paths}) != len(paths):
            raise ValueError("artifact paths must be unique")
        result = []
        for relative_name, path in sorted(paths):
            name = self._name(run_id, definition.name, relative_name)
            blob = self.bucket.blob(name)
            blob.upload_from_filename(str(path), if_generation_match=0, checksum="crc32c")
            result.append(_metadata(blob, self.bucket_name, name))
        return tuple(result)

    def upload_dataset_manifest(self, run_id: str, manifest: dict[str, Any]) -> ObjectMetadata:
        name = self._name(run_id, manifest["dataset"], "manifest.json")
        blob = self.bucket.blob(name)
        payload = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
        blob.upload_from_string(payload, content_type="application/json", if_generation_match=0, checksum="crc32c")
        return _metadata(blob, self.bucket_name, name)

    def upload_release_manifest(self, run_id: str, manifest: dict[str, Any]) -> ObjectMetadata:
        name = f"{self.prefix}/releases/{run_id}/release.json"
        blob = self.bucket.blob(name)
        payload = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
        blob.upload_from_string(payload, content_type="application/json", if_generation_match=0, checksum="crc32c")
        return _metadata(blob, self.bucket_name, name)

    def _catalog(self) -> Any:
        return self.bucket.blob(f"{self.prefix}/catalog.json")

    def commit_catalog(
        self, run_id: str, release: ObjectMetadata, source_order: str, previous_release: str | None = None
    ) -> Any:
        blob = self._catalog()
        try:
            blob.reload()
        except NotFound:
            # Create the initial object and complete metadata atomically. Later
            # updates are metadata-only CAS patches.
            blob.metadata = {
                "catalog_schema_version": "analytics.catalog.v1",
                "previous_release": previous_release or "",
                "previous_release_manifest_uri": "",
                "previous_release_manifest_generation": "",
                "previous_source_order": "",
                "current_release": run_id,
                "current_release_manifest_uri": release.uri,
                "current_release_manifest_generation": release.generation,
                "current_source_order": source_order,
                "high_water_source_order": source_order,
            }
            try:
                blob.upload_from_string(b"", content_type="application/json", if_generation_match=0, checksum="crc32c")
                blob.reload()
                return blob
            except PreconditionFailed:
                blob.reload()
        for attempt in range(2):
            old = dict(getattr(blob, "metadata", None) or {})
            high_water = old.get("high_water_source_order") or old.get("current_source_order")
            if high_water and source_order <= high_water:
                raise CatalogConflictError(
                    {
                        "stage": "catalog_monotonicity",
                        "run_id": run_id,
                        "candidate_source_order": source_order,
                        "high_water_source_order": high_water,
                    }
                )
            metadata = dict(old)
            metadata.update(
                {
                    "catalog_schema_version": "analytics.catalog.v1",
                    "previous_release": old.get("current_release") or previous_release or "",
                    "previous_release_manifest_uri": old.get("current_release_manifest_uri", ""),
                    "previous_release_manifest_generation": old.get("current_release_manifest_generation", ""),
                    "previous_source_order": old.get("current_source_order", ""),
                    "current_release": run_id,
                    "current_release_manifest_uri": release.uri,
                    "current_release_manifest_generation": release.generation,
                    "current_source_order": source_order,
                    "high_water_source_order": max(high_water or source_order, source_order),
                }
            )
            expected = int(getattr(blob, "metageneration", 1))
            blob.metadata = metadata
            try:
                blob.patch(if_metageneration_match=expected)
                blob.reload()
                return blob
            except (NotFound, PreconditionFailed) as error:
                try:
                    blob.reload()
                except Exception:
                    raise CatalogConflictError({"stage": "catalog_update", "run_id": run_id}) from error
                # A newer candidate may retry against the winner's actual CAS
                # token. A stale candidate is rejected above on the next pass.
                if attempt == 0:
                    continue
                winner = dict(getattr(blob, "metadata", None) or {})
                raise CatalogConflictError({"stage": "catalog_update", "run_id": run_id, "winner": winner}) from error

    def rollback_catalog(
        self,
        expected_metageneration: str,
        *,
        release_manifest_uri: str,
        release_manifest_generation: str,
        release_id: str | None = None,
    ) -> Any:
        """CAS-select the retained previous release without replacing content.

        This is intentionally a narrow operator API: only the generation-pinned
        previous manifest recorded by the catalog may be selected. The source
        high-water mark is never lowered, so an in-flight older publisher cannot
        undo the rollback; a genuinely newer source order can still advance it.
        """
        blob = self._catalog()
        try:
            blob.reload()
        except NotFound as error:
            raise CatalogConflictError({"stage": "catalog_rollback_missing"}) from error
        metadata = dict(getattr(blob, "metadata", None) or {})
        previous = metadata.get("previous_release")
        previous_uri = metadata.get("previous_release_manifest_uri")
        previous_generation = metadata.get("previous_release_manifest_generation")
        if not previous or not previous_uri or not previous_generation:
            raise ValueError("catalog has no retained previous release")
        if release_id is not None and release_id != previous:
            raise ValueError("rollback release is not the retained previous release")
        if release_manifest_uri != previous_uri or release_manifest_generation != previous_generation:
            raise ValueError("rollback manifest is not the retained generation-pinned previous release")
        old_current = metadata.get("current_release", "")
        old_uri = metadata.get("current_release_manifest_uri", "")
        old_generation = metadata.get("current_release_manifest_generation", "")
        old_order = metadata.get("current_source_order", "")
        metadata.update(
            {
                "previous_release": old_current,
                "previous_release_manifest_uri": old_uri,
                "previous_release_manifest_generation": old_generation,
                "previous_source_order": old_order,
                "current_release": previous,
                "current_release_manifest_uri": previous_uri,
                "current_release_manifest_generation": previous_generation,
                "current_source_order": metadata.get("previous_source_order", ""),
                # Deliberately preserve this operator-independent high-water mark.
                "high_water_source_order": metadata.get("high_water_source_order", ""),
            }
        )
        blob.metadata = metadata
        try:
            blob.patch(if_metageneration_match=int(expected_metageneration))
            blob.reload()
            return blob
        except (NotFound, PreconditionFailed) as error:
            raise CatalogConflictError(
                {"stage": "catalog_rollback", "expected_metageneration": expected_metageneration}
            ) from error


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
    objects = [{"uri": x.uri, "generation": x.generation, "size": x.size, "crc32c": x.crc32c} for x in parquet_files]
    return {
        "schema_version": materialization.schema_version,
        "run_id": run_id,
        "dataset": materialization.name,
        "run_prefix": committed_run_prefix,
        "committed_run_prefix": committed_run_prefix,
        "file_count": len(objects),
        "byte_count": sum(x["size"] for x in objects),
        "objects": objects,
        "row_count": row_count,
        "source_read_timestamp": source_read_at,
        "publication_timestamp": published_at,
    }


def build_release_manifest(
    run_id: str, statuses: dict[str, PublicationStatus], published_at: str, source_order: str | None = None
) -> dict[str, Any]:
    if not statuses:
        raise ValueError("release requires datasets")
    approved = set(MATERIALIZATIONS_BY_NAME)
    if set(statuses) != approved or len(statuses) != len(approved):
        raise ValueError("release requires the exact approved materialization set")
    order = source_order or published_at
    for name, status in statuses.items():
        if status.manifest.get("dataset") != name or status.manifest.get("run_id") != run_id:
            raise ValueError("release contains a mismatched dataset status")
    return {
        "release_id": run_id,
        "schema_version": "analytics.release.v1",
        "publication_timestamp": published_at,
        "source_order": order,
        "datasets": {
            name: {
                "dataset": status.manifest["dataset"],
                "schema_version": status.manifest["schema_version"],
                "manifest_uri": status.manifest_object.uri,
                "manifest_generation": status.manifest_object.generation,
                "file_count": status.manifest["file_count"],
                "byte_count": status.manifest["byte_count"],
            }
            for name, status in sorted(statuses.items())
        },
    }


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
    if MATERIALIZATIONS_BY_NAME.get(materialization.name) is not materialization:
        raise ValueError("publication uses an unapproved materialization")
    files = gcs.upload_parquet_files(run_id, materialization, artifacts)
    manifest = build_manifest(
        run_id,
        files,
        gcs.run_prefix(run_id, materialization.name),
        artifacts.row_count,
        source_read_at,
        published_at,
        materialization,
    )
    manifest_object = gcs.upload_dataset_manifest(run_id, manifest)
    if emit:
        emit(
            "analytics.etl.dataset_uploaded",
            {
                "run_id": run_id,
                "materialization": materialization.name,
                "file_count": len(files),
                "duration_ms": round((time.perf_counter() - started) * 1000, 3),
            },
        )
    return PublicationStatus(manifest, files, manifest_object)
