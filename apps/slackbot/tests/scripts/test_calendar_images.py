import os
import sys

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts.calendar_images import _normalize_label_series


def test_normalize_label_series_supports_nullable_mixed_values_without_float_suffixes():
    values = pd.Series([530, 530.0, float("nan"), None, "Q 1"])

    normalized = _normalize_label_series(values)

    assert normalized.tolist() == ["530", "530", "", "", "Q 1"]
    label = normalized.iloc[4] + "\n" + normalized.iloc[4] + " " + normalized.iloc[0]
    assert label == "Q 1\nQ 1 530"
