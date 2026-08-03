"""Dependency-injected GCS and BigQuery publication boundaries."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

from google.api_core.exceptions import NotFound, PreconditionFailed

from .settings import Settings


@dataclass(frozen=True, slots=True)
class ObjectMetadata:
    uri: str
    generation: str
    size: int
    crc32c: str


@dataclass(frozen=True, slots=True)
class PublicationStatus:
    manifest: dict[str, Any]
    parquet: ObjectMetadata
    manifest_object: ObjectMetadata
    pointer: ObjectMetadata
    expected_pointer_generation: str | None
    bigquery_job_id: str | None


def _prefix_parts(prefix: str) -> tuple[str, str]:
    parsed = urlparse(prefix)
    return parsed.netloc, parsed.path.lstrip("/")


def _sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


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
    def __init__(self, client: Any, settings: Settings) -> None:
        self.client = client
        self.bucket_name, self.prefix = _prefix_parts(settings.gcs_prefix)
        self.bucket = client.bucket(self.bucket_name)

    def _name(self, run_id: str, filename: str) -> str:
        return f"{self.prefix}/{run_id}/{filename}"

    def upload_parquet(self, run_id: str, path: Path) -> ObjectMetadata:
        name = self._name(run_id, "regions.parquet")
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


class BigQueryPublisher:
    def __init__(self, client: Any, settings: Settings) -> None:
        self.client = client
        self.table = settings.bigquery_table

    def update_external_table(self, parquet_uri: str) -> str | None:
        project, dataset, table = self.table.split(".")
        identifier = f"`{project}.{dataset}.{table}`"
        query = (
            f"CREATE OR REPLACE EXTERNAL TABLE {identifier} "
            f"OPTIONS (format = 'PARQUET', uris = [{_sql_literal(parquet_uri)}])"
        )
        job = self.client.query(query)
        job.result()
        return getattr(job, "job_id", None)


def build_manifest(
    run_id: str,
    parquet: ObjectMetadata,
    row_count: int,
    source_read_at: str,
    published_at: str,
) -> dict[str, Any]:
    committed_run_prefix = parquet.uri.rsplit("/", 1)[0]
    return {
        "schema_version": "pv_regions.v1",
        "run_id": run_id,
        "committed_run_prefix": committed_run_prefix,
        "file_count": 1,
        "byte_count": parquet.size,
        "objects": [
            {
                "uri": parquet.uri,
                "generation": parquet.generation,
                "size": parquet.size,
                "crc32c": parquet.crc32c,
            }
        ],
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
    bigquery: BigQueryPublisher,
    run_id: str,
    parquet_path: Path,
    row_count: int,
    source_read_at: str,
    published_at: str,
    emit: Callable[[str, dict[str, Any]], None] | None = None,
) -> PublicationStatus:
    started = time.perf_counter()
    parquet = gcs.upload_parquet(run_id, parquet_path)
    manifest = build_manifest(run_id, parquet, row_count, source_read_at, published_at)
    manifest_object = gcs.upload_manifest(run_id, manifest)
    if emit is not None:
        emit(
            "analytics.etl.gcs_committed",
            {
                "run_id": run_id,
                "file_count": manifest["file_count"],
                "byte_count": manifest["byte_count"],
                "duration_ms": round((time.perf_counter() - started) * 1000, 3),
            },
        )
    expected_generation = gcs.current_generation()
    bigquery_job_id = bigquery.update_external_table(parquet.uri)
    if emit is not None:
        emit(
            "analytics.etl.bigquery_updated",
            {"run_id": run_id, "job_id": bigquery_job_id},
        )
    try:
        pointer = gcs.advance_current(manifest_object, expected_generation)
        if emit is not None:
            emit(
                "analytics.etl.pointer_advanced",
                {
                    "run_id": run_id,
                    "pointer_generation": pointer.generation,
                    "expected_pointer_generation": expected_generation,
                },
            )
    except (NotFound, PreconditionFailed) as error:
        current_generation = gcs.current_generation()
        raise PointerConflictError(
            {
                "stage": "pointer_update",
                "run_id": run_id,
                "parquet_uri": parquet.uri,
                "parquet_generation": parquet.generation,
                "manifest_uri": manifest_object.uri,
                "manifest_generation": manifest_object.generation,
                "expected_pointer_generation": expected_generation,
                "current_pointer_generation": current_generation,
                "bigquery_job_id": bigquery_job_id,
            }
        ) from error
    return PublicationStatus(
        manifest=manifest,
        parquet=parquet,
        manifest_object=manifest_object,
        pointer=pointer,
        expected_pointer_generation=expected_generation,
        bigquery_job_id=bigquery_job_id,
    )
