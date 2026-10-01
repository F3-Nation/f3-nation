import os
import sys
from collections import namedtuple
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pandas as pd
import pytest
import pytz

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts import calendar_images
from scripts.calendar_images import _calendar_time_sort_key, _normalize_label_value, _prepare_calendar_labels


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
    for method in ("select_from", "join", "outerjoin", "filter"):
        getattr(query, method).return_value = query
    exports = []

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is None:
                return now
            return pytz.UTC.localize(now).astimezone(tz)

    def event_row(ao_name, updated, q_updated=None):
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
        return namedtuple("CalendarRow", values)(**values)

    def export(style, filename, **kwargs):
        exports.append((filename, style.data.copy()))

    def run(rows, at, force=False):
        nonlocal now
        now = at
        exports.clear()
        session.query.return_value.all.side_effect = [rows, [], [(SimpleNamespace(id=1), None, space)]]
        calendar_images.generate_calendar_images(force=force)
        return list(exports)

    monkeypatch.setitem(sys.modules, "dataframe_image", SimpleNamespace(export=export))
    monkeypatch.setattr(calendar_images, "get_session", lambda: session)
    monkeypatch.setattr(calendar_images, "datetime", Clock)
    monkeypatch.setattr(calendar_images, "current_date_cst", lambda: date(2026, 9, 30))
    monkeypatch.setattr(calendar_images, "LOCAL_DEVELOPMENT", False)
    monkeypatch.setattr(calendar_images, "DB_SCHEMA", "f3_staging")
    monkeypatch.setattr(calendar_images, "update_local_region_records", lambda: None)
    monkeypatch.setattr(calendar_images.os, "remove", lambda path: None)
    monkeypatch.setattr(pd.DataFrame, "to_csv", lambda *args, **kwargs: None)
    return run, event_row, settings, session


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
    assert settings["calendar_image_current_generated_at"] == next_run.replace(tzinfo=UTC).isoformat()

    # An unchanged week does not keep rebuilding, even on the next hourly run.
    rebuilt_image = settings["calendar_image_current"]
    assert run([control, event], next_run + timedelta(hours=1)) == []
    assert settings["calendar_image_current"] == rebuilt_image
    assert settings["calendar_image_current_generated_at"] == next_run.replace(tzinfo=UTC).isoformat()
    assert len(run([control, event], next_run + timedelta(hours=1), force=True)) == 1


def test_legacy_image_without_watermark_rebuilds_once(calendar_generation):
    run, row, settings, _ = calendar_generation
    now = datetime(2026, 9, 30, 10)
    settings["calendar_image_current"] = "legacy.png"
    rows = [row("One-time AO", now - timedelta(days=2))]
    assert len(run(rows, now)) == 1
    assert settings["calendar_image_current_generated_at"] == now.replace(tzinfo=UTC).isoformat()
    assert run(rows, now + timedelta(hours=1)) == []


def test_failed_export_keeps_previous_image_and_watermark(calendar_generation, monkeypatch):
    run, row, settings, _ = calendar_generation
    now = datetime(2026, 9, 30, 10)
    settings.update(
        calendar_image_current="existing.png", calendar_image_current_generated_at=now.replace(tzinfo=UTC).isoformat()
    )

    fail_export = MagicMock(side_effect=RuntimeError("Export failed"))
    monkeypatch.setattr(sys.modules["dataframe_image"], "export", fail_export)
    assert run([row("One-time AO", now + timedelta(seconds=1))], now + timedelta(hours=2)) == []
    fail_export.assert_called_once()
    assert settings["calendar_image_current"] == "existing.png"
    assert settings["calendar_image_current_generated_at"] == now.replace(tzinfo=UTC).isoformat()


def test_changes_during_rendering_remain_pending(calendar_generation, monkeypatch):
    run, row, settings, _ = calendar_generation
    now = datetime(2026, 9, 30, 10)
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
    assert settings["calendar_image_current_generated_at"] == now.replace(tzinfo=UTC).isoformat()
    monkeypatch.setattr(calendar_images, "datetime", query_clock)
    monkeypatch.setattr(sys.modules["dataframe_image"], "export", real_export)
    assert len(run(rows, now + timedelta(hours=2))) == 1


@pytest.mark.parametrize("watermark", [None, "", "invalid", 123, {}, "2026-09-30T10:00:00"])
def test_invalid_watermark_regenerates_without_crashing(calendar_generation, watermark):
    run, row, settings, _ = calendar_generation
    now = datetime(2026, 9, 30, 10)
    settings.update(calendar_image_current="existing.png", calendar_image_current_generated_at=watermark)
    assert len(run([row("One-time AO", now - timedelta(days=2))], now)) == 1
    assert settings["calendar_image_current_generated_at"] == now.replace(tzinfo=UTC).isoformat()
    assert run([row("One-time AO", now - timedelta(days=2))], now + timedelta(hours=1)) == []


@pytest.mark.parametrize("updated", [datetime(2026, 9, 30, 10), datetime(2026, 9, 30, 10, tzinfo=UTC)])
def test_watermark_compares_utc_database_timestamps_with_offset(updated):
    settings = {"calendar_image_current_generated_at": "2026-09-30T05:00:00-05:00"}
    assert not calendar_images.calendar_image_is_stale(settings, "current", updated)
    assert calendar_images.calendar_image_is_stale(settings, "current", updated + timedelta(seconds=1))


def test_generated_settings_refresh_region_cache(calendar_generation, monkeypatch):
    from utilities import helper_functions

    run, row, settings, _ = calendar_generation
    now = datetime(2026, 9, 30, 10)
    cache = {}
    monkeypatch.setattr(helper_functions, "REGION_RECORDS", cache)
    monkeypatch.setattr(
        helper_functions.DbManager, "find_records", lambda *args, **kwargs: [SimpleNamespace(settings=settings)]
    )
    monkeypatch.setattr(calendar_images, "update_local_region_records", helper_functions.update_local_region_records)
    assert len(run([row("One-time AO", now)], now)) == 1
    # Exercise all three persisted keys through the real cache refresh.
    settings.update(
        calendar_image_next_generated_at=settings["calendar_image_current_generated_at"],
        calendar_image_third_generated_at=settings["calendar_image_current_generated_at"],
    )
    helper_functions.update_local_region_records()
    region = cache[settings["team_id"]]
    for week in ("current", "next", "third"):
        assert getattr(region, f"calendar_image_{week}_generated_at") == now.replace(tzinfo=UTC).isoformat()


@pytest.mark.parametrize("num_weeks", [1, 2])
def test_stale_week_cleanup_removes_image_and_watermark(monkeypatch, num_weeks):
    monkeypatch.setattr(calendar_images, "LOCAL_DEVELOPMENT", True)
    settings = {}
    for week in ("current", "next", "third"):
        settings[f"calendar_image_{week}"] = f"{week}.png"
        settings[f"calendar_image_{week}_generated_at"] = "2026-09-30T10:00:00+00:00"
    assert calendar_images.remove_stale_week_images(settings, 1, num_weeks)
    for index, week in enumerate(("current", "next", "third")):
        assert (f"calendar_image_{week}" in settings) == (index < num_weeks)
        assert (f"calendar_image_{week}_generated_at" in settings) == (index < num_weeks)


def test_stale_week_cleanup_marks_orphaned_watermark_for_persistence():
    settings = {"calendar_image_third_generated_at": "invalid"}
    assert calendar_images.remove_stale_week_images(settings, 1, 2)
    assert settings == {}
