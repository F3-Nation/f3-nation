"""Immutable product releases and a generation-CAS current pointer."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import re
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

import duckdb
import google_crc32c
from google.api_core.exceptions import NotFound, PreconditionFailed
from google.cloud.storage import Client as StorageClient  # type: ignore[import-untyped]

from .materializations import (
    MATERIALIZATIONS_BY_NAME,
    MATERIALIZATIONS_BY_PRODUCT,
    PRODUCT_NAMES,
    Materialization,
)
from .schema_registry import SCHEMAS_BY_NAME, manifest_columns, schema_fingerprint
from .settings import Settings
from .source import MaterializationArtifacts, validate_artifacts

_SAFE_COMPONENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_POLICY = "ordered-sequential-per-dataset"
_MAX_OBJECT_BYTES = 2 * 1024 * 1024 * 1024
_MAX_RELEASE_BYTES = 10 * 1024 * 1024 * 1024
_MAX_JSON_BYTES = 16 * 1024 * 1024
_CHUNK_SIZE = 1024 * 1024


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
    pointer: dict[str, Any] | None = None


class PointerConflictError(RuntimeError):
    """Pointer compare-and-swap lost a race or candidate ordering is stale."""

    def __init__(
        self,
        message: str,
        *,
        committed: bool = False,
        outcome: str = "conflict",
        pointer_generation: str | None = None,
    ) -> None:
        super().__init__(message)
        self.committed = committed
        self.outcome = outcome
        self.pointer_generation = pointer_generation


CatalogConflictError = PointerConflictError


def _safe(value: str, label: str) -> str:
    if not isinstance(value, str) or not _SAFE_COMPONENT.fullmatch(value) or value in {".", ".."}:
        raise ValueError(f"unsafe {label}")
    return value


def canonical_json_bytes(value: Any) -> bytes:
    """Serialize one value to deterministic canonical UTF-8 JSON bytes."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


_canonical = canonical_json_bytes


def _metadata(blob: Any, bucket: str, name: str) -> ObjectMetadata:
    blob.reload()
    checksum = getattr(blob, "crc32c", None)
    if not checksum:
        raise ValueError("GCS object did not return a CRC32C checksum")
    generation = str(blob.generation)
    size = int(blob.size)
    _positive_generation(generation, "uploaded object")
    if size < 0:
        raise ValueError("uploaded object has invalid size")
    return ObjectMetadata(f"gs://{bucket}/{name}", generation, size, str(checksum))


def _positive_generation(generation: Any, label: str) -> int:
    if not str(generation).isdigit() or int(generation) <= 0:
        raise ValueError(f"{label} generation must be a positive integer")
    return int(generation)


def _utc_timestamp(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be a UTC timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"{label} must be a UTC timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        raise ValueError(f"{label} must be a UTC timestamp")
    return value


def _download(blob: Any, generation: str, maximum: int = _MAX_JSON_BYTES) -> bytes:
    expected = _positive_generation(generation, "object")
    blob.reload()
    if int(blob.generation) != expected:
        raise ValueError("object generation changed before download")
    declared_size = int(blob.size)
    if declared_size < 0 or declared_size > maximum:
        raise ValueError("object exceeds configured download byte budget")
    output = io.BytesIO()
    checksum = google_crc32c.Checksum()
    total = 0
    with blob.open("rb", if_generation_match=expected) as source:
        while True:
            chunk = source.read(_CHUNK_SIZE)
            if not chunk:
                break
            total += len(chunk)
            if total > maximum or total > declared_size:
                raise ValueError("object download exceeded its declared byte budget")
            output.write(chunk)
            checksum.update(chunk)
    if total != declared_size or base64.b64encode(checksum.digest()).decode("ascii") != blob.crc32c:
        raise ValueError("object download size or CRC32C verification failed")
    return output.getvalue()


def _crc32c_file(path: Path) -> str:
    checksum = google_crc32c.Checksum()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(_CHUNK_SIZE), b""):
            checksum.update(chunk)
    return base64.b64encode(checksum.digest()).decode("ascii")


def _crc32c_bytes(value: bytes) -> str:
    checksum = google_crc32c.Checksum()
    checksum.update(value)
    return base64.b64encode(checksum.digest()).decode("ascii")


def _download_file(blob: Any, generation: str, destination: Path, expected_size: int | None = None) -> int:
    expected = _positive_generation(generation, "object")
    blob.reload()
    if int(blob.generation) != expected:
        raise ValueError("object generation changed before download")
    declared_size = int(blob.size)
    if declared_size < 0 or declared_size > _MAX_OBJECT_BYTES:
        raise ValueError("object exceeds configured per-object byte budget")
    if expected_size is not None and declared_size != expected_size:
        raise ValueError("object metadata size does not match manifest")
    checksum = google_crc32c.Checksum()
    total = 0
    with blob.open("rb", if_generation_match=expected) as source, destination.open("wb") as output:
        while True:
            chunk = source.read(_CHUNK_SIZE)
            if not chunk:
                break
            total += len(chunk)
            if (
                total > _MAX_OBJECT_BYTES
                or total > declared_size
                or (expected_size is not None and total > expected_size)
            ):
                raise ValueError("object download exceeded its declared byte budget")
            output.write(chunk)
            checksum.update(chunk)
    actual_crc32c = base64.b64encode(checksum.digest()).decode("ascii")
    if total != declared_size or actual_crc32c != blob.crc32c:
        raise ValueError("object download size or CRC32C verification failed")
    return total


class GcsPublisher:
    def __init__(self, client: StorageClient, settings: Settings, product: str = "pax-vault") -> None:
        if product not in PRODUCT_NAMES:
            raise ValueError("unknown publication product")
        definitions = MATERIALIZATIONS_BY_PRODUCT[product]
        bucket_uri, _ = settings.target(definitions[0])
        parsed = urlparse(bucket_uri)
        if parsed.scheme != "gs" or not parsed.netloc:
            raise ValueError("registered product target must be a gs:// URI")
        self.client = client
        self.bucket_name = parsed.netloc
        self.product = product
        # The root is an explicit product identity, never inferred from a dataset path.
        self.prefix = product
        self.bucket = client.bucket(self.bucket_name)

    def _name(self, run_id: str, dataset: str, relative: str) -> str:
        _safe(run_id, "release ID")
        _safe(dataset, "dataset")
        path = Path(relative)
        if path.is_absolute() or not path.parts or any(part in {".", ".."} for part in path.parts):
            raise ValueError("unsafe artifact path")
        return f"{self.prefix}/releases/{run_id}/{dataset}/{path.as_posix()}"

    def run_prefix(self, run_id: str, dataset: str) -> str:
        _safe(run_id, "release ID")
        self._definition(dataset)
        return f"gs://{self.bucket_name}/{self.prefix}/releases/{run_id}/{dataset}"

    def _definition(self, name: str) -> Materialization:
        _safe(name, "dataset")
        definition = MATERIALIZATIONS_BY_NAME.get(name)
        if definition is None or definition.product != self.product:
            raise ValueError("dataset is not registered for this product")
        return definition

    def _upload_file(self, name: str, path: Path) -> ObjectMetadata:
        if path.stat().st_size > _MAX_OBJECT_BYTES:
            raise ValueError("local Parquet file exceeds configured byte budget")
        blob = self.bucket.blob(name)
        blob.upload_from_filename(str(path), if_generation_match=0, checksum="crc32c")
        metadata = _metadata(blob, self.bucket_name, name)
        with tempfile.TemporaryDirectory() as directory:
            readback = Path(directory) / "readback"
            blob.download_to_filename(str(readback), if_generation_match=int(metadata.generation), checksum="crc32c")
            if readback.stat().st_size != path.stat().st_size:
                raise ValueError("uploaded object size failed readback verification")
            with path.open("rb") as source, readback.open("rb") as downloaded:
                while True:
                    left, right = source.read(1024 * 1024), downloaded.read(1024 * 1024)
                    if left != right:
                        raise ValueError("uploaded object bytes failed readback verification")
                    if not left:
                        break
        return metadata

    def _upload_json(self, name: str, value: Any) -> tuple[ObjectMetadata, bytes]:
        payload = _canonical(value)
        if len(payload) > _MAX_JSON_BYTES:
            raise ValueError("JSON object exceeds configured byte budget")
        blob = self.bucket.blob(name)
        blob.upload_from_string(payload, content_type="application/json", if_generation_match=0, checksum="crc32c")
        metadata = _metadata(blob, self.bucket_name, name)
        actual = _download(blob, metadata.generation)
        if actual != payload or len(actual) != metadata.size:
            raise ValueError("uploaded JSON failed generation-pinned readback")
        return metadata, actual

    def upload_parquet_files(
        self, run_id: str, definition: Materialization, artifacts: MaterializationArtifacts
    ) -> tuple[ObjectMetadata, ...]:
        if self._definition(definition.name) is not definition:
            raise ValueError("materialization is not registered for this product")
        if getattr(artifacts, "schema_evidence", None) is None:
            raise ValueError("schema evidence is required before upload")
        _safe(run_id, "release ID")
        root = artifacts.root.resolve()
        if not root.is_dir() or not artifacts.sorted_parquet_files:
            raise ValueError("artifact root must contain parquet files")
        paths: list[tuple[str, Path]] = []
        total_bytes = 0
        for path in artifacts.sorted_parquet_files:
            resolved = path.resolve()
            try:
                relative = resolved.relative_to(root)
            except ValueError as error:
                raise ValueError("artifact is outside its root") from error
            if path.is_symlink() or not resolved.is_file() or relative.suffix != ".parquet" or len(relative.parts) != 1:
                raise ValueError("artifact must be a regular parquet file")
            filename = _safe(relative.name, "file name")
            if not filename.endswith(".parquet"):
                raise ValueError("parquet file name must end in .parquet")
            size = resolved.stat().st_size
            if size < 0 or size > _MAX_OBJECT_BYTES:
                raise ValueError("local Parquet file exceeds configured byte budget")
            total_bytes += size
            if total_bytes > _MAX_RELEASE_BYTES:
                raise ValueError("local release exceeds configured aggregate byte budget")
            paths.append((relative.as_posix(), resolved))
        if len({path for path, _ in paths}) != len(paths):
            raise ValueError("artifact paths must be unique")
        return tuple(
            self._upload_file(self._name(run_id, definition.name, f"partitions/{relative}"), path)
            for relative, path in sorted(paths)
        )

    def upload_dataset_manifest(self, run_id: str, manifest: dict[str, Any]) -> ObjectMetadata:
        dataset = self._definition(manifest["dataset"]).name
        metadata, _ = self._upload_json(self._name(run_id, dataset, "manifest.json"), manifest)
        return metadata

    def upload_golden(self, run_id: str, dataset: str, name: str, artifact: bytes) -> ObjectMetadata:
        dataset = self._definition(dataset).name
        filename = _safe(name, "golden name")
        if len(artifact) > _MAX_JSON_BYTES:
            raise ValueError("golden artifact exceeds JSON byte budget")
        canonical = canonical_json_bytes(json.loads(artifact))
        if canonical != artifact:
            raise ValueError("golden bytes must already be canonical JSON")
        metadata, data = self._upload_json(
            self._name(run_id, dataset, f"goldens/{filename}.json"), json.loads(artifact)
        )
        if data != artifact:
            raise ValueError("golden bytes must already be canonical JSON")
        return metadata

    def upload_release_manifest(self, run_id: str, manifest: dict[str, Any]) -> ObjectMetadata:
        _safe(run_id, "release ID")
        metadata, _ = self._upload_json(f"{self.prefix}/releases/{run_id}/release.json", manifest)
        return metadata

    def _pointer_blob(self) -> Any:
        return self.bucket.blob(f"{self.prefix}/current.json")

    def _read_pointer(self) -> tuple[Any | None, dict[str, Any] | None, str | None]:
        blob = self._pointer_blob()
        try:
            blob.reload()
        except NotFound:
            return blob, None, None
        generation = str(blob.generation)
        if int(blob.size) > _MAX_JSON_BYTES:
            raise ValueError("current pointer exceeds configured JSON byte budget")
        raw = _download(blob, generation)
        pointer = json.loads(raw)
        if not isinstance(pointer, dict) or "releaseSequence" not in pointer or "releaseId" not in pointer:
            raise ValueError("current pointer is malformed")
        contract = "pv-release.v2" if self.product == "pax-vault" else "analytics-release.v1"
        release_id = pointer.get("releaseId")
        expected_prefix = f"gs://{self.bucket_name}/{self.prefix}/releases/{release_id}/"
        if (
            _canonical(pointer) != raw
            or not isinstance(release_id, str)
            or not _SAFE_COMPONENT.fullmatch(release_id)
            or pointer.get("contractVersion") != contract
            or pointer.get("schemaVersion") != contract
            or pointer.get("prefix") != expected_prefix
            or pointer.get("manifestUri") != f"{expected_prefix}release.json"
            or not str(pointer.get("manifestGeneration", "")).isdigit()
            or not re.fullmatch(r"[0-9a-f]{64}", str(pointer.get("manifestSha256", "")))
            or type(pointer.get("releaseSequence")) is not int
            or pointer["releaseSequence"] < 1
            or not isinstance(pointer.get("sourceOrder"), str)
            or not isinstance(pointer.get("sourceHighWaterOrder"), str)
            or pointer.get("sourceHighWaterOrder", "") < pointer.get("sourceOrder", "")
            or not _SAFE_COMPONENT.fullmatch(pointer.get("sourceOrder", ""))
            or not _SAFE_COMPONENT.fullmatch(pointer.get("sourceHighWaterOrder", ""))
            or "retainedPrevious" not in pointer
        ):
            raise ValueError("current pointer is malformed or belongs to another product")
        _utc_timestamp(pointer.get("createdAtUtc"), "pointer createdAtUtc")
        if not isinstance(pointer.get("producerRevision"), str) or not _SAFE_COMPONENT.fullmatch(
            pointer["producerRevision"]
        ):
            raise ValueError("current pointer producer revision is malformed")
        retained = pointer["retainedPrevious"]
        if retained is not None:
            if not isinstance(retained, dict) or not _SAFE_COMPONENT.fullmatch(str(retained.get("releaseId", ""))):
                raise ValueError("retained pointer metadata is malformed")
            if not re.fullmatch(r"[0-9a-f]{64}", str(retained.get("manifestSha256", ""))):
                raise ValueError("retained pointer hash is malformed")
            _positive_generation(retained.get("manifestGeneration"), "retained manifest")
            retained_prefix = f"gs://{self.bucket_name}/{self.prefix}/releases/{retained['releaseId']}/"
            if retained.get("manifestUri") != f"{retained_prefix}release.json":
                raise ValueError("retained pointer URI is malformed")
        return blob, pointer, generation

    def _validate_release(self, run_id: str, generation: str, expected_sha256: str | None = None) -> bytes:
        release_name = f"{self.prefix}/releases/{run_id}/release.json"
        release_blob = self.bucket.blob(release_name)
        release_blob.reload()
        if str(release_blob.generation) != generation:
            raise ValueError("release manifest generation changed")
        if int(release_blob.size) > _MAX_JSON_BYTES:
            raise ValueError("release manifest exceeds configured JSON byte budget")
        raw = _download(release_blob, generation)
        if len(raw) > _MAX_JSON_BYTES:
            raise ValueError("release manifest exceeds configured JSON byte budget")
        if str(release_blob.generation) != generation or release_blob.crc32c != _crc32c_bytes(raw):
            raise ValueError("release manifest generation or CRC32C mismatch")
        if int(release_blob.size) != len(raw):
            raise ValueError("release manifest size mismatch")
        if expected_sha256 is not None and hashlib.sha256(raw).hexdigest() != expected_sha256:
            raise ValueError("retained release manifest hash does not match pointer")
        release = json.loads(raw)
        if _canonical(release) != raw:
            raise ValueError("release manifest is not canonical JSON")
        contract = "pv-release.v2" if self.product == "pax-vault" else "analytics-release.v1"
        if (
            release.get("releaseId") != run_id
            or release.get("contractVersion") != contract
            or release.get("sourceReadPolicy") != _POLICY
            or not isinstance(release.get("sourceOrder"), str)
            or not release.get("sourceOrder")
            or set(release.get("datasets", {})) != set(PRODUCT_NAMES[self.product])
        ):
            raise ValueError("release manifest failed product validation")
        _safe(release["sourceOrder"], "release source order")
        _utc_timestamp(release.get("createdAtUtc"), "release createdAtUtc")
        if not isinstance(release.get("producerRevision"), str) or not _SAFE_COMPONENT.fullmatch(
            release["producerRevision"]
        ):
            raise ValueError("release producer revision is invalid")
        manifests: list[tuple[str, Materialization, dict[str, Any], str]] = []
        total_release_bytes = len(raw)
        for dataset, entry in release["datasets"].items():
            definition = self._definition(dataset)
            expected_schema = SCHEMAS_BY_NAME.get(dataset)
            if expected_schema is None or expected_schema.schema_version != definition.schema_version:
                raise ValueError("dataset has no matching registered schema")
            dataset_uri = f"gs://{self.bucket_name}/{self.prefix}/releases/{run_id}/{dataset}/manifest.json"
            _positive_generation(entry.get("manifestGeneration"), "dataset manifest")
            if entry.get("manifestUri") != dataset_uri:
                raise ValueError("dataset manifest escaped its immutable prefix")
            manifest_blob = self.bucket.blob(f"{self.prefix}/releases/{run_id}/{dataset}/manifest.json")
            manifest_blob.reload()
            if str(manifest_blob.generation) != str(entry["manifestGeneration"]):
                raise ValueError("dataset manifest generation changed")
            if int(manifest_blob.size) > _MAX_JSON_BYTES:
                raise ValueError("dataset manifest exceeds configured JSON byte budget")
            manifest_bytes = _download(manifest_blob, str(entry["manifestGeneration"]))
            if str(manifest_blob.generation) != str(entry["manifestGeneration"]):
                raise ValueError("dataset manifest generation changed")
            if manifest_blob.crc32c != _crc32c_bytes(manifest_bytes):
                raise ValueError("dataset manifest CRC32C mismatch")
            if int(manifest_blob.size) != len(manifest_bytes):
                raise ValueError("dataset manifest size mismatch")
            if len(manifest_bytes) > _MAX_JSON_BYTES:
                raise ValueError("dataset manifest exceeds configured JSON byte budget")
            manifest = json.loads(manifest_bytes)
            if _canonical(manifest) != manifest_bytes:
                raise ValueError("dataset manifest is not canonical JSON")
            if (
                manifest.get("dataset") != dataset
                or manifest.get("contractVersion") != contract
                or manifest.get("schemaVersion") != definition.schema_version
                or entry.get("schemaVersion") != definition.schema_version
                or manifest.get("schemaFingerprintSha256") != schema_fingerprint(expected_schema.columns)
                or manifest.get("columns") != manifest_columns(expected_schema.columns)
                or manifest.get("sourceReadPolicy") != _POLICY
                or not manifest.get("sourceReadTimestampUtc")
                or not manifest.get("sourceOrder")
                or manifest.get("sourceOrder") != release.get("sourceOrder")
                or not manifest.get("goldens")
                or not manifest.get("objects")
                or manifest.get("sourceReadPolicy") != entry.get("sourceReadPolicy")
                or manifest.get("sourceReadTimestampUtc") != entry.get("sourceReadTimestampUtc")
                or manifest.get("sourceOrder") != entry.get("sourceOrder")
            ):
                raise ValueError("dataset manifest failed schema or evidence validation")
            _utc_timestamp(manifest["sourceReadTimestampUtc"], "dataset sourceReadTimestampUtc")
            if not isinstance(manifest["objects"], list) or not isinstance(manifest["goldens"], list):
                raise ValueError("dataset manifest artifacts must be arrays")
            if int(manifest["totalSizeBytes"]) < 0 or int(manifest["rowCount"]) < 0:
                raise ValueError("dataset aggregate size and row count must be non-negative")
            total_release_bytes += len(manifest_bytes)
            for item in manifest["objects"]:
                size = item.get("sizeBytes")
                if not isinstance(size, int) or size < 0 or size > _MAX_OBJECT_BYTES:
                    raise ValueError("Parquet object has invalid size or exceeds budget")
                _positive_generation(item.get("generation"), "Parquet")
                total_release_bytes += size
            for item in manifest["goldens"]:
                size = item.get("sizeBytes")
                if not isinstance(size, int) or size < 0 or size > _MAX_JSON_BYTES:
                    raise ValueError("golden object has invalid size or exceeds budget")
                _positive_generation(item.get("generation"), "golden")
                if not re.fullmatch(r"[0-9a-f]{64}", str(item.get("sha256", ""))):
                    raise ValueError("golden SHA-256 metadata is invalid")
                total_release_bytes += size
            if total_release_bytes > _MAX_RELEASE_BYTES:
                raise ValueError("release exceeds configured aggregate byte budget")
            manifests.append((dataset, definition, manifest, str(entry["manifestGeneration"])))

        for dataset, _definition, manifest, _manifest_generation in manifests:
            objects = manifest["objects"]
            expected_prefix = f"gs://{self.bucket_name}/{self.prefix}/releases/{run_id}/{dataset}/partitions/"
            total_size = total_rows = 0
            seen: set[str] = set()
            seen_names: set[str] = set()
            expected_schema = SCHEMAS_BY_NAME[dataset]
            for item in objects:
                uri = item.get("uri", "")
                if not uri.startswith(expected_prefix) or uri in seen:
                    raise ValueError("Parquet object URI is invalid or duplicated")
                filename = uri.removeprefix(expected_prefix)
                if "/" in filename or not filename.endswith(".parquet") or not _SAFE_COMPONENT.fullmatch(filename):
                    raise ValueError("Parquet object path is invalid")
                if filename in seen_names:
                    raise ValueError("duplicate Parquet file name")
                seen.add(uri)
                seen_names.add(filename)
                size = int(item["sizeBytes"])
                rows = int(item["rowCount"])
                if size < 0 or rows < 0:
                    raise ValueError("Parquet object size and row count must be non-negative")
                blob = self.bucket.blob(f"{self.prefix}/releases/{run_id}/{dataset}/partitions/{filename}")
                with tempfile.TemporaryDirectory() as directory:
                    local_path = Path(directory) / filename
                    actual_size = _download_file(blob, str(item["generation"]), local_path, expected_size=size)
                    if actual_size != size or _crc32c_file(local_path) != item.get("crc32c"):
                        raise ValueError("Parquet object size or CRC32C does not match manifest")
                    connection = duckdb.connect(":memory:")
                    try:
                        description = connection.execute(
                            "DESCRIBE SELECT * FROM read_parquet(?)", [str(local_path)]
                        ).fetchall()
                        actual_columns = tuple(
                            (str(column[0]), str(column[1]), str(column[2]).upper() == "YES") for column in description
                        )
                        expected_columns = tuple(
                            (column.name, column.duckdb_type, column.nullable) for column in expected_schema.columns
                        )
                        if actual_columns != expected_columns:
                            raise ValueError(
                                f"Parquet file columns or types do not match registered schema: "
                                f"expected={expected_columns!r}, actual={actual_columns!r}"
                            )
                        row_result = connection.execute(
                            "SELECT count(*) FROM read_parquet(?)", [str(local_path)]
                        ).fetchone()
                        actual_rows = int(row_result[0]) if row_result is not None else -1
                    finally:
                        connection.close()
                    if actual_rows != rows:
                        raise ValueError("Parquet file row count does not match manifest")
                total_size += size
                total_rows += rows
            if total_size != int(manifest["totalSizeBytes"]) or total_rows != int(manifest["rowCount"]):
                raise ValueError("dataset manifest object aggregate size or row count does not match")
            if schema_fingerprint(expected_schema.columns) != manifest["schemaFingerprintSha256"]:
                raise ValueError("dataset schema fingerprint does not match registered schema")
            definition = self._definition(dataset)
            with tempfile.TemporaryDirectory() as directory:
                staging_root = Path(directory)
                staged_paths: list[Path] = []
                for item in objects:
                    filename = item["uri"].removeprefix(expected_prefix)
                    staged = staging_root / filename
                    blob = self.bucket.blob(f"{self.prefix}/releases/{run_id}/{dataset}/partitions/{filename}")
                    _download_file(blob, str(item["generation"]), staged, expected_size=int(item["sizeBytes"]))
                    staged_paths.append(staged)
                connection = duckdb.connect(":memory:")
                try:
                    staged_artifacts = MaterializationArtifacts(staging_root, tuple(staged_paths), total_rows)
                    physical_evidence = validate_artifacts(connection, staged_artifacts, definition)
                    if physical_evidence.file_row_counts != tuple(int(item["rowCount"]) for item in objects):
                        raise ValueError("physical Parquet validation row counts differ from manifest")
                    connection.read_parquet([str(path) for path in staged_paths]).create_view(dataset)
                    query_result = connection.execute(f"SELECT COUNT(*) AS row_count FROM {dataset}").fetchone()
                    if query_result is None:
                        raise ValueError("candidate verification query returned no result")
                    query_result_bytes = canonical_json_bytes([[{"$bigint": str(query_result[0])}]])
                finally:
                    connection.close()
            actual_golden_names: set[str] = set()
            for golden in manifest["goldens"]:
                golden_uri = f"gs://{self.bucket_name}/{self.prefix}/releases/{run_id}/{dataset}/goldens/"
                if not golden.get("uri", "").startswith(golden_uri):
                    raise ValueError("golden artifact URI escaped immutable prefix")
                golden_name = golden["uri"].removeprefix(golden_uri)
                if (
                    "/" in golden_name
                    or not golden_name.endswith(".json")
                    or not _SAFE_COMPONENT.fullmatch(golden_name)
                ):
                    raise ValueError("golden artifact path is invalid")
                if golden_name in actual_golden_names:
                    raise ValueError("duplicate golden artifact")
                actual_golden_names.add(golden_name)
                query = golden.get("query")
                if query != f"SELECT COUNT(*) AS row_count FROM {dataset}":
                    raise ValueError("golden query is not the deterministic registered count query")
                canonicalization = golden.get("canonicalization")
                if canonicalization != "rows-json-v1":
                    raise ValueError("unsupported golden canonicalization")
                with tempfile.TemporaryDirectory() as directory:
                    golden_path = Path(directory) / golden_name
                    golden_blob = self.bucket.blob(f"{self.prefix}/releases/{run_id}/{dataset}/goldens/{golden_name}")
                    golden_size = _download_file(
                        golden_blob, str(golden["generation"]), golden_path, expected_size=int(golden["sizeBytes"])
                    )
                    golden_bytes = golden_path.read_bytes()
                    if (
                        golden_size != int(golden["sizeBytes"])
                        or hashlib.sha256(golden_bytes).hexdigest() != golden["sha256"]
                        or _crc32c_file(golden_path) != golden.get("crc32c")
                        or _canonical(json.loads(golden_bytes)) != golden_bytes
                    ):
                        raise ValueError("golden artifact verification failed")
                if golden_bytes != query_result_bytes:
                    raise ValueError("golden count does not match candidate Parquet row count")
        return raw

    def commit_pointer(
        self,
        run_id: str,
        release: ObjectMetadata,
        manifest_sha256: str,
        source_order: str,
        producer_revision: str,
        created_at: str,
    ) -> dict[str, Any]:
        _safe(run_id, "release ID")
        if not source_order or not isinstance(source_order, str):
            raise ValueError("source order is required")
        _safe(source_order, "source order")
        revision = (
            producer_revision
            if isinstance(producer_revision, str) and _SAFE_COMPONENT.fullmatch(producer_revision)
            else "unknown"
        )
        contract = "pv-release.v2" if self.product == "pax-vault" else "analytics-release.v1"
        if release.uri != f"gs://{self.bucket_name}/{self.prefix}/releases/{run_id}/release.json":
            raise ValueError("release manifest URI is outside the exact product release prefix")
        _positive_generation(release.generation, "release manifest")
        if not re.fullmatch(r"[0-9a-f]{64}", manifest_sha256):
            raise ValueError("release manifest SHA-256 is malformed")
        release_bytes = self._validate_release(run_id, release.generation)
        if hashlib.sha256(release_bytes).hexdigest() != manifest_sha256:
            raise ValueError("release manifest SHA-256 does not match pinned bytes")
        release_value = json.loads(release_bytes)
        if (
            release_value.get("releaseId") != run_id
            or release_value.get("contractVersion") != contract
            or set(release_value.get("datasets", {})) != set(PRODUCT_NAMES[self.product])
            or release_value.get("sourceOrder") != source_order
        ):
            raise ValueError("candidate release manifest failed product validation")
        release_revision = release_value.get("producerRevision", "unknown")
        if not isinstance(release_revision, str) or not _SAFE_COMPONENT.fullmatch(release_revision):
            raise ValueError("release producer revision is invalid")
        revision = release_revision
        created_at = _utc_timestamp(release_value.get("createdAtUtc", created_at), "release createdAtUtc")
        for _ in range(5):
            blob, old, generation = self._read_pointer()
            assert blob is not None
            high_water = (old or {}).get("sourceHighWaterOrder")
            if high_water is not None and source_order <= high_water:
                raise PointerConflictError("candidate source order is stale")
            new = {
                "contractVersion": contract,
                "releaseId": run_id,
                "prefix": f"gs://{self.bucket_name}/{self.prefix}/releases/{run_id}/",
                "manifestUri": release.uri,
                "manifestGeneration": release.generation,
                "manifestSha256": manifest_sha256,
                "schemaVersion": contract,
                "createdAtUtc": created_at,
                "producerRevision": revision,
                "releaseSequence": int((old or {}).get("releaseSequence", 0)) + 1,
                "sourceOrder": source_order,
                "sourceHighWaterOrder": max(source_order, high_water or source_order),
                "retainedPrevious": (
                    {
                        "releaseId": old["releaseId"],
                        "manifestUri": old["manifestUri"],
                        "manifestGeneration": old["manifestGeneration"],
                        "manifestSha256": old["manifestSha256"],
                    }
                    if old
                    else None
                ),
            }
            payload = _canonical(new)
            try:
                blob.upload_from_string(
                    payload,
                    content_type="application/json",
                    if_generation_match=0 if generation is None else int(generation),
                    checksum="crc32c",
                )
            except PreconditionFailed:
                _, observed, observed_generation = self._read_pointer()
                if observed == new:
                    return {**new, "pointerGeneration": observed_generation, "publicationOutcome": "committed"}
                continue
            except Exception:
                # Transport errors are ambiguous: inspect the pointer before any retry.
                _, observed, observed_generation = self._read_pointer()
                if observed == new and observed_generation is not None:
                    return {**new, "pointerGeneration": observed_generation, "publicationOutcome": "committed"}
                if observed and (observed.get("retainedPrevious") or {}).get("releaseId") == run_id:
                    raise PointerConflictError(
                        "candidate was committed and immediately superseded",
                        committed=True,
                        outcome="superseded",
                    ) from None
                if observed and source_order <= observed.get("sourceHighWaterOrder", ""):
                    raise PointerConflictError(
                        "candidate became stale after an ambiguous pointer write", outcome="stale"
                    ) from None
                continue
            uploaded_generation = str(blob.generation)
            try:
                pinned_bytes = _download(blob, uploaded_generation)
            except (NotFound, PreconditionFailed) as error:
                try:
                    _, observed, observed_generation = self._read_pointer()
                except Exception as readback_error:
                    raise PointerConflictError(
                        "pointer write committed but readback could not be confirmed",
                        committed=True,
                        outcome="unconfirmed",
                        pointer_generation=uploaded_generation,
                    ) from readback_error
                if observed == new and observed_generation is not None:
                    return {**new, "pointerGeneration": observed_generation, "publicationOutcome": "committed"}
                raise PointerConflictError(
                    f"pointer write committed at generation {uploaded_generation} but was superseded before readback",
                    committed=True,
                    outcome="superseded",
                    pointer_generation=uploaded_generation,
                ) from error
            except Exception as error:
                raise PointerConflictError(
                    "pointer write committed but readback could not be confirmed",
                    committed=True,
                    outcome="unconfirmed",
                    pointer_generation=uploaded_generation,
                ) from error
            if pinned_bytes != payload:
                raise PointerConflictError(
                    "pointer generation-pinned readback did not match committed bytes",
                    committed=True,
                    outcome="unconfirmed",
                    pointer_generation=uploaded_generation,
                )
            try:
                blob.reload()
                observed_generation = str(blob.generation)
            except NotFound as error:
                raise PointerConflictError(
                    "pointer was deleted after successful generation-pinned readback",
                    committed=True,
                    outcome="superseded",
                    pointer_generation=uploaded_generation,
                ) from error
            except Exception as error:
                raise PointerConflictError(
                    "pointer write committed but current pointer could not be confirmed",
                    committed=True,
                    outcome="unconfirmed",
                    pointer_generation=uploaded_generation,
                ) from error
            if observed_generation != uploaded_generation:
                raise PointerConflictError(
                    f"pointer write committed at generation {uploaded_generation} but was subsequently superseded",
                    committed=True,
                    outcome="superseded",
                    pointer_generation=uploaded_generation,
                )
            return {
                **new,
                "pointerGeneration": uploaded_generation,
                "publicationOutcome": "committed",
            }
        raise PointerConflictError("pointer changed repeatedly during publication", outcome="unconfirmed")

    def rollback_pointer(
        self,
        release_id: str,
        *,
        expected_generation: str,
        source_order: str | None = None,
        producer_revision: str = "unknown",
        created_at: str = "",
    ) -> dict[str, Any]:
        _safe(release_id, "release ID")
        blob, current, generation = self._read_pointer()
        assert blob is not None
        if current is None or generation != expected_generation:
            raise PointerConflictError("pointer generation changed before rollback")
        # A rollback target must be a retained, valid prior release represented by
        # the pointer's retainedPrevious fields; callers cannot nominate arbitrary data.
        retained = current.get("retainedPrevious")
        if not isinstance(retained, dict) or retained.get("releaseId") != release_id:
            raise ValueError("rollback target is not the retained previous release")
        release_uri = retained.get("manifestUri")
        release_generation = retained.get("manifestGeneration")
        retained_hash = retained.get("manifestSha256")
        if not isinstance(retained_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", retained_hash):
            raise ValueError("retained release hash is missing or malformed")
        _positive_generation(release_generation, "retained release")
        actual = self._validate_release(release_id, str(release_generation), retained.get("manifestSha256"))
        parsed = json.loads(actual)
        if (
            parsed.get("releaseId") != release_id
            or f"gs://{self.bucket_name}/{self.prefix}/releases/{release_id}/release.json" != release_uri
        ):
            raise ValueError("retained release validation failed")
        # Rollbacks advance sequence but deliberately keep source high-water.
        previous = dict(current)
        selected_order = parsed.get("sourceOrder")
        if not isinstance(selected_order, str) or not selected_order:
            raise ValueError("retained release has no source order")
        previous.update(
            {
                "releaseId": release_id,
                "prefix": f"gs://{self.bucket_name}/{self.prefix}/releases/{release_id}/",
                "manifestUri": release_uri,
                "manifestGeneration": str(release_generation),
                "manifestSha256": hashlib.sha256(actual).hexdigest(),
                "createdAtUtc": parsed.get("createdAtUtc"),
                "producerRevision": parsed.get("producerRevision", "unknown"),
                "releaseSequence": int(current["releaseSequence"]) + 1,
                "sourceOrder": selected_order,
                "sourceHighWaterOrder": current.get("sourceHighWaterOrder"),
            }
        )
        previous["retainedPrevious"] = {
            "releaseId": current["releaseId"],
            "manifestUri": current["manifestUri"],
            "manifestGeneration": current["manifestGeneration"],
            "manifestSha256": current["manifestSha256"],
        }
        try:
            blob.upload_from_string(
                _canonical(previous),
                content_type="application/json",
                if_generation_match=int(expected_generation),
                checksum="crc32c",
            )
        except PreconditionFailed as error:
            _, observed, observed_generation = self._read_pointer()
            if observed == previous:
                return {**previous, "pointerGeneration": observed_generation, "publicationOutcome": "committed"}
            raise PointerConflictError("pointer changed during rollback", outcome="conflict") from error
        except Exception:
            _, observed, observed_generation = self._read_pointer()
            if observed == previous and observed_generation is not None:
                return {**previous, "pointerGeneration": observed_generation, "publicationOutcome": "committed"}
            raise PointerConflictError("rollback write outcome is unconfirmed", outcome="unconfirmed") from None
        uploaded_generation = str(blob.generation)
        try:
            pinned = _download(blob, uploaded_generation)
        except (NotFound, PreconditionFailed) as error:
            try:
                _, observed, observed_generation = self._read_pointer()
            except Exception as readback_error:
                raise PointerConflictError(
                    "rollback committed but readback could not be confirmed",
                    committed=True,
                    outcome="unconfirmed",
                    pointer_generation=uploaded_generation,
                ) from readback_error
            if observed == previous and observed_generation is not None:
                return {**previous, "pointerGeneration": observed_generation, "publicationOutcome": "committed"}
            raise PointerConflictError(
                "rollback committed but was superseded before readback",
                committed=True,
                outcome="superseded",
                pointer_generation=uploaded_generation,
            ) from error
        except Exception as error:
            raise PointerConflictError(
                "rollback committed but readback could not be confirmed",
                committed=True,
                outcome="unconfirmed",
                pointer_generation=uploaded_generation,
            ) from error
        if pinned != _canonical(previous):
            raise PointerConflictError(
                "rollback generation-pinned readback did not match content",
                committed=True,
                outcome="unconfirmed",
                pointer_generation=uploaded_generation,
            )
        try:
            blob.reload()
            observed_generation = str(blob.generation)
        except NotFound as error:
            raise PointerConflictError(
                "rollback committed but pointer was deleted before confirmation",
                committed=True,
                outcome="superseded",
                pointer_generation=uploaded_generation,
            ) from error
        except Exception as error:
            raise PointerConflictError(
                "rollback committed but current pointer could not be confirmed",
                committed=True,
                outcome="unconfirmed",
                pointer_generation=uploaded_generation,
            ) from error
        if observed_generation != uploaded_generation:
            raise PointerConflictError(
                "rollback committed but pointer was superseded",
                committed=True,
                outcome="superseded",
                pointer_generation=uploaded_generation,
            )
        return {**previous, "pointerGeneration": uploaded_generation, "publicationOutcome": "committed"}


def build_manifest(
    run_id: str,
    parquet_files: tuple[ObjectMetadata, ...],
    committed_run_prefix: str,
    row_count: int,
    source_read_at: str,
    published_at: str,
    materialization: Materialization,
    *,
    schema_evidence: Any,
    goldens: tuple[dict[str, Any], ...],
    product: str | None = None,
    source_order: str | None = None,
) -> dict[str, Any]:
    product = product or materialization.product
    _safe(run_id, "release ID")
    if materialization.product != product or MATERIALIZATIONS_BY_NAME.get(materialization.name) is not materialization:
        raise ValueError("materialization is not registered for this product")
    if not source_read_at:
        raise ValueError("actual per-dataset source read timestamp is required")
    _utc_timestamp(source_read_at, "dataset sourceReadTimestampUtc")
    if not parquet_files or not goldens or schema_evidence is None:
        raise ValueError("schema evidence and candidate verification golden are required")
    columns = schema_evidence.columns
    fingerprint = schema_evidence.schema_fingerprint_sha256
    counts = tuple(schema_evidence.file_row_counts)
    if not isinstance(columns, (list, tuple)) or not fingerprint or len(counts) != len(parquet_files):
        raise ValueError("schema evidence is incomplete")
    ordered_columns = manifest_columns(columns)
    expected_schema = SCHEMAS_BY_NAME.get(materialization.name)
    expected_fingerprint = schema_fingerprint(expected_schema.columns) if expected_schema is not None else None
    if (
        expected_schema is None
        or expected_schema.schema_version != materialization.schema_version
        or ordered_columns != manifest_columns(expected_schema.columns)
        or fingerprint != expected_fingerprint
    ):
        raise ValueError("schema evidence does not match the registered dataset schema")
    assert expected_fingerprint is not None
    fingerprint = expected_fingerprint
    if sum(counts) != row_count or any(count < 0 for count in counts):
        raise ValueError("file row counts do not match dataset row count")
    _safe(source_order or run_id, "source order")
    if any(
        not isinstance(g, dict)
        or not all(k in g for k in ("name", "uri", "generation", "sizeBytes", "query", "canonicalization", "sha256"))
        for g in goldens
    ):
        raise ValueError("candidate verification golden metadata is incomplete")
    objects = [
        {"uri": obj.uri, "generation": obj.generation, "sizeBytes": obj.size, "crc32c": obj.crc32c, "rowCount": count}
        for obj, count in zip(parquet_files, counts, strict=True)
    ]
    return {
        "dataset": materialization.name,
        "contractVersion": "pv-release.v2" if product == "pax-vault" else "analytics-release.v1",
        "schemaVersion": materialization.schema_version,
        "rowCount": row_count,
        "totalSizeBytes": sum(obj.size for obj in parquet_files),
        "schemaFingerprintSha256": fingerprint,
        "columns": ordered_columns,
        "sourceReadPolicy": _POLICY,
        "sourceReadTimestampUtc": source_read_at,
        "sourceOrder": source_order or run_id,
        "goldens": list(goldens),
        "objects": objects,
    }


def build_release_manifest(
    run_id: str,
    statuses: dict[str, PublicationStatus],
    published_at: str,
    source_order: str | None = None,
    *,
    product: str = "pax-vault",
    producer_revision: str = "unknown",
) -> dict[str, Any]:
    _safe(run_id, "release ID")
    _utc_timestamp(published_at, "release createdAtUtc")
    _safe(source_order or run_id, "source order")
    if not _SAFE_COMPONENT.fullmatch(producer_revision):
        raise ValueError("producer revision is invalid")
    approved = set(PRODUCT_NAMES.get(product, ()))
    if not approved or set(statuses) != approved:
        raise ValueError("release requires the exact approved product dataset set")
    contract = "pv-release.v2" if product == "pax-vault" else "analytics-release.v1"
    entries: dict[str, Any] = {}
    for name, status in sorted(statuses.items()):
        if status.manifest.get("dataset") != name:
            raise ValueError("release contains mismatched dataset status")
        if status.manifest.get("sourceOrder") != (source_order or run_id):
            raise ValueError("dataset source order differs from release source order")
        entries[name] = {
            "manifestUri": status.manifest_object.uri,
            "manifestGeneration": status.manifest_object.generation,
            "schemaVersion": status.manifest["schemaVersion"],
            "sourceReadTimestampUtc": status.manifest["sourceReadTimestampUtc"],
            "sourceReadPolicy": status.manifest["sourceReadPolicy"],
            "sourceOrder": status.manifest["sourceOrder"],
        }
    return {
        "contractVersion": contract,
        "releaseId": run_id,
        "createdAtUtc": published_at,
        "producerRevision": producer_revision if _SAFE_COMPONENT.fullmatch(producer_revision) else "unknown",
        "sourceReadPolicy": _POLICY,
        "sourceOrder": source_order or run_id,
        "datasets": entries,
    }


def publish(
    gcs: GcsPublisher,
    run_id: str,
    artifacts: MaterializationArtifacts,
    source_read_at: str,
    published_at: str,
    materialization: Materialization,
    emit: Callable[[str, dict[str, Any]], None] | None = None,
    *,
    goldens: tuple[dict[str, Any], ...] = (),
    source_order: str | None = None,
) -> PublicationStatus:
    started = time.perf_counter()
    evidence = getattr(artifacts, "schema_evidence", None)
    if evidence is None:
        raise ValueError("schema evidence is required before upload")
    if not goldens:
        raise ValueError("candidate verification golden is required before upload")
    _utc_timestamp(source_read_at, "dataset sourceReadTimestampUtc")
    _utc_timestamp(published_at, "release createdAtUtc")
    _safe(source_order or run_id, "source order")
    for golden in goldens:
        data = golden.get("artifact")
        if isinstance(data, str):
            data = data.encode("utf-8")
        if (
            not isinstance(data, bytes)
            or len(data) > _MAX_JSON_BYTES
            or not all(key in golden for key in ("name", "query", "canonicalization", "sha256"))
        ):
            raise ValueError("candidate verification golden metadata and artifact bytes are required")
        _safe(golden["name"], "golden name")
        if (
            golden["query"] != f"SELECT COUNT(*) AS row_count FROM {materialization.name}"
            or golden["canonicalization"] != "rows-json-v1"
        ):
            raise ValueError("candidate verification golden query or canonicalization is unsupported")
        if canonical_json_bytes(json.loads(data)) != data:
            raise ValueError("candidate verification golden bytes must be canonical JSON")
        if hashlib.sha256(data).hexdigest() != golden["sha256"]:
            raise ValueError("candidate verification golden hash does not match artifact")
    if len({item["name"] for item in goldens}) != len(goldens):
        raise ValueError("duplicate candidate verification golden")
    if materialization.product != gcs.product:
        raise ValueError("materialization belongs to another product")
    if (
        sum(path.stat().st_size for path in artifacts.sorted_parquet_files)
        + sum(
            len(item["artifact"].encode() if isinstance(item["artifact"], str) else item["artifact"])
            for item in goldens
        )
        > _MAX_RELEASE_BYTES
    ):
        raise ValueError("candidate release exceeds aggregate byte budget")
    files = gcs.upload_parquet_files(run_id, materialization, artifacts)
    for golden in goldens:
        if "artifact" not in golden:
            raise ValueError("golden artifact bytes are required")
        data = golden["artifact"]
        if isinstance(data, str):
            data = data.encode("utf-8")
        meta = gcs.upload_golden(run_id, materialization.name, golden["name"], data)
        golden.update({"uri": meta.uri, "generation": meta.generation, "sizeBytes": meta.size, "crc32c": meta.crc32c})
        golden.pop("artifact", None)
    manifest = build_manifest(
        run_id,
        files,
        gcs.run_prefix(run_id, materialization.name),
        artifacts.row_count,
        source_read_at,
        published_at,
        materialization,
        schema_evidence=evidence,
        goldens=goldens,
        product=gcs.product,
        source_order=source_order or run_id,
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
