from __future__ import annotations

import json
from pathlib import Path

import pytest
from google.api_core.exceptions import PreconditionFailed

from analytics.publication import BigQueryPublisher, GcsPublisher, PointerConflictError, publish
from analytics.settings import Settings


def settings(tmp_path: Path) -> Settings:
    extension_dir = tmp_path / "extensions"
    extension_dir.mkdir(exist_ok=True)
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
            "ANALYTICS_GCS_PREFIX": "gs://analytics-nonprod/parquets/pv_regions",
            "ANALYTICS_BIGQUERY_TABLE": "f3data.paxVaultDuckStaging.pv_regions",
        }
    )


class Blob:
    generation_counter = 0
    objects = {}

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
        self.generation = Blob.generation_counter
        self.size = len(value)
        self.crc32c = "crc"
        self.content = value
        Blob.objects[self.name] = self

    def reload(self):
        current = Blob.objects.get(self.name)
        if current is None:
            from google.api_core.exceptions import NotFound

            raise NotFound("missing")
        self.__dict__.update(current.__dict__)


class Bucket:
    def blob(self, name):
        return Blob(name)


class Storage:
    def bucket(self, name):
        return Bucket()


class Job:
    def result(self):
        return None


class BigQuery:
    def __init__(self, order):
        self.order = order
        self.query_text = ""

    def query(self, query):
        self.order.append("bigquery")
        self.query_text = query
        return Job()


def test_publication_orders_bigquery_before_pointer_and_emits_manifest(tmp_path):
    Blob.objects.clear()
    order = []
    bq = BigQuery(order)
    gcs = GcsPublisher(Storage(), settings(tmp_path))
    original = gcs.advance_current
    gcs.advance_current = lambda *args, **kwargs: (order.append("pointer"), original(*args, **kwargs))[1]
    parquet = tmp_path / "regions.parquet"
    parquet.write_bytes(b"parquet")
    status = publish(gcs, BigQueryPublisher(bq, settings(tmp_path)), "run-1", parquet, 2, "source", "published")
    assert order == ["bigquery", "pointer"]
    assert status.manifest["objects"][0]["uri"].endswith("run-1/regions.parquet")
    assert status.manifest["committed_run_prefix"].endswith("run-1")
    assert status.manifest["file_count"] == 1
    assert status.manifest["byte_count"] == 7
    stored_manifest = json.loads(Blob.objects["parquets/pv_regions/run-1/manifest.json"].content)
    assert stored_manifest["row_count"] == 2
    assert "manifest_uri" not in stored_manifest
    assert "CREATE OR REPLACE EXTERNAL TABLE `f3data.paxVaultDuckStaging.pv_regions`" in bq.query_text


def test_publication_emits_fixed_phase_events_with_safe_counts(tmp_path):
    Blob.objects.clear()
    events = []
    gcs = GcsPublisher(Storage(), settings(tmp_path))
    bq = BigQueryPublisher(BigQuery([]), settings(tmp_path))
    parquet = tmp_path / "regions.parquet"
    parquet.write_bytes(b"parquet")
    publish(
        gcs,
        bq,
        "run-events",
        parquet,
        4,
        "source",
        "published",
        emit=lambda event, context: events.append((event, context)),
    )
    assert [event for event, _ in events] == [
        "analytics.etl.gcs_committed",
        "analytics.etl.bigquery_updated",
        "analytics.etl.pointer_advanced",
    ]
    assert events[0][1]["run_id"] == "run-events"
    assert events[0][1]["file_count"] == 1
    assert events[0][1]["byte_count"] == 7
    assert events[0][1]["duration_ms"] >= 0


def test_bigquery_failure_does_not_advance_pointer(tmp_path):
    Blob.objects.clear()
    order = []

    class FailingBigQuery(BigQuery):
        def query(self, query):
            self.order.append("bigquery")
            raise RuntimeError("query failed")

    gcs = GcsPublisher(Storage(), settings(tmp_path))
    parquet = tmp_path / "regions.parquet"
    parquet.write_bytes(b"parquet")
    with pytest.raises(RuntimeError):
        publish(
            gcs,
            BigQueryPublisher(FailingBigQuery(order), settings(tmp_path)),
            "run-2",
            parquet,
            1,
            "source",
            "published",
        )
    assert "parquets/pv_regions/current.json" not in Blob.objects


def test_pointer_conflict_is_observable(tmp_path):
    Blob.objects.clear()
    gcs = GcsPublisher(Storage(), settings(tmp_path))
    parquet = tmp_path / "regions.parquet"
    parquet.write_bytes(b"parquet")

    def conflict(*args, **kwargs):
        raise PreconditionFailed("conflict")

    gcs.advance_current = conflict
    with pytest.raises(PointerConflictError) as raised:
        publish(gcs, BigQueryPublisher(BigQuery([]), settings(tmp_path)), "run-3", parquet, 1, "source", "published")
    assert raised.value.metadata["run_id"] == "run-3"
    assert raised.value.metadata["stage"] == "pointer_update"
    assert raised.value.metadata["parquet_uri"].endswith("run-3/regions.parquet")
    assert set(raised.value.metadata) == {
        "stage",
        "run_id",
        "parquet_uri",
        "parquet_generation",
        "manifest_uri",
        "manifest_generation",
        "expected_pointer_generation",
        "current_pointer_generation",
        "bigquery_job_id",
    }


def test_complete_retry_realigns_bigquery_and_pointer(tmp_path):
    Blob.objects.clear()
    gcs = GcsPublisher(Storage(), settings(tmp_path))
    parquet = tmp_path / "regions.parquet"
    parquet.write_bytes(b"parquet")
    original = gcs.advance_current
    attempts = [True]

    def conflict_once(*args, **kwargs):
        if attempts:
            attempts.pop()
            raise PreconditionFailed("conflict")
        return original(*args, **kwargs)

    gcs.advance_current = conflict_once
    bq = BigQuery([])
    with pytest.raises(PointerConflictError):
        publish(gcs, BigQueryPublisher(bq, settings(tmp_path)), "run-4a", parquet, 1, "source", "published")
    status = publish(gcs, BigQueryPublisher(bq, settings(tmp_path)), "run-4b", parquet, 1, "source", "published")
    pointer = json.loads(Blob.objects["parquets/pv_regions/current.json"].content)
    assert pointer["manifest_uri"] == status.manifest_object.uri
    assert bq.query_text.endswith("run-4b/regions.parquet'])")
