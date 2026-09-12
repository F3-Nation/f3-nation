import os
import sys

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts.calendar_images import _normalize_label_value, _prepare_calendar_labels


def test_normalize_label_value_supports_nullable_mixed_values_without_float_suffixes():
    values = [530, 530.0, float("nan"), None, "Q 1"]

    normalized = [_normalize_label_value(value) for value in values]

    assert normalized == ["530", "530", "", "", "Q 1"]
    label = normalized[4] + "\n" + normalized[4] + " " + normalized[0]
    assert label == "Q 1\nQ 1 530"


def test_prepare_calendar_labels_constructs_expected_label_branches():
    events = pd.DataFrame(
        {
            "start_time": [530.0, 615.0, 700.0, 745.0],
            "q_name": [None, "Q Alpha", "Q Bravo", "Q Charlie"],
            "event_acronym": ["EC", "EC", "EC", "EC"],
            "event_tag": [None, None, "Special", "Tagged"],
            "pax_count": [None, None, None, 12.0],
            "ao_name": ["AO"] * 4,
            "ao_description": [None] * 4,
            "location_name": [None] * 4,
            "location_description": [None] * 4,
            "location_address_street": [None] * 4,
        }
    )

    _prepare_calendar_labels(events)

    assert events["event_time"].tolist() == ["530", "615", "700", "745"]
    assert events["label"].tolist() == [
        "OPEN!\nEC 530",
        "Q Alpha\nEC 615",
        "Q Bravo\nSpecial\n700",
        "Q Charlie\nTagged\nPAX: 12",
    ]
