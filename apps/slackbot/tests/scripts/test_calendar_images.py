import os
import sys
import threading
from collections import namedtuple
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pandas as pd
import pytest
import pytz
from slack_sdk.errors import SlackApiError

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts import calendar_images
from scripts.calendar_images import _calendar_time_sort_key, _normalize_label_value, _prepare_calendar_labels


def v1_filename(region_id=1, week="current", timestamp="20260930T100000000000Z", fingerprint="a" * 64):
    return f"{region_id}-{week}-v1-{timestamp}-{fingerprint}-abcdefghij.png"


def image_metadata(settings, at, week="current"):
    metadata = calendar_images.parse_calendar_image_filename(
        settings[f"calendar_image_{week}"], 1, week, at.replace(tzinfo=UTC)
    )
    assert metadata is not None
    return metadata


INVALID_FILENAMES = [
    None,
    "",
    123,
    {},
    "invalid",
    "1-current.png",
    "2-current-abcdefghij.png",
    "1-next-abcdefghij.png",
    v1_filename(region_id=0),
    v1_filename(region_id=-1),
    v1_filename(region_id="01"),
    v1_filename(region_id=2),
    v1_filename(week="next"),
    v1_filename(week="fourth"),
    v1_filename().replace("-v1-", "-v2-"),
    v1_filename(timestamp="20260931T100000000000Z"),
    v1_filename(timestamp="20261301T100000000000Z"),
    v1_filename(timestamp="00000930T100000000000Z"),
    v1_filename(timestamp="20260930T240000000000Z"),
    v1_filename(timestamp="20260930T100000000001Z"),
    v1_filename(timestamp="20260930T10000000000Z"),
    v1_filename(timestamp="20260930T100000000000+00:00"),
    v1_filename(fingerprint="a" * 63),
    v1_filename(fingerprint="a" * 65),
    v1_filename(fingerprint="A" * 64),
    v1_filename(fingerprint="g" * 64),
    v1_filename().replace("abcdefghij", "abcdefghi"),
    v1_filename().replace("abcdefghij", "abcdefghijk"),
    v1_filename().replace("abcdefghij", "Abcdefghij"),
    v1_filename().replace("abcdefghij", "abcdefghi1"),
    v1_filename().replace(".png", ".jpg"),
    v1_filename() + "\n",
    " " + v1_filename(),
    "../" + v1_filename(),
    "..\\" + v1_filename(),
    "/mnt/calendar-images/" + v1_filename(),
    "https://storage.googleapis.com/f3nation-calendar-images/" + v1_filename(),
]


@pytest.mark.parametrize("region_id", [1, 2147483647])
@pytest.mark.parametrize("week", ["current", "next", "third"])
def test_v1_filename_metadata_round_trip(region_id, week):
    query_start = datetime(2026, 9, 30, 10, 23, 45, 123456, tzinfo=UTC)
    fingerprint = "0123456789abcdef" * 4
    filename = v1_filename(region_id, week, "20260930T102345123456Z", fingerprint)
    assert calendar_images.parse_calendar_image_filename(filename, region_id, week, query_start) == (
        query_start,
        fingerprint,
    )
    assert calendar_images.calendar_image_is_safe_to_delete(filename, region_id, week, query_start)


@pytest.mark.parametrize("filename", INVALID_FILENAMES)
def test_invalid_filename_cannot_establish_freshness_or_authorize_deletion(filename):
    query_start = datetime(2026, 9, 30, 10, tzinfo=UTC)
    assert calendar_images.parse_calendar_image_filename(filename, 1, "current", query_start) is None
    assert not calendar_images.calendar_image_is_safe_to_delete(filename, 1, "current", query_start)


def test_legacy_filename_can_be_deleted_but_has_no_freshness_metadata():
    query_start = datetime(2026, 9, 30, 10, tzinfo=UTC)
    legacy = "1-current-abcdefghij.png"
    assert calendar_images.parse_calendar_image_filename(legacy, 1, "current", query_start) is None
    assert calendar_images.calendar_image_is_safe_to_delete(legacy, 1, "current", query_start)


def test_normalize_label_value_supports_nullable_mixed_values_without_float_suffixes():
    values = [530, 530.0, float("nan"), None, "Q 1"]

    normalized = [_normalize_label_value(value) for value in values]

    assert normalized == ["530", "530", "", "", "Q 1"]
    label = normalized[4] + "\n" + normalized[4] + " " + normalized[0]
    assert label == "Q 1\nQ 1 530"


def test_prepare_calendar_labels_constructs_expected_label_branches():
    events = pd.DataFrame(
        {
            "start_time": [530.0, 615.0, 700.0, 745.0, 800.0],
            "q_name": [None, "Q Alpha", "Q Bravo", "Q Charlie", "Q PAX"],
            "event_acronym": ["EC", "EC", "EC", "EC", "EC"],
            "event_tag": [None, None, "Special", "Tagged", None],
            "pax_count": [None, None, None, 12.0, 8.0],
            "ao_name": ["AO"] * 5,
            "ao_description": [None] * 5,
            "location_name": [None] * 5,
            "location_description": [None] * 5,
            "location_address_street": [None] * 5,
        }
    )

    _prepare_calendar_labels(events)

    assert events["event_time"].tolist() == ["0530", "0615", "0700", "0745", "0800"]
    assert events["label"].tolist() == [
        "OPEN!\nEC 0530",
        "Q Alpha\nEC 0615",
        "Q Bravo\nSpecial\n0700",
        "Q Charlie\nTagged\nPAX: 12",
        "Q PAX\nPAX: 8",
    ]
    assert events["event_tag"].tolist() == ["", "", "Special", "Tagged", ""]
    assert events["ao_description"].isna().all()
    assert events["location_name"].isna().all()
    assert events["location_description"].isna().all()
    assert events["location_address_street"].isna().all()


def test_prepare_calendar_labels_preserves_preformatted_times_and_nullable_metadata():
    events = pd.DataFrame(
        {
            "start_time": ["0930", "1000", None],
            "q_name": ["Q One", "Q Two", "Q Three"],
            "event_acronym": ["EC", "EC", "EC"],
            "event_tag": [None, None, None],
            "pax_count": [None, None, None],
            "ao_name": ["AO", "AO", "AO"],
            "ao_description": [None, "Description", None],
            "location_name": [None, "Location", None],
            "location_description": [None, "Details", None],
            "location_address_street": [None, "Street", None],
        }
    )

    _prepare_calendar_labels(events)

    assert events["event_time"].tolist() == ["0930", "1000", ""]
    assert events["label"].tolist() == ["Q One\nEC 0930", "Q Two\nEC 1000", "Q Three\nEC "]
    assert events.loc[0, "ao_description"] is None
    assert events.loc[0, "location_name"] is None
    assert events.loc[0, "location_description"] is None
    assert events.loc[0, "location_address_street"] is None


def test_calendar_time_sort_key_places_missing_times_last_and_preserves_lexicographic_order():
    times = ["", "1000", "0930"]

    assert sorted(times, key=_calendar_time_sort_key) == ["0930", "1000", ""]


@pytest.fixture
def calendar_generation(monkeypatch):
    """Drive real weekly generation with query rows and capture exported tables."""
    now = datetime(2026, 9, 30, 10)
    settings = {"team_id": "TEST1057", "calendar_weeks_shown": 1, "q_image_posting_enabled": False}
    space = SimpleNamespace(settings=settings)
    session = MagicMock()
    session.__enter__.return_value = session
    query = session.query.return_value
    for method in ("select_from", "join", "outerjoin", "filter", "params"):
        getattr(query, method).return_value = query
    exports = []
    pending = None

    def update(payload):
        nonlocal pending
        pending = deepcopy(payload["settings"])

    def commit():
        nonlocal pending
        assert pending is not None, "settings UPDATE must precede commit"
        settings.clear()
        settings.update(deepcopy(pending))
        pending = None

    def rollback():
        nonlocal pending
        pending = None

    query.update.side_effect = update
    session.commit.side_effect = commit
    session.rollback.side_effect = rollback

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is None:
                return now
            return pytz.UTC.localize(now).astimezone(tz)

    def event_row(ao_name, updated, q_updated=None, **overrides):
        values = {
            "start_date": date(2026, 10, 1),
            "start_time": "0530",
            "event_updated": updated,
            "pax_count": None,
            "series_exception": None,
            "event_tag": None,
            "event_tag_color": None,
            "event_type": "Bootcamp",
            "event_acronym": "BC",
            "ao_name": ao_name,
            "ao_description": None,
            "ao_parent_id": 1,
            "q_name": None,
            "location_name": None,
            "location_description": None,
            "location_address_street": None,
            "q_last_updated": q_updated,
            "region_name": "Test region",
            "region_id": 1,
        }
        values.update(overrides)
        query.statement.selected_columns = [SimpleNamespace(key=key) for key in values]
        return namedtuple("CalendarRow", values)(**values)

    def export(style, filename, **kwargs):
        exports.append((filename, style.data.copy()))

    def run(rows, at, force=False):
        nonlocal now, pending
        pending = None
        now = at
        exports.clear()
        space.settings = deepcopy(settings)
        monkeypatch.setattr(calendar_images, "get_session", MagicMock(side_effect=[session]))
        session.query.return_value.all.side_effect = [
            [(SimpleNamespace(id=1, name="Test region"), None, space)],
            rows,
            [],
            rows,
        ]
        calendar_images.generate_calendar_images(force=force)
        return list(exports)

    monkeypatch.setitem(sys.modules, "dataframe_image", SimpleNamespace(export=export))
    monkeypatch.setattr(calendar_images, "get_session", lambda: session)
    monkeypatch.setattr(
        session, "refresh", lambda record, attribute_names: setattr(record, "settings", deepcopy(settings))
    )
    monkeypatch.setattr(calendar_images, "datetime", Clock)
    monkeypatch.setattr(calendar_images, "current_date_cst", lambda: date(2026, 9, 30))
    monkeypatch.setattr(calendar_images, "LOCAL_DEVELOPMENT", False)
    monkeypatch.setattr(calendar_images, "DB_SCHEMA", "f3_staging")
    monkeypatch.setattr(calendar_images, "update_local_region_records", lambda: None)
    monkeypatch.setattr(calendar_images.storage.os, "remove", lambda path: None)
    monkeypatch.setattr(pd.DataFrame, "to_csv", lambda *args, **kwargs: None)
    # An empty query still exposes its selected columns.
    event_row("Schema AO", now)
    return run, event_row, settings, session


@pytest.fixture
def overlapping_calendar_runs(calendar_generation, monkeypatch):
    """Separate workers/sessions sharing persisted settings, storage, and a DB lock."""
    _, row, settings, existing_session = calendar_generation
    settings["calendar_weeks_shown"] = 3
    columns = existing_session.query.return_value.statement.selected_columns
    worker = threading.local()
    database_locks = {}
    state = SimpleNamespace(
        rows=[],
        files={},
        operations=[],
        lock_owner=None,
        pause_delete=None,
        pause_discovery=None,
        paused=threading.Event(),
        resume=threading.Event(),
        refresh_lock_attempted=threading.Event(),
        fail_commit_for=None,
        pause_after_commit=None,
    )

    def record(action):
        state.operations.append((worker.name, action, state.lock_owner))

    def pause():
        state.paused.set()
        assert state.resume.wait(timeout=10), "overlapping run was not released"

    def session_factory():
        session = MagicMock()
        session.__enter__.return_value = session
        space = SimpleNamespace(settings=deepcopy(settings))
        pending = None
        owned_lock = None

        def execute(statement):
            nonlocal owned_lock
            assert "pg_advisory_xact_lock" in str(statement)
            assert not worker.work_transaction, "work connection/table locks retained while waiting"
            (lock_key,) = statement.compile().params.values()
            assert isinstance(lock_key, int)
            region_lock = database_locks.setdefault(lock_key, threading.Lock())
            if worker.name == "refresh":
                state.refresh_lock_attempted.set()
            assert region_lock.acquire(timeout=10), "calendar region lock was not released"
            owned_lock = region_lock
            state.lock_owner = worker.name
            record("lock")

        def close(*args):
            nonlocal owned_lock
            if owned_lock is not None:
                record("unlock")
                state.lock_owner = None
                owned_lock.release()
                owned_lock = None
            worker.work_transaction = False

        def refresh(record_to_refresh, attribute_names):
            assert attribute_names == ["settings"]
            worker.work_transaction = True
            record("refresh_settings")
            record_to_refresh.settings = deepcopy(settings)

        def read_regions():
            worker.work_transaction = True
            if worker.name == state.pause_discovery:
                pause()
            return [(SimpleNamespace(id=1, name="Test region"), None, space)]

        def read_events():
            worker.work_transaction = True
            record("read_events")
            return list(state.rows)

        def update(payload):
            nonlocal pending
            pending = deepcopy(payload["settings"])

        def commit():
            nonlocal pending
            assert pending is not None, "settings UPDATE must precede commit"
            if worker.name == state.fail_commit_for:
                raise RuntimeError("DB commit failed")
            record("commit")
            settings.clear()
            settings.update(pending)
            pending = None
            # PostgreSQL releases this session's transaction locks at commit.
            close()
            if worker.name == state.pause_after_commit:
                pause()

        def rollback():
            nonlocal pending
            pending = None
            record("rollback")
            close()

        def chain_query():
            query = MagicMock()
            for method in ("select_from", "join", "outerjoin", "filter", "params"):
                getattr(query, method).return_value = query
            return query

        events = chain_query()
        events.statement.selected_columns = columns
        events.all.side_effect = read_events
        regions = chain_query()
        regions.all.side_effect = read_regions
        tags = chain_query()
        tags.all.return_value = []
        updates = chain_query()
        updates.update.side_effect = update

        def query(*entities):
            if len(entities) == 3 and entities[0] is calendar_images.Org:
                return regions
            if len(entities) == 1 and entities[0] is calendar_images.EventTag:
                return tags
            if len(entities) == 1 and entities[0] is calendar_images.SlackSpace:
                return updates
            return events

        session.query.side_effect = query
        session.execute.side_effect = execute
        session.refresh.side_effect = refresh
        session.commit.side_effect = commit
        session.rollback.side_effect = rollback
        session.close.side_effect = close
        session.__exit__.side_effect = close
        return session

    def export(style, filename, **kwargs):
        record("export")
        state.files[filename] = worker.name

    def copy(source, destination):
        record("copy")
        state.files[destination] = state.files[source]

    def remove(path):
        if worker.name == "cleanup" and path == state.pause_delete:
            pause()
        record("delete")
        if path not in state.files:
            raise FileNotFoundError(path)
        del state.files[path]

    def run(name, force=False):
        worker.name = name
        worker.work_transaction = False
        calendar_images.generate_calendar_images(force=force)

    monkeypatch.setattr(calendar_images, "DB_SCHEMA", "f3_prod")
    monkeypatch.setattr(calendar_images, "get_session", session_factory)
    monkeypatch.setattr(sys.modules["dataframe_image"], "export", export)
    monkeypatch.setattr(calendar_images.storage.shutil, "copyfile", copy)
    monkeypatch.setattr(calendar_images.storage.os, "remove", remove)
    return state, run, row, settings


@pytest.mark.parametrize("week_index", [0, 1, 2])
@pytest.mark.parametrize("had_image", [False, True])
def test_overlapping_refresh_waits_through_stable_deletion(overlapping_calendar_runs, week_index, had_image):
    state, run, row, settings = overlapping_calendar_runs
    week = ("current", "next", "third")[week_index]
    stable_path = f"/mnt/calendar-images/1-{week}.png"
    if had_image:
        existing = v1_filename(week=week, timestamp="20260929T100000000000Z")
        settings[f"calendar_image_{week}"] = existing
        state.files[f"/mnt/calendar-images/{existing}"] = "old"
        state.files[stable_path] = "old"
    state.pause_delete = stable_path
    with ThreadPoolExecutor(max_workers=2) as executor:
        cleanup = executor.submit(run, "cleanup")
        try:
            if not state.paused.wait(timeout=5):
                cleanup.result(timeout=1)
                pytest.fail("cleanup did not reach stable deletion")
            assert f"calendar_image_{week}" not in settings
            state.rows = [
                row("New AO", datetime(2026, 9, 30, 9), start_date=date(2026, 10, 1) + timedelta(weeks=week_index))
            ]
            refresh = executor.submit(run, "refresh", True)
            if not state.refresh_lock_attempted.wait(timeout=1):
                # Without locking the refresh finishes while deletion is paused.
                refresh.result(timeout=5)
            else:
                assert not refresh.done()
                assert not any(owner == "refresh" and action == "export" for owner, action, _ in state.operations)
        finally:
            state.resume.set()
        cleanup.result(timeout=5)
        refresh.result(timeout=5)
    assert state.files.get(stable_path) == "refresh"
    assert f"/mnt/calendar-images/{settings[f'calendar_image_{week}']}" in state.files
    assert all(owner == lock_owner for owner, action, lock_owner in state.operations if action != "rollback")


@pytest.mark.parametrize("week_index", [0, 1, 2])
def test_waiting_run_refreshes_settings_and_events_after_region_lock(overlapping_calendar_runs, week_index):
    state, run, row, settings = overlapping_calendar_runs
    state.pause_discovery = "cleanup"
    with ThreadPoolExecutor(max_workers=2) as executor:
        cleanup = executor.submit(run, "cleanup")
        try:
            if not state.paused.wait(timeout=5):
                cleanup.result(timeout=1)
                pytest.fail("cleanup did not reach region discovery")
            state.rows = [
                row("New AO", datetime(2026, 9, 30, 9), start_date=date(2026, 10, 1) + timedelta(weeks=week_index))
            ]
            executor.submit(run, "refresh", True).result(timeout=5)
            committed = deepcopy(settings)
        finally:
            state.resume.set()
        cleanup.result(timeout=5)
    week = ("current", "next", "third")[week_index]
    assert state.files.get(f"/mnt/calendar-images/1-{week}.png") == "refresh"
    assert f"/mnt/calendar-images/{settings[f'calendar_image_{week}']}" in state.files
    assert settings == committed
    assert not any(owner == "cleanup" and action in {"export", "commit"} for owner, action, _ in state.operations)
    assert all(owner == lock_owner for owner, action, lock_owner in state.operations if action != "rollback")


@pytest.mark.parametrize("refresh_commit_fails", [False, True])
@pytest.mark.parametrize("week_index", [0, 1, 2])
def test_cleanup_revalidates_when_refresh_publishes_between_commit_and_relock(
    overlapping_calendar_runs, week_index, refresh_commit_fails
):
    state, run, row, settings = overlapping_calendar_runs
    week = ("current", "next", "third")[week_index]
    existing = v1_filename(week=week, timestamp="20260929T100000000000Z")
    settings[f"calendar_image_{week}"] = existing
    state.files[f"/mnt/calendar-images/{existing}"] = "old"
    state.files[f"/mnt/calendar-images/1-{week}.png"] = "old"
    state.pause_after_commit = "cleanup"
    if refresh_commit_fails:
        state.fail_commit_for = "refresh"
    with ThreadPoolExecutor(max_workers=2) as executor:
        cleanup = executor.submit(run, "cleanup")
        try:
            assert state.paused.wait(timeout=5), "cleanup did not reach its committed state"
            assert state.lock_owner is None
            state.rows = [
                row("New AO", datetime(2026, 9, 30, 9), start_date=date(2026, 10, 1) + timedelta(weeks=week_index))
            ]
            executor.submit(run, "refresh", True).result(timeout=5)
            committed = deepcopy(settings)
            new_backing_paths = {
                path for path, owner in state.files.items() if owner == "refresh" and f"1-{week}-v1-" in path
            }
        finally:
            state.resume.set()
        cleanup.result(timeout=5)
    assert settings == committed
    assert state.files[f"/mnt/calendar-images/1-{week}.png"] == "refresh"
    assert len(new_backing_paths) == 1
    assert new_backing_paths <= state.files.keys()
    assert (f"calendar_image_{week}" in settings) == (not refresh_commit_fails)
    assert f"/mnt/calendar-images/{existing}" not in state.files
    assert all(owner == lock_owner for owner, action, lock_owner in state.operations if action != "rollback")


def test_special_event_blocks_reuse_generation_session(monkeypatch):
    session = MagicMock()
    session.query.return_value.options.return_value.filter.return_value.all.return_value = []
    find_records = MagicMock(side_effect=AssertionError("must not open another DB session while locked"))
    monkeypatch.setattr(calendar_images.DbManager, "find_records", find_records)
    assert calendar_images.create_special_events_blocks({"org_id": 1}, session) == []
    session.query.assert_called_once_with(calendar_images.EventInstance)
    find_records.assert_not_called()


@pytest.mark.parametrize("failure", ["export", "slack_rejected", "slack_ambiguous", "commit", "interrupt"])
def test_region_lock_released_after_failure_or_interruption(overlapping_calendar_runs, monkeypatch, failure):
    state, run, row, settings = overlapping_calendar_runs
    state.rows = [row("AO", datetime(2026, 9, 30, 9))]
    export = sys.modules["dataframe_image"].export

    def fail_export(style, filename, **kwargs):
        if state.lock_owner == "cleanup":
            if failure == "interrupt":
                raise KeyboardInterrupt()
            raise RuntimeError("Export failed")
        export(style, filename, **kwargs)

    if failure in {"export", "interrupt"}:
        monkeypatch.setattr(sys.modules["dataframe_image"], "export", fail_export)
    elif failure.startswith("slack_"):
        settings.update(q_image_posting_enabled=True, q_image_posting_channel="TEST_CHANNEL", bot_token="test-token")

        def post(*args):
            if state.lock_owner == "cleanup":
                raise calendar_images.CalendarSlackPostError(safe_to_discard=failure == "slack_rejected")

        monkeypatch.setattr(calendar_images, "post_calendar_to_slack", post)
    else:
        state.fail_commit_for = "cleanup"
    before = deepcopy(settings)
    with ThreadPoolExecutor(max_workers=1) as executor:
        attempted = executor.submit(run, "cleanup", True)
        if failure == "interrupt":
            with pytest.raises(KeyboardInterrupt):
                attempted.result(timeout=5)
        else:
            attempted.result(timeout=5)
        assert state.lock_owner is None
        assert settings == before
        executor.submit(run, "refresh", True).result(timeout=5)
    assert state.lock_owner is None
    assert state.files.get("/mnt/calendar-images/1-current.png") == "refresh"
    assert f"/mnt/calendar-images/{settings['calendar_image_current']}" in state.files


@pytest.mark.parametrize("delay_seconds", [3600, 3601, 86401])
@pytest.mark.parametrize("change_source", ["event", "q"])
def test_delayed_hourly_run_rebuilds_stale_image(calendar_generation, delay_seconds, change_source):
    run, row, settings, _ = calendar_generation
    baseline_time = datetime(2026, 9, 30, 10)
    control = row("Control AO", baseline_time - timedelta(hours=1))
    baseline = run([control], baseline_time)
    assert len(baseline) == 1
    assert "One-time AO" not in baseline[0][1].to_string()
    baseline_image = settings["calendar_image_current"]

    changed_at = baseline_time + timedelta(seconds=1)
    event = row(
        "One-time AO",
        changed_at if change_source == "event" else baseline_time - timedelta(hours=1),
        changed_at if change_source == "q" else None,
    )
    next_run = changed_at + timedelta(seconds=delay_seconds)
    regenerated = run([control, event], next_run)
    assert len(regenerated) == 1
    assert "One-time AO" in regenerated[0][1].to_string()
    assert "0530" in regenerated[0][1].to_string()
    assert settings["calendar_image_current"] != baseline_image
    assert image_metadata(settings, next_run)[0] == next_run.replace(tzinfo=UTC)

    # An unchanged week does not keep rebuilding, even on the next hourly run.
    rebuilt_image = settings["calendar_image_current"]
    assert run([control, event], next_run + timedelta(hours=1)) == []
    assert settings["calendar_image_current"] == rebuilt_image
    assert image_metadata(settings, next_run)[0] == next_run.replace(tzinfo=UTC)
    assert len(run([control, event], next_run + timedelta(hours=1), force=True)) == 1


def test_region_id_is_bound_for_initial_and_cleanup_calendar_reads(calendar_generation):
    run, row, settings, session = calendar_generation
    now = datetime(2026, 9, 30, 10)
    settings["calendar_image_current"] = "1-current-abcdefghij.png"

    query = session.query.return_value
    bound_regions = []

    def bind_region(**params):
        assert params == {calendar_images.CALENDAR_REGION_BIND_PARAMETER: 1}
        bound_regions.append(params[calendar_images.CALENDAR_REGION_BIND_PARAMETER])
        return query

    query.params.side_effect = bind_region
    assert len(run([row("AO", now - timedelta(days=1))], now)) == 1
    # The legacy filename queues cleanup, which performs an initial locked read
    # and a cleanup reread after reacquiring the lock.
    assert bound_regions == [1, 1]


def test_complete_production_calendar_query_compiles_with_isolated_region_bindings():
    from sqlalchemy import Integer, bindparam, create_mock_engine
    from sqlalchemy.orm import Session

    engine = create_mock_engine("postgresql+psycopg2://", lambda *args, **kwargs: None)
    week_start = date(2026, 10, 1)
    with Session(engine) as session:
        query, region_org = calendar_images._build_calendar_query(session, week_start, week_start + timedelta(weeks=3))

        for region_id in (7, 19):
            compiled = (
                query.filter(region_org.id == bindparam("calendar_outer_region_id", type_=Integer))
                .params(
                    **{
                        calendar_images.CALENDAR_REGION_BIND_PARAMETER: region_id,
                        "calendar_outer_region_id": region_id,
                    }
                )
                .statement.compile(dialect=engine.dialect)
            )
            sql = str(compiled)
            assert sql.count("parent_id = %(calendar_region_id)s") == 2
            assert "id = %(calendar_outer_region_id)s" in sql
            assert compiled.params[calendar_images.CALENDAR_REGION_BIND_PARAMETER] == region_id
            assert compiled.params["calendar_outer_region_id"] == region_id
            assert compiled.binds[calendar_images.CALENDAR_REGION_BIND_PARAMETER].type.python_type is int


def test_legacy_image_without_metadata_rebuilds_once(calendar_generation, monkeypatch):
    run, row, settings, _ = calendar_generation
    now = datetime(2026, 9, 30, 10)
    legacy = "1-current-abcdefghij.png"
    settings["calendar_image_current"] = legacy
    remove = MagicMock()
    monkeypatch.setattr(calendar_images.storage.os, "remove", remove)
    rows = [row("One-time AO", now - timedelta(days=2))]
    assert len(run(rows, now)) == 1
    assert image_metadata(settings, now)[0] == now.replace(tzinfo=UTC)
    remove.assert_called_once_with(f"/mnt/calendar-images/{legacy}")
    assert run(rows, now + timedelta(hours=1)) == []


def test_failed_export_keeps_previous_filename_and_metadata(calendar_generation, monkeypatch):
    run, row, settings, _ = calendar_generation
    now = datetime(2026, 9, 30, 10)
    existing = v1_filename()
    settings["calendar_image_current"] = existing

    fail_export = MagicMock(side_effect=RuntimeError("Export failed"))
    monkeypatch.setattr(sys.modules["dataframe_image"], "export", fail_export)
    assert run([row("One-time AO", now + timedelta(seconds=1))], now + timedelta(hours=2)) == []
    fail_export.assert_called_once()
    assert settings["calendar_image_current"] == existing
    assert image_metadata(settings, now)[0] == now.replace(tzinfo=UTC)


def test_changes_during_rendering_remain_pending(calendar_generation, monkeypatch):
    run, row, settings, _ = calendar_generation
    now = datetime(2026, 9, 30, 10, 0, 0, 123456)
    rows = [row("One-time AO", now - timedelta(hours=2))]
    real_export = sys.modules["dataframe_image"].export
    query_clock = calendar_images.datetime

    class ExportCompletionClock(datetime):
        @classmethod
        def now(cls, tz=None):
            completed_at = now + timedelta(seconds=30)
            if tz is None:
                return completed_at
            return pytz.UTC.localize(completed_at).astimezone(tz)

    def export_with_change(*args, **kwargs):
        real_export(*args, **kwargs)
        rows[0] = row("One-time AO", now + timedelta(seconds=1))
        monkeypatch.setattr(calendar_images, "datetime", ExportCompletionClock)

    monkeypatch.setattr(sys.modules["dataframe_image"], "export", export_with_change)
    assert len(run(rows, now)) == 1
    assert image_metadata(settings, now)[0] == now.replace(tzinfo=UTC)
    monkeypatch.setattr(calendar_images, "datetime", query_clock)
    monkeypatch.setattr(sys.modules["dataframe_image"], "export", real_export)
    assert len(run(rows, now + timedelta(hours=2))) == 1


@pytest.mark.parametrize("filename", INVALID_FILENAMES)
def test_invalid_filename_regenerates_without_crashing_or_deletion(calendar_generation, monkeypatch, filename):
    run, row, settings, _ = calendar_generation
    now = datetime(2026, 9, 30, 10)
    settings["calendar_image_current"] = filename
    remove = MagicMock()
    monkeypatch.setattr(calendar_images.storage.os, "remove", remove)
    assert len(run([row("One-time AO", now - timedelta(days=2))], now)) == 1
    assert image_metadata(settings, now)[0] == now.replace(tzinfo=UTC)
    remove.assert_not_called()
    assert run([row("One-time AO", now - timedelta(days=2))], now + timedelta(hours=1)) == []


@pytest.mark.parametrize("updated", [datetime(2026, 9, 30, 10), datetime(2026, 9, 30, 10, tzinfo=UTC)])
def test_filename_timestamp_compares_utc_database_timestamps(updated):
    query_start = datetime(2026, 9, 30, 11, tzinfo=UTC)
    args = (query_start, "a" * 64)
    assert not calendar_images.calendar_image_is_stale(v1_filename(), 1, "current", updated, *args)
    assert not calendar_images.calendar_image_is_stale(
        v1_filename(), 1, "current", updated - timedelta(seconds=1), *args
    )
    assert calendar_images.calendar_image_is_stale(v1_filename(), 1, "current", updated + timedelta(seconds=1), *args)
    assert calendar_images.calendar_image_is_stale(v1_filename(), 1, "current", updated, query_start, "b" * 64)


def test_generated_settings_refresh_region_cache(calendar_generation, monkeypatch):
    from utilities import helper_functions

    run, row, settings, _ = calendar_generation
    now = datetime(2026, 9, 30, 10)
    settings["calendar_weeks_shown"] = 3
    cache = {}
    monkeypatch.setattr(helper_functions, "REGION_RECORDS", cache)
    monkeypatch.setattr(
        helper_functions.DbManager,
        "find_records",
        lambda *args, **kwargs: [SimpleNamespace(settings=settings, team_id=settings["team_id"])],
    )
    monkeypatch.setattr(calendar_images, "update_local_region_records", helper_functions.update_local_region_records)
    rows = [row("AO", now, start_date=date(2026, 10, 1) + timedelta(weeks=i)) for i in range(3)]
    assert len(run(rows, now)) == 3
    region = cache[settings["team_id"]]
    assert {key for key in settings if key.startswith("calendar_image_")} == {
        "calendar_image_current",
        "calendar_image_next",
        "calendar_image_third",
    }
    for week in ("current", "next", "third"):
        assert getattr(region, f"calendar_image_{week}") == settings[f"calendar_image_{week}"]
        assert image_metadata(settings, now, week)[0] == now.replace(tzinfo=UTC)
        assert not hasattr(region, f"calendar_image_{week}_generated_at")
        assert not hasattr(region, f"calendar_image_{week}_fingerprint")


@pytest.mark.parametrize("num_weeks,removed_weeks", [(1, ["next", "third"]), (2, ["third"])])
def test_stale_week_cleanup_removes_filename_with_metadata(monkeypatch, num_weeks, removed_weeks):
    removed = []
    monkeypatch.setattr(calendar_images.storage.os, "remove", removed.append)
    monkeypatch.setattr(calendar_images, "DB_SCHEMA", "f3_staging")
    settings = {}
    for week in ("current", "next", "third"):
        settings[f"calendar_image_{week}"] = v1_filename(week=week)
    assert calendar_images.remove_stale_week_images(settings, 1, num_weeks)
    for index, week in enumerate(("current", "next", "third")):
        assert (f"calendar_image_{week}" in settings) == (index < num_weeks)
    assert removed == [f"/mnt/calendar-images/{v1_filename(week=week)}" for week in removed_weeks]


def test_local_development_exports_to_mount_and_removes_replaced_image_after_commit(calendar_generation, monkeypatch):
    run, row, settings, session = calendar_generation
    monkeypatch.setattr(calendar_images, "LOCAL_DEVELOPMENT", True)
    now = datetime(2026, 9, 30, 10)
    rows = [row("AO", now - timedelta(days=1))]
    [(path, _)] = run(rows, now)
    old = settings["calendar_image_current"]
    assert path == f"/mnt/calendar-images/{old}"

    removed = []

    def remove(path):
        assert session.commit.call_count == 2
        removed.append(path)

    monkeypatch.setattr(calendar_images.storage.os, "remove", remove)
    # LOCAL_DEVELOPMENT regenerates on every run, without force.
    run(rows, now + timedelta(hours=1))

    assert settings["calendar_image_current"] != old
    assert removed == [f"/mnt/calendar-images/{old}"]


def test_emulator_uploads_copies_and_deletes_calendar_images_over_http(calendar_generation, monkeypatch):
    run, row, settings, session = calendar_generation
    monkeypatch.setenv("GCS_EMULATOR_HOST", "localhost:9023")
    monkeypatch.setattr(calendar_images, "DB_SCHEMA", "f3_prod")
    calls = []

    def export(style, filename, **kwargs):
        with open(filename, "wb") as f:
            f.write(b"png bytes")

    def respond(method):
        def call(url, **kwargs):
            calls.append((method, url, kwargs))
            response = calendar_images.storage.requests.Response()
            response.status_code = 200
            return response

        return call

    monkeypatch.setitem(sys.modules, "dataframe_image", SimpleNamespace(export=export))
    monkeypatch.setattr(calendar_images.storage.requests, "post", respond("POST"))
    monkeypatch.setattr(calendar_images.storage.requests, "delete", respond("DELETE"))
    objects = "http://localhost:9023/storage/v1/b/f3nation-calendar-images/o"
    now = datetime(2026, 9, 30, 10)

    run([row("AO", now - timedelta(days=1))], now)

    first = settings["calendar_image_current"]
    posts = [(url, kwargs) for method, url, kwargs in calls if method == "POST"]
    [(upload_url, upload), (copy_url, _)] = posts
    assert upload_url == "http://localhost:9023/upload/storage/v1/b/f3nation-calendar-images/o"
    assert upload["params"]["name"] == first
    assert upload["headers"] == {"Content-Type": "image/png"}
    assert upload["data"] == b"png bytes"
    assert copy_url == f"{objects}/{first}/copyTo/b/f3nation-calendar-images/o/1-current.png"

    calls.clear()
    run([row("AO renamed", now)], now + timedelta(hours=1))

    assert settings["calendar_image_current"] != first
    assert f"{objects}/{first}" in [url for method, url, _ in calls if method == "DELETE"]


@pytest.mark.parametrize("remaining", ["control", "empty", "q_removed", "moved", "ao_renamed", "ao_description"])
def test_content_changes_invalidate_images_even_with_old_timestamps(calendar_generation, remaining):
    run, row, settings, session = calendar_generation
    now = datetime(2026, 9, 30, 10)
    old = now - timedelta(days=1)
    control = row("Control", old)
    event = row("Event", old, old, q_name="Q One")
    assert len(run([control, event], now)) == 1
    before = deepcopy(settings)
    changed = {
        "control": [control],
        "empty": [],
        "q_removed": [control, row("Event", old)],
        "moved": [control, row("Event", old, start_date=date(2026, 10, 8))],
        "ao_renamed": [control, row("Renamed", old, old, q_name="Q One")],
        "ao_description": [control, row("Event", old, old, q_name="Q One", ao_description="New description")],
    }[remaining]
    regenerated = run(changed, now + timedelta(hours=1))
    if remaining == "empty":
        assert regenerated == []
        assert not any(key.startswith("calendar_image_current") for key in settings)
    else:
        assert len(regenerated) == 1
        assert settings["calendar_image_current"] != before["calendar_image_current"]
        assert image_metadata(settings, now + timedelta(hours=1))[1] != image_metadata(before, now)[1]
    assert session.commit.call_count == 2
    assert run(changed, now + timedelta(hours=2)) == []


@pytest.mark.parametrize("changed_index", [0, 1, 2])
def test_three_weeks_only_changed_week_is_persisted(calendar_generation, changed_index):
    run, row, settings, _ = calendar_generation
    now = datetime(2026, 9, 30, 10)
    settings["calendar_weeks_shown"] = 3
    rows = [row("AO", now - timedelta(days=1), start_date=date(2026, 10, 1) + timedelta(weeks=i)) for i in range(3)]
    assert len(run(rows, now)) == 3
    before = deepcopy(settings)
    rows[changed_index] = row(
        "Changed", now + timedelta(seconds=1), start_date=date(2026, 10, 1) + timedelta(weeks=changed_index)
    )
    assert len(run(rows, now + timedelta(hours=1))) == 1
    for index, week in enumerate(("current", "next", "third")):
        assert (settings[f"calendar_image_{week}"] != before[f"calendar_image_{week}"]) == (index == changed_index)
        expected_time = now + timedelta(hours=1) if index == changed_index else now
        assert image_metadata(settings, now + timedelta(hours=1), week)[0] == expected_time.replace(tzinfo=UTC)


@pytest.mark.parametrize("source_index,target_index", [(0, 1), (1, 2), (2, 0)])
def test_moving_last_event_cleans_source_and_refreshes_only_destination(
    calendar_generation, source_index, target_index
):
    run, row, settings, _ = calendar_generation
    now = datetime(2026, 9, 30, 10)
    old = now - timedelta(days=1)
    settings["calendar_weeks_shown"] = 3
    rows = [row(f"AO {i}", old, start_date=date(2026, 10, 1) + timedelta(weeks=i)) for i in range(3)]
    assert len(run(rows, now)) == 3
    before = deepcopy(settings)
    rows[source_index] = row(f"AO {source_index}", old, start_date=date(2026, 10, 1) + timedelta(weeks=target_index))
    assert len(run(rows, now + timedelta(hours=1))) == 1
    for index, week in enumerate(("current", "next", "third")):
        key = f"calendar_image_{week}"
        if index == source_index:
            assert key not in settings
        elif index == target_index:
            assert settings[key] != before[key]
            assert image_metadata(settings, now + timedelta(hours=1), week)[1] != image_metadata(before, now, week)[1]
        else:
            assert settings[key] == before[key]
    assert run(rows, now + timedelta(hours=2)) == []


@pytest.mark.parametrize("grouping", ["ao", "location"])
def test_legacy_empty_displayed_week_is_removed(calendar_generation, grouping):
    run, row, settings, _ = calendar_generation
    now = datetime(2026, 9, 30, 10)
    settings.update(
        calendar_weeks_shown=2,
        calendar_group_by_option=grouping,
        calendar_image_next="1-next-abcdefghij.png",
    )
    assert len(run([row("AO", now - timedelta(days=1))], now)) == 1
    assert not any(key.startswith("calendar_image_next") for key in settings)
    assert run([row("AO", now - timedelta(days=1))], now + timedelta(hours=1)) == []


@pytest.mark.parametrize("schema", ["f3_staging", "f3_prod"])
@pytest.mark.parametrize("force", [False, True])
def test_empty_region_without_images_is_unchanged(calendar_generation, monkeypatch, force, schema):
    run, _, settings, session = calendar_generation
    settings["calendar_weeks_shown"] = 3
    monkeypatch.setattr(calendar_images, "DB_SCHEMA", schema)
    before = deepcopy(settings)
    assert run([], datetime(2026, 9, 30, 10), force=force) == []
    assert settings == before
    session.query.return_value.update.assert_not_called()
    session.commit.assert_not_called()


@pytest.mark.parametrize("schema", ["f3_staging", "f3_prod"])
@pytest.mark.parametrize("filename", INVALID_FILENAMES)
def test_empty_week_never_deletes_unrecognized_backing_files(calendar_generation, monkeypatch, schema, filename):
    run, _, settings, session = calendar_generation
    settings["calendar_image_current"] = filename
    monkeypatch.setattr(calendar_images, "DB_SCHEMA", schema)

    def remove(path):
        assert session.commit.call_count == 1
        assert "calendar_image_current" not in settings
        assert path in {f"/mnt/calendar-images/1-{week}.png" for week in ("current", "next", "third")}

    remove_mock = MagicMock(side_effect=remove)
    monkeypatch.setattr(calendar_images.storage.os, "remove", remove_mock)
    assert run([], datetime(2026, 9, 30, 10)) == []
    assert "calendar_image_current" not in settings
    session.commit.assert_called_once()
    if schema == "f3_prod":
        assert {call.args[0] for call in remove_mock.call_args_list} == {
            f"/mnt/calendar-images/1-{week}.png" for week in ("current", "next", "third")
        }
        assert remove_mock.call_count == 3
    else:
        remove_mock.assert_not_called()


def test_missing_empty_weeks_do_not_create_images(calendar_generation):
    run, row, settings, _ = calendar_generation
    now = datetime(2026, 9, 30, 10)
    settings["calendar_weeks_shown"] = 3
    assert len(run([row("AO", now - timedelta(days=1))], now)) == 1
    assert not any(key.startswith(("calendar_image_next", "calendar_image_third")) for key in settings)


@pytest.mark.parametrize("schema", ["f3_staging", "f3_prod"])
@pytest.mark.parametrize("filename", ["1-third-abcdefghij.png", v1_filename(week="third")])
def test_empty_region_still_cleans_up_hidden_weeks(calendar_generation, monkeypatch, schema, filename):
    run, _, settings, session = calendar_generation
    settings.update(
        calendar_image_third=filename,
        q_image_posting_enabled=True,
        q_image_posting_channel="TEST_CHANNEL",
        bot_token="test-token",
    )
    monkeypatch.setattr(calendar_images, "DB_SCHEMA", schema)

    def remove(path):
        assert session.commit.call_count == 1
        assert "calendar_image_third" not in settings

    remove_mock = MagicMock(side_effect=remove)
    monkeypatch.setattr(calendar_images.storage.os, "remove", remove_mock)
    post = MagicMock()
    monkeypatch.setattr(calendar_images, "post_calendar_to_slack", post)
    assert run([], datetime(2026, 9, 30, 10)) == []
    assert not any(key.startswith("calendar_image_") for key in settings)
    session.commit.assert_called_once()
    post.assert_called_once()
    remove_mock.assert_any_call(f"/mnt/calendar-images/{filename}")
    if schema == "f3_prod":
        for week in ("current", "next", "third"):
            remove_mock.assert_any_call(f"/mnt/calendar-images/1-{week}.png")
    assert remove_mock.call_count == (4 if schema == "f3_prod" else 1)


@pytest.mark.parametrize("schema", ["f3_staging", "f3_prod"])
@pytest.mark.parametrize("commit_fails", [False, True])
def test_last_event_removal_refreshes_post_and_defers_deletion(calendar_generation, monkeypatch, schema, commit_fails):
    run, row, settings, session = calendar_generation
    now = datetime(2026, 9, 30, 10)
    run([row("AO", now - timedelta(days=1))], now)
    settings.update(q_image_posting_enabled=True, q_image_posting_channel="TEST_CHANNEL", bot_token="test-token")
    before = deepcopy(settings)
    old_image = settings["calendar_image_current"]
    monkeypatch.setattr(calendar_images, "DB_SCHEMA", schema)

    def post(updated_settings, *args):
        assert not any(key.startswith("calendar_image_current") for key in updated_settings)

    post_mock = MagicMock(side_effect=post)
    monkeypatch.setattr(calendar_images, "post_calendar_to_slack", post_mock)

    def remove(path):
        assert session.commit.call_count == 2
        assert "calendar_image_current" not in settings

    remove_mock = MagicMock(side_effect=remove)
    monkeypatch.setattr(calendar_images.storage.os, "remove", remove_mock)
    if commit_fails:
        session.commit.side_effect = RuntimeError("commit failed")
    assert run([], now + timedelta(hours=1)) == []
    post_mock.assert_called_once()
    if commit_fails:
        assert settings == before
        remove_mock.assert_not_called()
        session.rollback.assert_called_once()
    else:
        assert not any(key.startswith("calendar_image_current") for key in settings)
        remove_mock.assert_any_call(f"/mnt/calendar-images/{old_image}")
        if schema == "f3_prod":
            for week in ("current", "next", "third"):
                remove_mock.assert_any_call(f"/mnt/calendar-images/1-{week}.png")
        assert remove_mock.call_count == (4 if schema == "f3_prod" else 1)


def test_slack_api_error_without_response_is_ambiguous():
    error = SlackApiError("No response received", response=None)
    assert calendar_images._slack_attempt_was_rejected(error) is False


@pytest.mark.parametrize("outcome", ["update", "fallback", "both_fail", "initial_fail"])
@pytest.mark.parametrize("failure_mode", ["exception", "not_ok"])
@pytest.mark.parametrize("change", ["empty", "replacement"])
def test_slack_posting_controls_calendar_persistence_and_deletion(
    calendar_generation, monkeypatch, outcome, failure_mode, change
):
    run, row, settings, session = calendar_generation
    now = datetime(2026, 9, 30, 10)
    run([row("Original AO", now - timedelta(days=1))], now)
    old_backing = settings["calendar_image_current"]
    settings.update(q_image_posting_enabled=True, q_image_posting_channel="TEST_CHANNEL", bot_token="test-token")
    if outcome != "initial_fail":
        settings["q_image_posting_ts"] = "old-ts"
    before = deepcopy(settings)
    monkeypatch.setattr(calendar_images, "DB_SCHEMA", "f3_prod")
    copy = MagicMock()
    monkeypatch.setattr(calendar_images.storage.shutil, "copyfile", copy)
    client = MagicMock()
    client.chat_update.return_value = {"ok": True}
    client.chat_postMessage.return_value = {"ok": True, "ts": "new-ts"}

    def fail(method):
        if failure_mode == "exception":
            method.side_effect = RuntimeError("Slack API failed")
        else:
            method.return_value = {"ok": False, "error": "test_failure"}

    if outcome in {"fallback", "both_fail"}:
        fail(client.chat_update)
    failed = outcome in {"both_fail", "initial_fail"}
    if failed:
        fail(client.chat_postMessage)
    monkeypatch.setattr(calendar_images, "WebClient", lambda **kwargs: client)
    monkeypatch.setattr(calendar_images, "create_special_events_blocks", lambda settings, session=None: [])

    def remove(path):
        if session.commit.call_count == 1:
            assert failed
            assert settings == before
            assert path != f"/mnt/calendar-images/{old_backing}"
        else:
            assert session.commit.call_count == 2
            assert settings != before

    remove_mock = MagicMock(side_effect=remove)
    monkeypatch.setattr(calendar_images.storage.os, "remove", remove_mock)
    changed_rows = [] if change == "empty" else [row("Changed AO", now - timedelta(days=1))]
    exports = run(changed_rows, now + timedelta(hours=1))
    assert len(exports) == (1 if change == "replacement" else 0)
    assert copy.call_count == (1 if change == "replacement" else 0)
    assert client.chat_update.call_count == (0 if outcome == "initial_fail" else 1)
    assert client.chat_postMessage.call_count == (0 if outcome == "update" else 1)
    if failed:
        assert settings == before
        assert session.query.return_value.update.call_count == 1
        assert session.commit.call_count == 1
        session.rollback.assert_called_once()
        expected_cleanup = [path for path, _ in exports] if failure_mode == "not_ok" else []
        assert [call.args[0] for call in remove_mock.call_args_list] == expected_cleanup
        remove_mock.reset_mock()
        # The persisted old snapshot makes the next scheduled run retry naturally.
        client.chat_update.side_effect = None
        client.chat_update.return_value = {"ok": True}
        client.chat_postMessage.side_effect = None
        client.chat_postMessage.return_value = {"ok": True, "ts": "new-ts"}
        client.reset_mock()
        retry_exports = run(changed_rows, now + timedelta(hours=2))
        assert len(retry_exports) == (1 if change == "replacement" else 0)
        assert client.chat_update.call_count == (0 if outcome == "initial_fail" else 1)
        assert client.chat_postMessage.call_count == (1 if outcome == "initial_fail" else 0)
    else:
        session.rollback.assert_not_called()
    assert session.query.return_value.update.call_count == 2
    assert session.commit.call_count == 2
    assert settings.get("calendar_image_current") != old_backing
    assert settings["q_image_posting_ts"] == ("new-ts" if outcome in {"fallback", "initial_fail"} else "old-ts")
    remove_mock.assert_any_call(f"/mnt/calendar-images/{old_backing}")
    if change == "empty":
        assert "calendar_image_current" not in settings
        remove_mock.assert_any_call("/mnt/calendar-images/1-current.png")
    else:
        assert settings["calendar_image_current"] == (retry_exports if failed else exports)[0][0].split("/")[-1]
        assert all(call.args[0] != "/mnt/calendar-images/1-current.png" for call in remove_mock.call_args_list)


@pytest.mark.parametrize("schema", ["f3_staging", "f3_prod"])
@pytest.mark.parametrize("num_weeks", [1, 3])
@pytest.mark.parametrize(
    "failure",
    [
        "initial_rejected",
        "initial_timeout",
        "both_rejected",
        "update_timeout_post_rejected",
        "update_rejected_post_timeout",
        "update_timeout_post_success",
        "sdk_rejected",
        "sdk_unknown",
        "commit",
    ],
)
def test_new_backing_cleanup_only_for_failed_slack_post(calendar_generation, monkeypatch, schema, num_weeks, failure):
    run, row, settings, session = calendar_generation
    now = datetime(2026, 9, 30, 10)
    settings["calendar_weeks_shown"] = num_weeks
    monkeypatch.setattr(calendar_images, "DB_SCHEMA", schema)
    files = set()
    export = sys.modules["dataframe_image"].export

    def write_export(style, filename, **kwargs):
        export(style, filename, **kwargs)
        files.add(filename)

    monkeypatch.setattr(sys.modules["dataframe_image"], "export", write_export)
    copy = MagicMock(side_effect=lambda source, destination: files.add(destination))
    monkeypatch.setattr(calendar_images.storage.shutil, "copyfile", copy)

    def remove(path):
        if path not in files:
            raise FileNotFoundError(path)
        files.remove(path)

    remove_mock = MagicMock(side_effect=remove)
    monkeypatch.setattr(calendar_images.storage.os, "remove", remove_mock)
    rows = [
        row(f"AO {i}", now - timedelta(days=1), start_date=date(2026, 10, 1) + timedelta(weeks=i))
        for i in range(num_weeks)
    ]
    old_paths = {path for path, _ in run(rows, now)}
    settings.update(
        q_image_posting_enabled=True,
        q_image_posting_channel="TEST_CHANNEL",
        bot_token="test-token",
        q_image_posting_ts="old-ts",
    )
    initial_post = failure in {"initial_rejected", "initial_timeout", "sdk_unknown"}
    if initial_post:
        settings.pop("q_image_posting_ts")
    before = deepcopy(settings)
    prior_files = files.copy()
    remove_mock.reset_mock()
    copy.reset_mock()
    client = MagicMock()
    client.chat_update.return_value = {"ok": True}
    client.chat_postMessage.return_value = {"ok": True, "ts": "new-ts"}
    monkeypatch.setattr(calendar_images, "WebClient", lambda **kwargs: client)
    monkeypatch.setattr(calendar_images, "create_special_events_blocks", lambda settings, session=None: [])
    if failure in {"both_rejected", "update_rejected_post_timeout"}:
        client.chat_update.return_value = {"ok": False}
    elif failure in {"update_timeout_post_rejected", "update_timeout_post_success"}:
        client.chat_update.side_effect = TimeoutError("Slack update timed out")
    if failure in {"initial_rejected", "both_rejected", "update_timeout_post_rejected"}:
        client.chat_postMessage.return_value = {"ok": False}
    elif failure in {"initial_timeout", "update_rejected_post_timeout"}:
        client.chat_postMessage.side_effect = TimeoutError("Slack post timed out")
    if failure == "sdk_rejected":
        client.chat_update.side_effect = SlackApiError("Slack rejected update", {"ok": False})
        client.chat_postMessage.side_effect = SlackApiError("Slack rejected post", {"ok": False})
    elif failure == "sdk_unknown":
        client.chat_postMessage.side_effect = SlackApiError("Unknown response", {"error": "unknown"})
    elif failure == "commit":
        session.commit.side_effect = RuntimeError("DB commit failed")
    changed_rows = [
        row(f"Changed AO {i}", now - timedelta(days=1), start_date=date(2026, 10, 1) + timedelta(weeks=i))
        for i in range(num_weeks)
    ]
    new_paths = {path for path, _ in run(changed_rows, now + timedelta(hours=1))}
    assert len(new_paths) == num_weeks
    assert new_paths.isdisjoint(old_paths)
    assert copy.call_count == (num_weeks if schema == "f3_prod" else 0)
    if failure == "update_timeout_post_success":
        client.chat_update.assert_called_once()
        client.chat_postMessage.assert_called_once()
        assert session.commit.call_count == 2
        assert settings["q_image_posting_ts"] == "new-ts"
        assert new_paths <= files
        assert not old_paths & files
        session.rollback.assert_not_called()
        return
    assert settings == before
    assert old_paths <= files
    session.rollback.assert_called_once()
    assert client.chat_update.call_count == (0 if initial_post else 1)
    if failure != "commit":
        client.chat_postMessage.assert_called_once()
        cleanup_allowed = failure in {"initial_rejected", "both_rejected", "sdk_rejected"}
        assert {call.args[0] for call in remove_mock.call_args_list} == (new_paths if cleanup_allowed else set())
        assert remove_mock.call_count == (num_weeks if cleanup_allowed else 0)
        assert files == (prior_files if cleanup_allowed else prior_files | new_paths)
        assert session.query.return_value.update.call_count == 1
        assert session.commit.call_count == 1
        client.chat_update.side_effect = None
        client.chat_update.return_value = {"ok": True}
        client.chat_postMessage.side_effect = None
        client.chat_postMessage.return_value = {"ok": True, "ts": "new-ts"}
        retry_paths = {path for path, _ in run(changed_rows, now + timedelta(hours=2))}
        assert len(retry_paths) == num_weeks
        assert retry_paths <= files
        assert not files & old_paths
        assert (new_paths <= files) == (not cleanup_allowed)
        assert session.commit.call_count == 2
    else:
        client.chat_postMessage.assert_not_called()
        urls = [
            block.image_url for block in client.chat_update.call_args.kwargs["blocks"] if hasattr(block, "image_url")
        ]
        assert {url.rsplit("/", 1)[-1] for url in urls} == {path.rsplit("/", 1)[-1] for path in new_paths}
        assert files == prior_files | new_paths
        remove_mock.assert_not_called()
        assert session.query.return_value.update.call_count == 2
        assert session.commit.call_count == 2


def test_failed_slack_post_does_not_delete_export_matching_a_persisted_filename(calendar_generation, monkeypatch):
    run, row, settings, session = calendar_generation
    now = datetime(2026, 9, 30, 10)
    rows = [row("AO", now - timedelta(days=1))]
    run(rows, now)
    existing = settings["calendar_image_current"]
    settings.update(q_image_posting_enabled=True, q_image_posting_channel="TEST_CHANNEL", bot_token="test-token")
    before = deepcopy(settings)
    nonce = existing.rsplit("-", 1)[-1].removesuffix(".png")
    monkeypatch.setattr(calendar_images.random, "choices", lambda alphabet, k: list(nonce))
    monkeypatch.setattr(
        calendar_images,
        "post_calendar_to_slack",
        MagicMock(side_effect=calendar_images.CalendarSlackPostError(safe_to_discard=True)),
    )
    remove = MagicMock()
    monkeypatch.setattr(calendar_images.storage.os, "remove", remove)
    exports = run(rows, now, force=True)
    assert exports[0][0] == f"/mnt/calendar-images/{existing}"
    assert settings == before
    remove.assert_not_called()
    assert session.commit.call_count == 1
    session.rollback.assert_called_once()


@pytest.mark.parametrize("week_index", [0, 1, 2])
@pytest.mark.parametrize("other_week_has_events", [False, True])
def test_failed_stable_deletion_retries_without_settings_write_or_slack_post(
    calendar_generation, monkeypatch, week_index, other_week_has_events
):
    run, row, settings, session = calendar_generation
    now = datetime(2026, 9, 30, 10)
    week = ("current", "next", "third")[week_index]
    settings["calendar_weeks_shown"] = 3
    rows = [row("Removed AO", now - timedelta(days=1), start_date=date(2026, 10, 1) + timedelta(weeks=week_index))]
    remaining = []
    if other_week_has_events:
        remaining = [
            row(
                "Remaining AO",
                now - timedelta(days=1),
                start_date=date(2026, 10, 1) + timedelta(weeks=(week_index + 1) % 3),
            )
        ]
    run(rows + remaining, now)
    old_backing = settings[f"calendar_image_{week}"]
    settings.update(q_image_posting_enabled=True, q_image_posting_channel="TEST_CHANNEL", bot_token="test-token")
    monkeypatch.setattr(calendar_images, "DB_SCHEMA", "f3_prod")
    post = MagicMock()
    monkeypatch.setattr(calendar_images, "post_calendar_to_slack", post)
    stable_path = f"/mnt/calendar-images/1-{week}.png"
    files = {stable_path, f"/mnt/calendar-images/{old_backing}"}
    stable_attempts = 0

    def remove(path):
        nonlocal stable_attempts
        assert session.commit.call_count == 2
        assert f"calendar_image_{week}" not in settings
        if path == stable_path:
            stable_attempts += 1
            if stable_attempts == 1:
                raise OSError("temporary stable-file deletion failure")
        if path not in files:
            raise FileNotFoundError(path)
        files.remove(path)

    monkeypatch.setattr(calendar_images.storage.os, "remove", remove)
    assert run(remaining, now + timedelta(hours=1)) == []
    assert stable_attempts == 1
    assert files == {stable_path}
    post.assert_called_once()
    assert session.query.return_value.update.call_count == 2
    committed = deepcopy(settings)
    assert run(remaining, now + timedelta(hours=2)) == []
    assert stable_attempts == 2
    assert files == set()
    assert settings == committed
    assert session.query.return_value.update.call_count == 2
    assert session.commit.call_count == 2
    post.assert_called_once()
    assert run(remaining, now + timedelta(hours=3)) == []
    assert session.query.return_value.update.call_count == 2
    assert session.commit.call_count == 2
    post.assert_called_once()
    session.rollback.assert_not_called()


def test_persistence_fixture_consumes_updates_on_commit_and_rollback(calendar_generation):
    run, row, settings, session = calendar_generation
    now = datetime(2026, 9, 30, 10)
    run([row("AO", now - timedelta(days=1))], now)
    with pytest.raises(AssertionError, match="settings UPDATE must precede commit"):
        session.commit()
    session.query.return_value.update({"settings": deepcopy(settings)})
    session.rollback()
    with pytest.raises(AssertionError, match="settings UPDATE must precede commit"):
        session.commit()


@pytest.mark.parametrize("missing_operation", ["update", "commit"])
def test_settings_require_a_new_update_and_commit_each_run(calendar_generation, missing_operation):
    run, row, settings, session = calendar_generation
    now = datetime(2026, 9, 30, 10)
    rows = [row("AO", now - timedelta(days=1))]
    run(rows, now)
    before = deepcopy(settings)
    if missing_operation == "update":
        session.query.return_value.update.side_effect = lambda payload: None
    else:
        session.commit.side_effect = lambda: None
    assert len(run(rows, now + timedelta(hours=1), force=True)) == 1
    assert settings == before
    if missing_operation == "update":
        session.rollback.assert_called_once()


@pytest.mark.parametrize("schema", ["f3_staging", "f3_prod"])
@pytest.mark.parametrize("failure", ["later_export", "commit"])
def test_failure_preserves_all_persisted_images_and_rolls_back(calendar_generation, monkeypatch, failure, schema):
    run, row, settings, session = calendar_generation
    now = datetime(2026, 9, 30, 10)
    settings["calendar_weeks_shown"] = 2
    rows = [row("AO", now - timedelta(days=1), start_date=date(2026, 10, 1) + timedelta(weeks=i)) for i in range(2)]
    run(rows, now)
    before = deepcopy(settings)
    monkeypatch.setattr(calendar_images, "DB_SCHEMA", schema)
    copyfile = MagicMock()
    monkeypatch.setattr(calendar_images.storage.shutil, "copyfile", copyfile)
    remove = MagicMock()
    monkeypatch.setattr(calendar_images.storage.os, "remove", remove)
    if failure == "later_export":
        original = sys.modules["dataframe_image"].export

        def export(style, filename, **kwargs):
            if "-next-" in filename:
                raise RuntimeError("later week failed")
            original(style, filename, **kwargs)

        monkeypatch.setattr(sys.modules["dataframe_image"], "export", export)
    else:
        session.commit.side_effect = RuntimeError("commit failed")
    run(rows, now + timedelta(hours=1), force=True)
    assert settings == before
    session.rollback.assert_called_once()
    remove.assert_not_called()
    if schema == "f3_prod":
        assert copyfile.call_count == (1 if failure == "later_export" else 2)
    else:
        copyfile.assert_not_called()


def test_old_images_deleted_only_after_commit(calendar_generation, monkeypatch):
    run, row, settings, session = calendar_generation
    now = datetime(2026, 9, 30, 10)
    rows = [row("AO", now - timedelta(days=1))]
    run(rows, now)
    old = settings["calendar_image_current"]

    def remove(path):
        assert session.commit.call_count == 2
        assert settings["calendar_image_current"] != old
        assert path.endswith(old)

    monkeypatch.setattr(calendar_images.storage.os, "remove", remove)
    run(rows, now + timedelta(hours=1), force=True)


@pytest.mark.parametrize("copy_fails", [False, True])
def test_production_stable_copy_precedes_commit_and_failure_aborts_region(calendar_generation, monkeypatch, copy_fails):
    run, row, settings, session = calendar_generation
    now = datetime(2026, 9, 30, 10)
    rows = [row("AO", now - timedelta(days=1))]
    run(rows, now)
    before = deepcopy(settings)
    monkeypatch.setattr(calendar_images, "DB_SCHEMA", "f3_prod")

    def copy(source, destination):
        assert session.commit.call_count == 1
        assert settings == before
        assert destination == "/mnt/calendar-images/1-current.png"
        if copy_fails:
            raise OSError("stable copy failed")

    copy_mock = MagicMock(side_effect=copy)
    monkeypatch.setattr(calendar_images.storage.shutil, "copyfile", copy_mock)
    remove = MagicMock()
    monkeypatch.setattr(calendar_images.storage.os, "remove", remove)
    run(rows, now + timedelta(hours=1), force=True)
    copy_mock.assert_called_once()
    if copy_fails:
        assert settings == before
        assert session.commit.call_count == 1
        session.rollback.assert_called_once()
        remove.assert_not_called()
    else:
        assert session.commit.call_count == 2
        assert settings["calendar_image_current"] != before["calendar_image_current"]
        assert {call.args[0] for call in remove.call_args_list} == {
            f"/mnt/calendar-images/{before['calendar_image_current']}",
            "/mnt/calendar-images/1-next.png",
            "/mnt/calendar-images/1-third.png",
        }
        assert remove.call_count == 3


def test_row_order_does_not_invalidate_fingerprint(calendar_generation):
    run, row, settings, _ = calendar_generation
    now = datetime(2026, 9, 30, 10)
    rows = [row("AO A", now - timedelta(days=1)), row("AO B", now - timedelta(days=1))]
    run(rows, now)
    before = deepcopy(settings)
    assert run(list(reversed(rows)), now + timedelta(hours=1)) == []
    assert settings == before


def test_unused_metadata_does_not_invalidate_fingerprint(calendar_generation):
    run, row, settings, _ = calendar_generation
    now = datetime(2026, 9, 30, 10)
    run([row("AO", now - timedelta(days=1))], now)
    before = deepcopy(settings)
    changed = row(
        "AO",
        now - timedelta(hours=2),
        region_name="Renamed region",
        event_type="Renamed type",
    )
    assert run([changed], now + timedelta(hours=1)) == []
    assert settings == before


def test_calendar_colors_invalidate_fingerprint(calendar_generation):
    run, row, settings, _ = calendar_generation
    now = datetime(2026, 9, 30, 10)
    rows = [row("AO", now - timedelta(days=1))]
    run(rows, now)
    before = image_metadata(settings, now)[1]
    settings["open_event_color"] = "Red"
    assert len(run(rows, now + timedelta(hours=1))) == 1
    assert image_metadata(settings, now + timedelta(hours=1))[1] != before


def test_late_commit_with_old_transaction_start_is_detected(calendar_generation):
    run, row, settings, _ = calendar_generation
    now = datetime(2026, 9, 30, 10)
    transaction_start = now - timedelta(minutes=10)
    run([row("Before", transaction_start)], now)
    # Same transaction-start timestamp, but new snapshot after its late commit.
    assert len(run([row("After", transaction_start)], now + timedelta(hours=1))) == 1
    assert image_metadata(settings, now + timedelta(hours=1))[0] == (now + timedelta(hours=1)).replace(tzinfo=UTC)
