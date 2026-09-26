from __future__ import annotations

import base64
import hashlib
import io
import json
import tempfile
from dataclasses import replace
from pathlib import Path

import duckdb
import google_crc32c
import pytest
from google.api_core.exceptions import NotFound, PreconditionFailed

from analytics.materializations import MATERIALIZATIONS_BY_PRODUCT
from analytics.publication import (
    GcsPublisher,
    ObjectMetadata,
    PointerConflictError,
    PublicationStatus,
    _download_file,
    build_manifest,
    build_release_manifest,
    canonical_json_bytes,
    publish,
)
from analytics.schema_registry import SCHEMAS_BY_NAME, schema_fingerprint
from analytics.settings import Settings
from analytics.source import MaterializationArtifacts, SchemaColumnEvidence, SchemaEvidence


class Stored:
    def __init__(self, content: bytes, generation: int):
        self.content = content
        self.generation = generation
        self.metageneration = 1
        self.size = len(content)
        checksum = google_crc32c.Checksum()
        checksum.update(content)
        self.crc32c = base64.b64encode(checksum.digest()).decode()


class Blob:
    objects: dict[str, Stored] = {}
    next_generation = 0
    tamper_readback = False
    race_pointer = False
    supersede_pointer = False
    overrun = False
    ambiguous_pointer = False
    post_write_open_error: BaseException | None = None
    post_write_open_corrupt = False
    post_write_confirmation_reload_error: BaseException | None = None

    def __init__(self, name: str):
        self.name = name

    def reload(self):
        if self.name.endswith("/current.json") and "uploaded_generation" in self.__dict__:
            reload_count = self.__dict__.get("post_upload_reload_count", 0) + 1
            self.__dict__["post_upload_reload_count"] = reload_count
            error = type(self).post_write_confirmation_reload_error
            if reload_count == 2 and error is not None:
                type(self).post_write_confirmation_reload_error = None
                raise error
        if self.name not in self.objects:
            raise NotFound("missing")

    def __getattr__(self, key):
        if key == "generation" and "uploaded_generation" in self.__dict__:
            return self.__dict__["uploaded_generation"]
        return getattr(self.objects[self.name], key)

    def upload_from_filename(self, filename, **kwargs):
        self._upload(Path(filename).read_bytes(), kwargs["if_generation_match"])

    def upload_from_string(self, content, **kwargs):
        self._upload(content, kwargs["if_generation_match"])

    def _upload(self, content, expected):
        existing = self.objects.get(self.name)
        if self.name.endswith("/current.json") and type(self).race_pointer and existing:
            type(self).race_pointer = False
            type(self).next_generation += 1
            existing.generation = type(self).next_generation
            raise PreconditionFailed("simulated concurrent pointer writer")
        if (existing.generation if existing else 0) != expected:
            raise PreconditionFailed("generation mismatch")
        type(self).next_generation += 1
        self.objects[self.name] = Stored(content, type(self).next_generation)
        self.__dict__["uploaded_generation"] = type(self).next_generation
        if self.name.endswith("/current.json") and type(self).supersede_pointer:
            type(self).supersede_pointer = False
            type(self).next_generation += 1
            pointer = {
                "contractVersion": "pv-release.v2",
                "releaseId": "winner",
                "prefix": "gs://f3-analytics-nonprod/pax-vault/releases/winner/",
                "manifestUri": "gs://f3-analytics-nonprod/pax-vault/releases/winner/release.json",
                "manifestGeneration": "1",
                "manifestSha256": "a" * 64,
                "schemaVersion": "pv-release.v2",
                "createdAtUtc": "2026-09-01T00:02:00Z",
                "producerRevision": "revision",
                "releaseSequence": 99,
                "sourceOrder": "winner",
                "sourceHighWaterOrder": "winner",
                "retainedPrevious": None,
            }
            winner = json.dumps(pointer, sort_keys=True, separators=(",", ":")).encode()
            self.objects[self.name] = Stored(winner, type(self).next_generation)
        if self.name.endswith("/current.json") and type(self).ambiguous_pointer:
            type(self).ambiguous_pointer = False
            raise TimeoutError("simulated response loss after successful upload")

    def download_as_bytes(self, *, if_generation_match, checksum):
        stored = self.objects[self.name]
        assert checksum == "crc32c"
        if stored.generation != if_generation_match:
            raise PreconditionFailed("pinned generation mismatch")
        return stored.content + (b"!" if type(self).tamper_readback else b"")

    def download_to_filename(self, filename, *, if_generation_match, checksum):
        Path(filename).write_bytes(self.download_as_bytes(if_generation_match=if_generation_match, checksum=checksum))

    def open(self, mode, *, if_generation_match):
        assert mode == "rb"
        error = type(self).post_write_open_error
        if (
            self.name.endswith("/current.json")
            and self.__dict__.get("uploaded_generation") == if_generation_match
            and error is not None
        ):
            type(self).post_write_open_error = None
            raise error
        stored = self.objects[self.name]
        if stored.generation != if_generation_match:
            raise PreconditionFailed("pinned generation mismatch")
        if (
            self.name.endswith("/current.json")
            and self.__dict__.get("uploaded_generation") == if_generation_match
            and type(self).post_write_open_corrupt
        ):
            type(self).post_write_open_corrupt = False
            content = stored.content
            return io.BytesIO(content[:-1] + bytes([content[-1] ^ 1]))
        return io.BytesIO(stored.content + (b"overrun" if type(self).overrun else b""))


class Bucket:
    def blob(self, name):
        return Blob(name)


class Storage:
    def bucket(self, name):
        assert name == "f3-analytics-nonprod"
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


def artifacts(tmp_path: Path, name: str, evidence=True) -> MaterializationArtifacts:
    root = tmp_path / name
    root.mkdir(exist_ok=True)
    path = root / f"{name}-0.parquet"
    path.write_bytes(parquet_bytes(name))
    expected = SCHEMAS_BY_NAME[name]
    schema_columns = tuple(
        SchemaColumnEvidence(column.name, column.duckdb_type, column.nullable) for column in expected.columns
    )
    schema = SchemaEvidence(
        columns=schema_columns,
        schema_fingerprint_sha256=schema_fingerprint(schema_columns),
        file_row_counts=(1,),
        physical_schemas=(),
    )
    return MaterializationArtifacts(root, (path,), 1, schema if evidence else None)


def parquet_bytes(name: str) -> bytes:
    expected = SCHEMAS_BY_NAME[name]
    columns = ", ".join(
        f'CAST({"0" if column.duckdb_type == "HUGEINT" else "NULL"} AS {column.duckdb_type}) AS "{column.name}"'
        for column in expected.columns
    )
    connection = duckdb.connect(":memory:")
    try:
        query = f"SELECT {columns}"
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / f"{name}.parquet"
            connection.execute(f"COPY ({query}) TO '{output}' (FORMAT PARQUET)")
            return output.read_bytes()
    finally:
        connection.close()


def wrong_schema_parquet_bytes() -> bytes:
    connection = duckdb.connect(":memory:")
    try:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "wrong.parquet"
            connection.execute(f"COPY (SELECT 1 AS unexpected) TO '{output}' (FORMAT PARQUET)")
            return output.read_bytes()
    finally:
        connection.close()


def reset():
    Blob.objects.clear()
    Blob.next_generation = 0
    Blob.tamper_readback = False
    Blob.race_pointer = False
    Blob.supersede_pointer = False
    Blob.overrun = False
    Blob.ambiguous_pointer = False
    Blob.post_write_open_error = None
    Blob.post_write_open_corrupt = False
    Blob.post_write_confirmation_reload_error = None


def golden(name="candidate_transport_check"):
    value = [[{"$bigint": "1"}]]
    encoded = canonical_json_bytes(value)
    return {
        "name": name,
        "artifact": encoded,
        "query": "SELECT COUNT(*) AS row_count FROM pv_regions",
        "canonicalization": "rows-json-v1",
        "sha256": hashlib.sha256(encoded).hexdigest(),
    }


def test_exact_product_membership_paths_and_manifest_shape(tmp_path):
    reset()
    pax = GcsPublisher(Storage(), settings(tmp_path), product="pax-vault")
    definition = MATERIALIZATIONS_BY_PRODUCT["pax-vault"][0]
    status = publish(
        pax,
        "run-1",
        artifacts(tmp_path, definition.name),
        "2026-09-01T00:00:00Z",
        "2026-09-01T00:01:00Z",
        definition,
        goldens=(golden(),),
    )
    assert set(Blob.objects) == {
        f"pax-vault/releases/run-1/{definition.name}/partitions/{definition.name}-0.parquet",
        f"pax-vault/releases/run-1/{definition.name}/goldens/candidate_transport_check.json",
        f"pax-vault/releases/run-1/{definition.name}/manifest.json",
    }
    assert status.manifest["columns"] == [
        {"name": column.name, "logicalType": column.duckdb_type, "nullable": column.nullable}
        for column in SCHEMAS_BY_NAME[definition.name].columns
    ]
    assert status.manifest["sourceReadPolicy"] == "ordered-sequential-per-dataset"
    assert status.manifest["objects"][0]["rowCount"] == 1
    with pytest.raises(ValueError, match="registered for this product"):
        pax.run_prefix("run-1", "event_info")
    with pytest.raises(ValueError, match="unsafe"):
        pax.run_prefix("../escape", definition.name)


def test_missing_evidence_and_golden_fail_closed_before_publication(tmp_path):
    reset()
    publisher = GcsPublisher(Storage(), settings(tmp_path))
    definition = MATERIALIZATIONS_BY_PRODUCT["pax-vault"][0]
    with pytest.raises(ValueError, match="schema evidence"):
        publish(
            publisher,
            "run-2",
            artifacts(tmp_path, definition.name, evidence=False),
            "2026-09-01T00:00:00Z",
            "2026-09-01T00:01:00Z",
            definition,
            goldens=(golden(),),
        )
    with pytest.raises(ValueError, match="candidate verification golden"):
        publish(
            publisher,
            "run-3",
            artifacts(tmp_path, definition.name),
            "2026-09-01T00:00:00Z",
            "2026-09-01T00:01:00Z",
            definition,
        )
    assert Blob.objects == {}


def test_build_manifest_rejects_legacy_type_key_schema_fingerprint(tmp_path):
    definition = MATERIALIZATIONS_BY_PRODUCT["pax-vault"][0]
    candidate = artifacts(tmp_path, definition.name)
    assert candidate.schema_evidence is not None
    legacy_columns = [
        {"name": column.name, "type": column.duckdb_type, "nullable": column.nullable}
        for column in candidate.schema_evidence.columns
    ]
    legacy_fingerprint = hashlib.sha256(
        json.dumps(legacy_columns, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    legacy_evidence = replace(candidate.schema_evidence, schema_fingerprint_sha256=legacy_fingerprint)
    golden_metadata = {
        "name": "candidate_transport_check",
        "uri": "gs://bucket/golden.json",
        "generation": "1",
        "sizeBytes": 19,
        "query": f"SELECT COUNT(*) AS row_count FROM {definition.name}",
        "canonicalization": "rows-json-v1",
        "sha256": "a" * 64,
    }

    with pytest.raises(ValueError, match="schema evidence does not match"):
        build_manifest(
            "legacy-fingerprint-run",
            (ObjectMetadata("gs://bucket/data.parquet", "1", 1, "crc"),),
            "gs://bucket/run/dataset",
            1,
            "2026-09-01T00:00:00Z",
            "2026-09-01T00:01:00Z",
            definition,
            schema_evidence=legacy_evidence,
            goldens=(golden_metadata,),
        )


def test_upload_readback_detects_tampering(tmp_path):
    reset()
    publisher = GcsPublisher(Storage(), settings(tmp_path))
    Blob.tamper_readback = True
    definition = MATERIALIZATIONS_BY_PRODUCT["pax-vault"][0]
    with pytest.raises(ValueError, match="size failed readback"):
        publisher.upload_parquet_files("run-4", definition, artifacts(tmp_path, definition.name))


def test_streaming_download_rejects_bytes_overrun(tmp_path):
    reset()
    Blob.objects["test/object"] = Stored(b"small", 1)
    Blob.overrun = True
    with pytest.raises(ValueError, match="exceeded its declared byte budget"):
        _download_file(Blob("test/object"), "1", tmp_path / "object", expected_size=5)


def test_release_manifest_exact_product_datasets(tmp_path):
    reset()
    definition = MATERIALIZATIONS_BY_PRODUCT["pax-vault"][0]
    status = PublicationStatus(
        {
            "dataset": definition.name,
            "schemaVersion": definition.schema_version,
            "sourceReadTimestampUtc": "2026-09-01T00:00:00Z",
            "sourceReadPolicy": "ordered-sequential-per-dataset",
            "sourceOrder": "r1",
        },
        (),
        ObjectMetadata("gs://bucket/m", "1", 1, "crc"),
    )
    with pytest.raises(ValueError, match="exact approved product"):
        build_release_manifest("r1", {definition.name: status}, "2026-09-01T00:01:00Z")


def _release(publisher, run_id):
    datasets = {}
    for item in MATERIALIZATIONS_BY_PRODUCT[publisher.product]:
        prefix = f"{publisher.prefix}/releases/{run_id}/{item.name}"
        data_blob = publisher.bucket.blob(f"{prefix}/partitions/{item.name}-0.parquet")
        parquet_content = parquet_bytes(item.name)
        data_blob.upload_from_string(parquet_content, if_generation_match=0, checksum="crc32c")
        data_meta = ObjectMetadata(
            f"gs://{publisher.bucket_name}/{prefix}/partitions/{item.name}-0.parquet",
            str(data_blob.generation),
            len(parquet_content),
            data_blob.crc32c,
        )
        golden_bytes = b'[[{"$bigint":"1"}]]'
        golden_meta = publisher.upload_golden(run_id, item.name, "check", golden_bytes)
        schema = SCHEMAS_BY_NAME[item.name]
        fingerprint = schema_fingerprint(schema.columns)
        dataset_manifest = {
            "dataset": item.name,
            "contractVersion": "pv-release.v2" if publisher.product == "pax-vault" else "analytics-release.v1",
            "schemaVersion": item.schema_version,
            "schemaFingerprintSha256": fingerprint,
            "columns": [
                {"name": column.name, "logicalType": column.duckdb_type, "nullable": column.nullable}
                for column in schema.columns
            ],
            "sourceReadPolicy": "ordered-sequential-per-dataset",
            "sourceReadTimestampUtc": "2026-09-01T00:00:00Z",
            "sourceOrder": run_id,
            "rowCount": 1,
            "totalSizeBytes": data_meta.size,
            "objects": [
                {
                    "uri": data_meta.uri,
                    "generation": data_meta.generation,
                    "sizeBytes": data_meta.size,
                    "crc32c": data_meta.crc32c,
                    "rowCount": 1,
                }
            ],
            "goldens": [
                {
                    "name": "check",
                    "uri": golden_meta.uri,
                    "generation": golden_meta.generation,
                    "sizeBytes": golden_meta.size,
                    "sha256": hashlib.sha256(golden_bytes).hexdigest(),
                    "crc32c": golden_meta.crc32c,
                    "query": f"SELECT COUNT(*) AS row_count FROM {item.name}",
                    "canonicalization": "rows-json-v1",
                }
            ],
        }
        manifest_meta, _ = publisher._upload_json(f"{prefix}/manifest.json", dataset_manifest)
        datasets[item.name] = {
            "manifestUri": manifest_meta.uri,
            "manifestGeneration": manifest_meta.generation,
            "schemaVersion": item.schema_version,
            "sourceReadTimestampUtc": "2026-09-01T00:00:00Z",
            "sourceReadPolicy": "ordered-sequential-per-dataset",
            "sourceOrder": run_id,
        }
    manifest = {
        "releaseId": run_id,
        "contractVersion": "pv-release.v2" if publisher.product == "pax-vault" else "analytics-release.v1",
        "sourceReadPolicy": "ordered-sequential-per-dataset",
        "sourceOrder": run_id,
        "createdAtUtc": "2026-09-01T00:02:00Z",
        "producerRevision": "pipeline-abc",
        "datasets": datasets,
    }
    meta = publisher.upload_release_manifest(run_id, manifest)
    release_bytes = Blob.objects[f"{publisher.prefix}/releases/{run_id}/release.json"].content
    return meta, hashlib.sha256(release_bytes).hexdigest()


def test_pointer_create_update_cas_readback_and_stale_order(tmp_path):
    reset()
    publisher = GcsPublisher(Storage(), settings(tmp_path), product="pax-vault")
    release1, digest1 = _release(publisher, "run-1")
    first = publisher.commit_pointer("run-1", release1, digest1, "run-1", "pipeline-abc", "2026-09-01T00:02:00Z")
    assert first["releaseSequence"] == 1
    assert "pax-vault/current.json" in Blob.objects
    release2, digest2 = _release(publisher, "run-2")
    second = publisher.commit_pointer("run-2", release2, digest2, "run-2", "pipeline-def", "2026-09-01T00:03:00Z")
    assert second["releaseSequence"] == 2
    assert second["retainedPrevious"]["releaseId"] == "run-1"
    with pytest.raises(PointerConflictError, match="stale"):
        publisher.commit_pointer("run-1", release1, digest1, "run-1", "pipeline", "2026-09-01T00:02:00Z")


def test_pointer_race_and_invalid_manifest_hash_rejected(tmp_path):
    reset()
    publisher = GcsPublisher(Storage(), settings(tmp_path))
    release, digest = _release(publisher, "run-race")
    with pytest.raises(ValueError, match="SHA-256"):
        publisher.commit_pointer("run-race", release, "0" * 64, "order", "revision", "2026-09-01T00:02:00Z")
    with pytest.raises(ValueError, match="malformed"):
        Blob.objects["pax-vault/current.json"] = Stored(b"{}", 100)
        publisher._read_pointer()


@pytest.mark.parametrize(("field", "value"), [("contractVersion", "future-release.v99"), ("sourceOrder", "other")])
def test_release_chain_rejects_wrong_contract_or_source_order(tmp_path, field, value):
    reset()
    publisher = GcsPublisher(Storage(), settings(tmp_path))
    release, _ = _release(publisher, f"wrong-{field}")
    key = f"pax-vault/releases/wrong-{field}/release.json"
    stored = Blob.objects[key]
    changed = json.loads(stored.content)
    changed[field] = value
    content = canonical_json_bytes(changed)
    Blob.objects[key] = Stored(content, stored.generation)
    with pytest.raises(ValueError, match="product validation|schema or evidence"):
        publisher.commit_pointer(
            f"wrong-{field}",
            release,
            hashlib.sha256(content).hexdigest(),
            f"wrong-{field}",
            "revision",
            "2026-09-01T00:02:00Z",
        )


def test_release_validation_rejects_tampered_crc_before_pointer(tmp_path):
    reset()
    publisher = GcsPublisher(Storage(), settings(tmp_path))
    release, digest = _release(publisher, "crc-run")
    object_name = "pax-vault/releases/crc-run/pv_regions/partitions/pv_regions-0.parquet"
    stored = Blob.objects[object_name]
    stored.content = stored.content[:-1] + bytes([stored.content[-1] ^ 1])
    with pytest.raises(ValueError, match="CRC32C"):
        publisher.commit_pointer("crc-run", release, digest, "crc-run", "revision", "2026-09-01T00:02:00Z")
    assert "pax-vault/current.json" not in Blob.objects


def test_release_validation_rejects_actual_parquet_schema_drift(tmp_path):
    reset()
    publisher = GcsPublisher(Storage(), settings(tmp_path))
    release, digest = _release(publisher, "schema-drift")
    manifest_key = "pax-vault/releases/schema-drift/pv_regions/manifest.json"
    object_key = "pax-vault/releases/schema-drift/pv_regions/partitions/pv_regions-0.parquet"
    content = wrong_schema_parquet_bytes()
    Blob.objects[object_key] = Stored(content, Blob.objects[object_key].generation)
    stored_manifest = Blob.objects[manifest_key]
    manifest = json.loads(stored_manifest.content)
    manifest["objects"][0]["sizeBytes"] = len(content)
    manifest["objects"][0]["crc32c"] = Blob.objects[object_key].crc32c
    manifest["totalSizeBytes"] = len(content)
    encoded = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    Blob.objects[manifest_key] = Stored(encoded, stored_manifest.generation)
    with pytest.raises(ValueError, match="columns or types"):
        publisher.commit_pointer("schema-drift", release, digest, "schema-drift", "revision", "2026-09-01T00:02:00Z")


@pytest.mark.parametrize(
    ("field", "value", "message"), [("rowCount", 2, "row count"), ("schemaVersion", "unknown.v99", "schema")]
)
def test_release_validation_rejects_row_count_or_schema_drift(tmp_path, field, value, message):
    reset()
    publisher = GcsPublisher(Storage(), settings(tmp_path))
    release, digest = _release(publisher, f"bad-{field}")
    manifest_key = f"pax-vault/releases/bad-{field}/pv_regions/manifest.json"
    stored = Blob.objects[manifest_key]
    manifest = json.loads(stored.content)
    manifest[field] = value
    if field == "rowCount":
        manifest["objects"][0]["rowCount"] = value
        manifest["totalSizeBytes"] = manifest["objects"][0]["sizeBytes"]
    altered = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    replacement = Stored(altered, stored.generation)
    Blob.objects[manifest_key] = replacement
    with pytest.raises(ValueError, match=message):
        publisher.commit_pointer(f"bad-{field}", release, digest, f"bad-{field}", "revision", "2026-09-01T00:02:00Z")
    assert "pax-vault/current.json" not in Blob.objects


def test_pointer_cas_race_rereads_and_recomputes_sequence(tmp_path):
    reset()
    publisher = GcsPublisher(Storage(), settings(tmp_path))
    release1, digest1 = _release(publisher, "race-1")
    publisher.commit_pointer("race-1", release1, digest1, "race-1", "revision", "2026-09-01T00:02:00Z")
    release2, digest2 = _release(publisher, "race-2")
    Blob.race_pointer = True
    committed = publisher.commit_pointer("race-2", release2, digest2, "race-2", "revision", "2026-09-01T00:03:00Z")
    assert committed["releaseSequence"] == 2
    assert committed["pointerGeneration"] == str(Blob.objects["pax-vault/current.json"].generation)
    assert committed["publicationOutcome"] == "committed"


def test_pointer_ambiguous_transport_is_reconciled_as_committed(tmp_path):
    reset()
    publisher = GcsPublisher(Storage(), settings(tmp_path))
    release, digest = _release(publisher, "ambiguous")
    Blob.ambiguous_pointer = True
    result = publisher.commit_pointer("ambiguous", release, digest, "ambiguous", "revision", "2026-09-01T00:02:00Z")
    assert result["publicationOutcome"] == "committed"
    assert result["pointerGeneration"] == str(Blob.objects["pax-vault/current.json"].generation)


@pytest.mark.parametrize("operation", ("forward", "rollback"))
@pytest.mark.parametrize(
    ("failure_type", "failure_stage"),
    (
        (TimeoutError, "timeout"),
        (ValueError, "checksum"),
        (TimeoutError, "reload"),
        (ValueError, "reload"),
    ),
)
def test_pointer_post_write_readback_failures_are_reported_as_committed_unconfirmed(
    tmp_path, operation, failure_type, failure_stage
):
    reset()
    publisher = GcsPublisher(Storage(), settings(tmp_path))
    if operation == "forward":
        new_release, new_digest = _release(publisher, "readback-1")
    else:
        previous_release, previous_digest = _release(publisher, "readback-1")
        publisher.commit_pointer(
            "readback-1",
            previous_release,
            previous_digest,
            "readback-1",
            "revision",
            "2026-09-01T00:02:00Z",
        )
        new_release, new_digest = _release(publisher, "readback-2")
        publisher.commit_pointer(
            "readback-2",
            new_release,
            new_digest,
            "readback-2",
            "revision",
            "2026-09-01T00:03:00Z",
        )

    failure = failure_type("private@example.test transient pointer readback detail")
    if failure_stage == "timeout":
        Blob.post_write_open_error = failure
    elif failure_stage == "checksum":
        Blob.post_write_open_corrupt = True
    else:
        Blob.post_write_confirmation_reload_error = failure

    with pytest.raises(PointerConflictError) as raised:
        if operation == "forward":
            publisher.commit_pointer(
                "readback-1",
                new_release,
                new_digest,
                "readback-1",
                "revision",
                "2026-09-01T00:04:00Z",
            )
        else:
            publisher.rollback_pointer(
                "readback-1",
                expected_generation=str(Blob.objects["pax-vault/current.json"].generation),
            )

    error = raised.value
    selected = json.loads(Blob.objects["pax-vault/current.json"].content)
    assert selected["releaseId"] == "readback-1"
    assert error.committed is True
    assert error.outcome == "unconfirmed"
    assert error.pointer_generation == str(Blob.objects["pax-vault/current.json"].generation)
    if failure_stage == "checksum":
        assert isinstance(error.__cause__, ValueError)
        assert "CRC32C" in str(error.__cause__)
    else:
        assert error.__cause__ is failure
    assert "private@example.test" not in str(error)
    assert "transient pointer readback detail" not in str(error)


def test_pointer_reports_successful_write_superseded_before_readback(tmp_path):
    reset()
    publisher = GcsPublisher(Storage(), settings(tmp_path))
    release, digest = _release(publisher, "superseded")
    Blob.supersede_pointer = True
    with pytest.raises(PointerConflictError, match="superseded") as caught:
        publisher.commit_pointer("superseded", release, digest, "superseded", "revision", "2026-09-01T00:02:00Z")
    assert caught.value.committed is True


def test_rollback_requires_retained_release_and_preserves_high_water(tmp_path):
    reset()
    publisher = GcsPublisher(Storage(), settings(tmp_path))
    release1, digest1 = _release(publisher, "run-1")
    first = publisher.commit_pointer("run-1", release1, digest1, "run-1", "revision", "2026-09-01T00:02:00Z")
    release2, digest2 = _release(publisher, "run-2")
    second = publisher.commit_pointer("run-2", release2, digest2, "run-2", "revision", "2026-09-01T00:03:00Z")
    assert second["publicationOutcome"] == "committed"
    rolled = publisher.rollback_pointer(
        "run-1",
        expected_generation=str(Blob.objects["pax-vault/current.json"].generation),
        source_order="caller-cannot-choose-this-order",
        created_at="then",
    )
    assert rolled["releaseSequence"] == second["releaseSequence"] + 1
    assert rolled["sourceHighWaterOrder"] == "run-2"
    assert rolled["sourceOrder"] == "run-1"
    assert rolled["prefix"].endswith("/run-1/")
    assert rolled["createdAtUtc"] == "2026-09-01T00:02:00Z"
    assert rolled["producerRevision"] == "pipeline-abc"
    assert first["releaseSequence"] == 1
    restored = publisher.rollback_pointer(
        "run-2",
        expected_generation=str(Blob.objects["pax-vault/current.json"].generation),
        source_order="caller-cannot-choose-this-order",
    )
    assert restored["releaseSequence"] == rolled["releaseSequence"] + 1
    assert restored["sourceHighWaterOrder"] == "run-2"
    assert restored["publicationOutcome"] == "committed"


def test_rollback_rejects_malformed_retained_hash(tmp_path):
    reset()
    publisher = GcsPublisher(Storage(), settings(tmp_path))
    release1, digest1 = _release(publisher, "retain-1")
    publisher.commit_pointer("retain-1", release1, digest1, "retain-1", "revision", "2026-09-01T00:02:00Z")
    release2, digest2 = _release(publisher, "retain-2")
    publisher.commit_pointer("retain-2", release2, digest2, "retain-2", "revision", "2026-09-01T00:03:00Z")
    key = "pax-vault/current.json"
    stored = Blob.objects[key]
    pointer = json.loads(stored.content)
    del pointer["retainedPrevious"]["manifestSha256"]
    Blob.objects[key] = Stored(canonical_json_bytes(pointer), stored.generation)
    with pytest.raises(ValueError, match="retained pointer hash"):
        publisher.rollback_pointer("retain-1", expected_generation=str(stored.generation), source_order="ignored")
