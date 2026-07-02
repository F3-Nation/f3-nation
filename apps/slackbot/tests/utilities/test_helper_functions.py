import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))
from utilities.helper_functions import safe_get


def test_safe_get():
    assert safe_get({"a": {"b": {"c": 1}}}, "a", "b", "c") == 1
    assert safe_get({"a": {"b": {"c": 1}}}, "a", "b", "d") is None
