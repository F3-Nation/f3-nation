import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts.calendar_images import _normalize_label_value


def test_normalize_label_value_supports_nullable_mixed_values_without_float_suffixes():
    values = [530, 530.0, float("nan"), None, "Q 1"]

    normalized = [_normalize_label_value(value) for value in values]

    assert normalized == ["530", "530", "", "", "Q 1"]
    label = normalized[4] + "\n" + normalized[4] + " " + normalized[0]
    assert label == "Q 1\nQ 1 530"
