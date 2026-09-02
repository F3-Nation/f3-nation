from __future__ import annotations

import io
import json
from datetime import datetime, timedelta, timezone
from typing import Any, ClassVar

import pytest
from google.api_core.exceptions import NotFound, PreconditionFailed

import analytics.pipeline as pipeline_module
from analytics.lease import GcsLease, LeaseActiveError, LeaseConflictError
from analytics.logging import JsonLogger
from analytics.materializations import MATERIALIZATION_REGISTRY
from analytics.pipeline import BatchRunError, run
from analytics.settings import Settings


class LeaseBlob:
    objects = {}
    next_generation = 0
    hooks: ClassVar[dict[str, Any]] = {"before_upload": None}

    def __init__(self, name):
        self.name = name

    def reload(self):
        if self.name not in self.objects:
            raise NotFound("missing")
        self.__dict__.update(self.objects[self.name].__dict__)

    def download_as_text(self):
        return self.content.decode()

    def upload_from_string(self, content, **kwargs):
        hook = type(self).hooks["before_upload"]
        type(self).hooks["before_upload"] = None
        if hook is not None:
            hook()
        actual = self.objects.get(self.name)
        actual_generation = 0 if actual is None else actual.generation
        if actual_generation != kwargs["if_generation_match"]:
            raise PreconditionFailed("lease generation conflict")
        type(self).next_generation += 1
        self.generation = type(self).next_generation
        self.content = content
        self.crc32c = "crc"
        self.size = len(content)
        self.objects[self.name] = self


class LeaseBucket:
    def blob(self, name):
        return LeaseBlob(name)


class LeaseStorage:
    def bucket(self, name):
        return LeaseBucket()


def make_settings(tmp_path):
    extension_dir = tmp_path / "extensions"
    extension_dir.mkdir()
    extension = extension_dir / "postgres_scanner.duckdb_extension"
    extension.touch()
    return Settings.from_env(
        {
            "ANALYTICS_ENVIRONMENT": "nonprod",
            "DUCKDB_EXTENSION_DIR": str(extension_dir),
            "DUCKDB_POSTGRES_EXTENSION_PATH": str(extension),
            "ANALYTICS_POSTGRES_SOCKET_DIR": "/cloudsql/f3data:us-central1:f3data-nonprod",
            "ANALYTICS_POSTGRES_USER": "analytics",
            "ANALYTICS_POSTGRES_PASSWORD": "password",
            "ANALYTICS_POSTGRES_DATABASE": "f3_staging",
        }
    )


def test_lease_acquire_rejects_active_and_takes_over_expired(tmp_path):
    LeaseBlob.objects.clear()
    LeaseBlob.next_generation = 0
    LeaseBlob.hooks["before_upload"] = None
    storage = LeaseStorage()
    settings = make_settings(tmp_path)
    lease = GcsLease(storage, settings, MATERIALIZATION_REGISTRY["pv_regions"])
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    first = lease.acquire(settings, "run-a", {"job": "job", "execution": "exec"}, now)
    with pytest.raises(LeaseActiveError):
        lease.acquire(settings, "run-b", {}, now + timedelta(minutes=1))
    taken_over = lease.acquire(settings, "run-b", {}, now + timedelta(minutes=91))
    assert taken_over.generation != first.generation
    payload = json.loads(LeaseBlob.objects["parquets/pv_regions/lease.json"].content)
    assert payload["run_id"] == "run-b"
    assert payload["state"] == "active"


def test_first_lease_acquire_race_reports_lease_acquire_conflict(tmp_path):
    LeaseBlob.objects.clear()
    LeaseBlob.next_generation = 0
    LeaseBlob.hooks["before_upload"] = None
    settings = make_settings(tmp_path)
    first = GcsLease(LeaseStorage(), settings, MATERIALIZATION_REGISTRY["pv_regions"])
    winner = GcsLease(LeaseStorage(), settings, MATERIALIZATION_REGISTRY["pv_regions"])

    def win_first_acquire():
        winner.acquire(settings, "winning-run", {}, datetime(2026, 1, 1, tzinfo=timezone.utc))

    LeaseBlob.hooks["before_upload"] = win_first_acquire
    with pytest.raises(LeaseConflictError) as raised:
        first.acquire(settings, "losing-run", {}, datetime(2026, 1, 1, tzinfo=timezone.utc))

    assert raised.value.metadata["stage"] == "lease_acquire"


def test_expired_lease_takeover_race_reports_lease_acquire_conflict(tmp_path):
    LeaseBlob.objects.clear()
    LeaseBlob.next_generation = 0
    LeaseBlob.hooks["before_upload"] = None
    settings = make_settings(tmp_path)
    first = GcsLease(LeaseStorage(), settings, MATERIALIZATION_REGISTRY["pv_regions"])
    winner = GcsLease(LeaseStorage(), settings, MATERIALIZATION_REGISTRY["pv_regions"])
    first.acquire(settings, "expired-run", {}, datetime(2026, 1, 1, tzinfo=timezone.utc))
    after_expiry = datetime(2026, 1, 1, 2, 31, tzinfo=timezone.utc)

    def win_expired_takeover():
        winner.acquire(settings, "winning-run", {}, after_expiry)

    LeaseBlob.hooks["before_upload"] = win_expired_takeover
    with pytest.raises(LeaseConflictError) as raised:
        first.acquire(
            settings,
            "takeover-run",
            {},
            after_expiry,
        )

    assert raised.value.metadata["stage"] == "lease_acquire"


def test_lease_release_is_conditional_state_update_not_delete(tmp_path):
    LeaseBlob.objects.clear()
    LeaseBlob.next_generation = 0
    settings = make_settings(tmp_path)
    lease = GcsLease(LeaseStorage(), settings, MATERIALIZATION_REGISTRY["pv_regions"])
    handle = lease.acquire(settings, "run-a", {}, datetime(2026, 1, 1, tzinfo=timezone.utc))
    released = lease.release(handle, datetime(2026, 1, 1, 1, tzinfo=timezone.utc))
    payload = json.loads(LeaseBlob.objects["parquets/pv_regions/lease.json"].content)
    assert released.generation != handle.generation
    assert payload["state"] == "released"
    assert "released_at" in payload


def test_active_lease_rejection_happens_before_source_connection(tmp_path):
    LeaseBlob.objects.clear()
    LeaseBlob.next_generation = 0
    settings = make_settings(tmp_path)
    lease = GcsLease(LeaseStorage(), settings, MATERIALIZATION_REGISTRY["pv_regions"])
    lease.acquire(settings, "existing", {}, datetime.now(timezone.utc))
    called = []

    def connection_factory(_settings):
        called.append(True)
        raise AssertionError("source connection must not be opened")

    with pytest.raises(BatchRunError) as raised:
        run(
            settings,
            LeaseStorage(),
            connection_factory=connection_factory,
            run_id="blocked",
            materializations=("pv_regions",),
        )
    assert isinstance(raised.value.failures["pv_regions"], LeaseActiveError)
    assert called == []


def test_cleanup_failures_are_logged_without_masking_primary_failure(monkeypatch, tmp_path):
    LeaseBlob.objects.clear()
    LeaseBlob.next_generation = 0
    settings = make_settings(tmp_path)
    stream = io.StringIO()
    logger = JsonLogger(stream=stream)

    class BrokenConnection:
        def close(self):
            raise RuntimeError("close failed")

    monkeypatch.setattr(pipeline_module, "attach_postgres", lambda connection, settings: None)

    def fail_materialize(*args):
        raise ValueError("source failed")

    def fail_release(*args):
        raise RuntimeError("release failed")

    monkeypatch.setattr(pipeline_module, "materialize", fail_materialize)
    monkeypatch.setattr(pipeline_module.GcsLease, "release", fail_release)
    with pytest.raises(BatchRunError) as raised:
        run(
            settings,
            LeaseStorage(),
            connection_factory=lambda _settings: BrokenConnection(),
            logger=logger,
            run_id="cleanup-run",
            materializations=("pv_regions",),
        )
    assert isinstance(raised.value.failures["pv_regions"], ValueError)
    assert str(raised.value.failures["pv_regions"]) == "source failed"
    records = [json.loads(line) for line in stream.getvalue().splitlines()]
    cleanup_records = [
        record
        for record in records
        if record["event"]
        in {
            "analytics.etl.connection_close_failed",
            "analytics.etl.lease_release_failed",
        }
    ]
    assert {record["context"]["cleanup"] for record in cleanup_records} == {"connection_close", "lease_release"}
    assert raised.value.cleanup_failures["pv_regions"].keys() == {"connection_close", "lease_release"}
    assert any(record["event"] == "analytics.etl.failed" for record in records)
