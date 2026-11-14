from __future__ import annotations

import base64
import io
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

import google.cloud.storage
import google_crc32c
import pytest
from google.api_core.exceptions import NotFound, PreconditionFailed

import analytics.cli as cli
from analytics.publication import canonical_json_bytes
from analytics.release_gc import PointerMovedError, ReleaseGarbageCollector, ReleaseGcError
from analytics.settings import PointerSettings

BUCKET = "f3-analytics-nonprod"
NOW = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)
POINTER = "analytics/current.json"


class Stored:
    def __init__(self, content: bytes, generation: int, created: datetime):
        self.content = content
        self.generation = generation
        self.size = len(content)
        self.time_created = created
        checksum = google_crc32c.Checksum()
        checksum.update(content)
        self.crc32c = base64.b64encode(checksum.digest()).decode()


class FakeGcs:
    """In-memory bucket with generation preconditions on reads and deletes."""

    def __init__(self) -> None:
        self.objects: dict[str, Stored] = {}
        self.next_generation = 100
        self.deleted: list[str] = []
        self.before_delete: Any = None

    def put(self, name: str, content: bytes = b"x", *, created: datetime = NOW) -> None:
        self.next_generation += 1
        self.objects[name] = Stored(content, self.next_generation, created)

    def bucket(self, name: str) -> FakeBucket:
        assert name == BUCKET
        return FakeBucket(self)

    def list_blobs(self, _bucket: FakeBucket, *, prefix: str):
        for name in sorted(self.objects):
            if name.startswith(prefix):
                stored = self.objects[name]
                yield SimpleNamespace(
                    name=name, generation=stored.generation, size=stored.size, time_created=stored.time_created
                )


class FakeBucket:
    def __init__(self, gcs: FakeGcs):
        self.gcs = gcs

    def blob(self, name: str) -> FakeBlob:
        return FakeBlob(self.gcs, name)


class FakeBlob:
    def __init__(self, gcs: FakeGcs, name: str):
        self.gcs = gcs
        self.name = name

    def reload(self) -> None:
        if self.name not in self.gcs.objects:
            raise NotFound("missing")

    def __getattr__(self, key: str) -> Any:
        return getattr(self.gcs.objects[self.name], key)

    def open(self, mode: str, *, if_generation_match: int):
        assert mode == "rb"
        stored = self.gcs.objects[self.name]
        if stored.generation != if_generation_match:
            raise PreconditionFailed("generation mismatch")
        return io.BytesIO(stored.content)

    def delete(self, *, if_generation_match: int) -> None:
        if self.gcs.before_delete is not None:
            self.gcs.before_delete(self.name)
        stored = self.gcs.objects.get(self.name)
        if stored is None:
            raise NotFound("missing")
        if stored.generation != if_generation_match:
            raise PreconditionFailed("generation mismatch")
        del self.gcs.objects[self.name]
        self.gcs.deleted.append(self.name)


def put_release(gcs: FakeGcs, release_id: str, *, age_days: float) -> None:
    created = NOW - timedelta(days=age_days)
    base = f"analytics/releases/{release_id}"
    for name in ("release.json", "event_info/manifest.json", "event_info/partitions/part-0.parquet"):
        gcs.put(f"{base}/{name}", created=created)


def put_pointer(gcs: FakeGcs, current: str, retained: str | None) -> None:
    def ref(release_id: str) -> dict[str, Any]:
        return {
            "releaseId": release_id,
            "manifestUri": f"gs://{BUCKET}/analytics/releases/{release_id}/release.json",
            "manifestGeneration": "1",
            "manifestSha256": "a" * 64,
        }

    pointer = {
        **ref(current),
        "contractVersion": "analytics-release.v1",
        "schemaVersion": "analytics-release.v1",
        "prefix": f"gs://{BUCKET}/analytics/releases/{current}/",
        "createdAtUtc": "2026-11-01T00:00:00Z",
        "producerRevision": "revision",
        "releaseSequence": 5,
        "sourceOrder": current,
        "sourceHighWaterOrder": current,
        "retainedPrevious": ref(retained) if retained else None,
    }
    gcs.put(POINTER, canonical_json_bytes(pointer))


def collector(gcs: FakeGcs) -> ReleaseGarbageCollector:
    settings = PointerSettings("test", BUCKET)
    return ReleaseGarbageCollector(gcs, settings, product="analytics")  # type: ignore[arg-type]


def release_ids(gcs: FakeGcs) -> set[str]:
    return {name.split("/")[2] for name in gcs.objects if name.startswith("analytics/releases/")}


@pytest.fixture
def gcs() -> FakeGcs:
    store = FakeGcs()
    # Daily publishes that stopped 30 days ago: the pointer chain is older than every cutoff.
    for day in range(30, 60):
        put_release(store, f"r{day:03d}", age_days=day)
    put_pointer(store, current="r030", retained="r031")
    return store


def test_plan_never_selects_pointer_referenced_releases_even_when_old(gcs):
    plan = collector(gcs).plan(now=NOW, min_age=timedelta(days=7), keep_latest=0)

    candidate_ids = {item.release_id for item in plan.candidates}
    assert plan.protected == ("r030", "r031")
    assert "r030" not in candidate_ids and "r031" not in candidate_ids
    assert len(candidate_ids) == 28


def test_plan_keeps_latest_unprotected_and_young_releases(gcs):
    put_release(gcs, "inflight", age_days=0.1)
    put_release(gcs, "r010", age_days=10)

    plan = collector(gcs).plan(now=NOW, min_age=timedelta(days=14), keep_latest=2)

    assert plan.kept_recent == ("inflight", "r010")
    assert {item.release_id for item in plan.candidates} == {f"r{day:03d}" for day in range(32, 60)}


def test_release_is_young_if_any_object_is_young(gcs):
    put_release(gcs, "mixed", age_days=40)
    gcs.put("analytics/releases/mixed/late/manifest.json", created=NOW - timedelta(hours=1))

    plan = collector(gcs).plan(now=NOW, min_age=timedelta(days=7), keep_latest=0)

    assert "mixed" in plan.kept_young
    assert "mixed" not in {item.release_id for item in plan.candidates}


def test_plan_orders_release_manifest_first_and_caps_oldest_first(gcs):
    plan = collector(gcs).plan(now=NOW, min_age=timedelta(days=7), keep_latest=0, max_releases=3)

    assert [item.release_id for item in plan.candidates] == ["r059", "r058", "r057"]
    assert all(item.objects[0].name.endswith("/release.json") for item in plan.candidates)
    assert len(plan.deferred) == 25


def test_plan_ignores_objects_outside_release_prefixes(gcs):
    gcs.put("analytics/releases/stray.txt", created=NOW - timedelta(days=90))
    gcs.put("analytics/releases/../escape/x", created=NOW - timedelta(days=90))

    plan = collector(gcs).plan(now=NOW, min_age=timedelta(days=7), keep_latest=0)

    assert plan.ignored_object_count == 2


def test_dry_run_plan_deletes_nothing(gcs):
    before = dict(gcs.objects)

    collector(gcs).plan(now=NOW, min_age=timedelta(days=7), keep_latest=0)

    assert gcs.objects == before


def test_apply_deletes_only_candidates_and_preserves_pointer_chain(gcs):
    gc = collector(gcs)
    result = gc.apply(gc.plan(now=NOW, min_age=timedelta(days=7), keep_latest=1))

    assert release_ids(gcs) == {"r030", "r031", "r032"}
    assert POINTER in gcs.objects
    assert len(result.deleted_release_ids) == 27
    assert result.deleted_object_count == 27 * 3


@pytest.mark.parametrize(
    ("setup", "message"),
    [
        (lambda store: store.objects.pop(POINTER), "absent"),
        (lambda store: store.objects.pop("analytics/releases/r031/release.json"), "already missing"),
    ],
)
def test_plan_refuses_when_pointer_or_referenced_release_is_missing(gcs, setup, message):
    setup(gcs)

    with pytest.raises(ReleaseGcError, match=message):
        collector(gcs).plan(now=NOW, min_age=timedelta(days=7))


def test_plan_refuses_malformed_pointer(gcs):
    gcs.put(POINTER, b'{"releaseId":"r030"}')

    with pytest.raises(ValueError):
        collector(gcs).plan(now=NOW, min_age=timedelta(days=7))


def test_plan_rejects_min_age_below_in_flight_floor(gcs):
    with pytest.raises(ValueError, match="floor"):
        collector(gcs).plan(now=NOW, min_age=timedelta(hours=12))


def test_apply_stops_when_pointer_moves(gcs):
    gc = collector(gcs)
    plan = gc.plan(now=NOW, min_age=timedelta(days=7), keep_latest=0)
    moved = False

    def move_pointer(_name: str) -> None:
        nonlocal moved
        if not moved:
            moved = True
            put_pointer(gcs, current="r030", retained="r031")

    gcs.before_delete = move_pointer

    with pytest.raises(PointerMovedError):
        gc.apply(plan)
    # Only the first release (already past its pointer check) was touched.
    assert len(release_ids(gcs)) == 29


def test_apply_leaves_prefix_when_object_generation_changed(gcs):
    gc = collector(gcs)
    plan = gc.plan(now=NOW, min_age=timedelta(days=7), keep_latest=0, max_releases=1)
    target = plan.candidates[0].objects[1].name
    gcs.put(target, created=NOW - timedelta(days=90))

    result = gc.apply(plan)

    assert result.skipped_release_ids == ["r059"]
    assert target in gcs.objects


def test_cli_gc_releases_is_dry_run_unless_apply(monkeypatch, gcs):
    events: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setenv("ANALYTICS_ENVIRONMENT", "nonprod")
    monkeypatch.setenv("ANALYTICS_CATALOG_BUCKET", BUCKET)
    monkeypatch.setattr(
        cli,
        "JsonLogger",
        lambda: SimpleNamespace(
            info=lambda event, **context: events.append((event, context)),
            error=lambda event, *_args, **context: events.append((event, context)),
        ),
    )
    monkeypatch.setattr(cli, "utc_now", lambda: NOW)
    monkeypatch.setattr(google.cloud.storage, "Client", lambda: gcs)
    argv = ["analytics-etl", "gc-releases", "--product", "analytics", "--min-age-days", "7"]

    monkeypatch.setattr(sys, "argv", argv)
    assert cli.main() == 0
    assert [event for event, _ in events] == ["analytics.etl.release_gc_planned"]
    assert events[0][1]["apply"] is False
    assert len(release_ids(gcs)) == 30

    monkeypatch.setattr(sys, "argv", [*argv, "--apply"])
    assert cli.main() == 0
    assert events[-1][0] == "analytics.etl.release_gc_applied"
    assert release_ids(gcs) == {"r030", "r031", "r032", "r033", "r034"}
