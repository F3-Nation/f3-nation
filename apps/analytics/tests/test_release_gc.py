from __future__ import annotations

import base64
import io
import json
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

import google.cloud.storage
import google_crc32c
import pytest
from google.api_core.exceptions import NotFound, PreconditionFailed, RetryError, TooManyRequests

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

    # Young prefixes are kept by age and never use a keep-latest slot.
    assert set(plan.kept_young) == {"inflight", "r010"}
    assert plan.kept_recent == ("r032", "r033")
    assert {item.release_id for item in plan.candidates} == {f"r{day:03d}" for day in range(34, 60)}


def test_keep_latest_skips_young_and_incomplete_prefixes(gcs):
    for index in range(3):
        gcs.put(f"analytics/releases/failed{index}/event_info/manifest.json", created=NOW - timedelta(days=1 + index))

    plan = collector(gcs).plan(now=NOW, min_age=timedelta(days=7), keep_latest=1)

    assert plan.kept_recent == ("r032",)
    assert "r032" not in {item.release_id for item in plan.candidates}
    assert set(plan.kept_young) == {"failed0", "failed1", "failed2"}


def test_keep_latest_never_spends_a_slot_on_an_old_incomplete_prefix(gcs):
    gcs.put("analytics/releases/failed/event_info/manifest.json", created=NOW - timedelta(days=20))

    plan = collector(gcs).plan(now=NOW, min_age=timedelta(days=7), keep_latest=1)

    assert plan.kept_recent == ("r032",)
    assert "failed" in {item.release_id for item in plan.candidates}


def test_plan_handles_pointer_without_retained_previous(gcs):
    put_pointer(gcs, current="r030", retained=None)

    plan = collector(gcs).plan(now=NOW, min_age=timedelta(days=7), keep_latest=0)

    assert plan.protected == ("r030",)
    assert "r031" in {item.release_id for item in plan.candidates}


def test_plan_treats_object_exactly_min_age_old_as_old(gcs):
    put_release(gcs, "edge", age_days=7)

    plan = collector(gcs).plan(now=NOW, min_age=timedelta(days=7), keep_latest=0)

    assert "edge" in {item.release_id for item in plan.candidates}


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
    gcs.put("analytics/releases/r040/", created=NOW - timedelta(days=90))

    plan = collector(gcs).plan(now=NOW, min_age=timedelta(days=7), keep_latest=0)

    assert plan.ignored_object_count == 3


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
        (lambda store: store.objects.pop("analytics/releases/r030/release.json"), "already missing"),
    ],
)
def test_plan_refuses_when_pointer_or_referenced_release_is_missing(gcs, setup, message):
    setup(gcs)

    with pytest.raises(ReleaseGcError, match=message):
        collector(gcs).plan(now=NOW, min_age=timedelta(days=7))


@pytest.mark.parametrize(
    "overrides",
    [
        {"now": NOW.replace(tzinfo=None)},
        {"now": NOW, "keep_latest": -1},
        {"now": NOW, "max_releases": 0},
    ],
)
def test_plan_rejects_invalid_arguments(gcs, overrides):
    with pytest.raises(ValueError):
        collector(gcs).plan(min_age=timedelta(days=7), **overrides)


def test_plan_refuses_malformed_pointer(gcs):
    gcs.put(POINTER, b'{"releaseId":"r030"}')

    with pytest.raises(ValueError):
        collector(gcs).plan(now=NOW, min_age=timedelta(days=7))


def test_plan_refuses_pointer_with_non_string_retained_release_id(gcs):
    put_release(gcs, "123", age_days=40)
    pointer = gcs.objects[POINTER]
    data = json.loads(pointer.content)
    data["retainedPrevious"] = {
        "releaseId": 123,
        "manifestUri": f"gs://{BUCKET}/analytics/releases/123/release.json",
        "manifestGeneration": "1",
        "manifestSha256": "a" * 64,
    }
    gcs.put(POINTER, canonical_json_bytes(data))

    with pytest.raises(ValueError, match="retained pointer metadata"):
        collector(gcs).plan(now=NOW, min_age=timedelta(days=7), keep_latest=0)
    assert "123" in release_ids(gcs)


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

    with pytest.raises(PointerMovedError) as raised:
        gc.apply(plan)
    # Only the first release (already past its pointer check) was touched.
    assert len(release_ids(gcs)) == 29
    assert raised.value.reason == "pointer_moved"
    assert raised.value.partial is not None
    assert raised.value.partial.deleted_release_ids == ["r059"]
    assert raised.value.partial.in_progress_release_id is None


def test_apply_reports_pointer_disappearing_as_needing_a_human(gcs):
    gc = collector(gcs)
    plan = gc.plan(now=NOW, min_age=timedelta(days=7), keep_latest=0)

    def drop_pointer(_name: str) -> None:
        gcs.objects.pop(POINTER, None)

    gcs.before_delete = drop_pointer

    with pytest.raises(ReleaseGcError, match="disappeared") as raised:
        gc.apply(plan)
    assert not isinstance(raised.value, PointerMovedError)
    assert raised.value.reason == "pointer_disappeared"


@pytest.mark.parametrize(
    "error",
    (TooManyRequests("throttled"), RetryError("retry deadline exceeded", cause=TooManyRequests("throttled"))),
    ids=("api_call_error", "retry_deadline"),
)
def test_apply_attaches_partial_result_on_storage_error(gcs, error):
    gc = collector(gcs)
    plan = gc.plan(now=NOW, min_age=timedelta(days=7), keep_latest=0)
    calls = 0

    def fail_fifth_delete(_name: str) -> None:
        nonlocal calls
        calls += 1
        if calls == 5:
            raise error

    gcs.before_delete = fail_fifth_delete

    with pytest.raises(ReleaseGcError) as raised:
        gc.apply(plan)
    assert raised.value.reason == "storage_error"
    assert raised.value.partial is not None
    assert raised.value.partial.deleted_release_ids == ["r059"]
    assert raised.value.partial.deleted_object_count == 4
    assert raised.value.partial.in_progress_release_id == "r058"


def test_apply_counts_already_absent_objects_and_finishes_the_release(gcs):
    gc = collector(gcs)
    plan = gc.plan(now=NOW, min_age=timedelta(days=7), keep_latest=0, max_releases=1)
    gcs.objects.pop(plan.candidates[0].objects[1].name)

    result = gc.apply(plan)

    assert result.already_absent_count == 1
    assert result.deleted_object_count == 2
    assert result.deleted_release_ids == ["r059"]
    assert "r059" not in release_ids(gcs)


def test_apply_leaves_prefix_when_object_generation_changed(gcs):
    gc = collector(gcs)
    plan = gc.plan(now=NOW, min_age=timedelta(days=7), keep_latest=0, max_releases=1)
    target = plan.candidates[0].objects[1].name
    gcs.put(target, created=NOW - timedelta(days=90))

    result = gc.apply(plan)

    assert result.skipped_release_ids == ["r059"]
    assert target in gcs.objects
    assert result.deleted_release_ids == []
    assert "analytics/releases/r059/event_info/partitions/part-0.parquet" in gcs.objects
    assert gcs.deleted == ["analytics/releases/r059/release.json"]


GC_ARGV = ["analytics-etl", "gc-releases", "--product", "analytics", "--min-age-days", "7"]


@pytest.fixture
def cli_events(monkeypatch, gcs) -> list[tuple[str, dict[str, Any]]]:
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
    return events


def test_cli_gc_releases_is_dry_run_unless_apply(monkeypatch, gcs, cli_events):
    events = cli_events
    argv = GC_ARGV

    monkeypatch.setattr(sys, "argv", argv)
    assert cli.main() == 0
    assert [event for event, _ in events] == ["analytics.etl.release_gc_planned"]
    assert events[0][1]["apply"] is False
    assert len(release_ids(gcs)) == 30

    monkeypatch.setattr(sys, "argv", [*argv, "--apply"])
    assert cli.main() == 0
    assert events[-1][0] == "analytics.etl.release_gc_applied"
    assert release_ids(gcs) == {"r030", "r031", "r032", "r033", "r034"}


def test_cli_gc_releases_exits_1_when_a_prefix_is_skipped(monkeypatch, gcs, cli_events):
    rewritten = False

    def rewrite_once(_name: str) -> None:
        nonlocal rewritten
        if not rewritten:
            rewritten = True
            gcs.put("analytics/releases/r059/event_info/manifest.json", created=NOW - timedelta(days=90))

    gcs.before_delete = rewrite_once
    monkeypatch.setattr(sys, "argv", [*GC_ARGV, "--apply"])

    assert cli.main() == 1
    event, context = cli_events[-1]
    assert event == "analytics.etl.release_gc_applied"
    assert context["skipped_release_ids"] == ["r059"]


def test_cli_gc_releases_logs_what_a_stopped_run_deleted(monkeypatch, gcs, cli_events):
    moved = False

    def move_pointer(_name: str) -> None:
        nonlocal moved
        if not moved:
            moved = True
            put_pointer(gcs, current="r030", retained="r031")

    gcs.before_delete = move_pointer
    monkeypatch.setattr(sys, "argv", [*GC_ARGV, "--apply"])

    assert cli.main() == 1
    event, context = cli_events[-1]
    assert event == "analytics.etl.release_gc_stopped"
    assert context["reason"] == "pointer_moved"
    assert context["stop_type"] == "PointerMovedError"
    assert context["deleted_release_ids"] == ["r059"]
    assert context["in_progress_release_id"] is None


def test_cli_gc_releases_logs_refusal_reason_and_release(monkeypatch, gcs, cli_events):
    gcs.objects.pop("analytics/releases/r031/release.json")
    monkeypatch.setattr(sys, "argv", GC_ARGV)

    assert cli.main() == 1
    event, context = cli_events[-1]
    assert event == "analytics.etl.release_gc_refused"
    assert context == {"product": "analytics", "reason": "referenced_manifest_missing", "release_id": "r031"}


@pytest.mark.parametrize(
    "extra",
    [["--min-age-days", "0"], ["--keep-latest", "-1"], ["--max-releases", "0"]],
)
def test_cli_gc_releases_rejects_bad_arguments_as_usage_errors(monkeypatch, extra):
    monkeypatch.setattr(sys, "argv", ["analytics-etl", "gc-releases", "--product", "analytics", *extra])

    with pytest.raises(SystemExit) as raised:
        cli.main()
    assert raised.value.code == 2
