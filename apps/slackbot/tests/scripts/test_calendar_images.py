import os
import sys

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

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
