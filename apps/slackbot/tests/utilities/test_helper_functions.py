import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))
from utilities.helper_functions import is_deactivated_slack_user, safe_get


def test_safe_get():
    assert safe_get({"a": {"b": {"c": 1}}}, "a", "b", "c") == 1
    assert safe_get({"a": {"b": {"c": 1}}}, "a", "b", "d") is None


def test_is_deactivated_slack_user():
    assert is_deactivated_slack_user({"deleted": True}) is True
    assert is_deactivated_slack_user({"deleted": False}) is False
    assert is_deactivated_slack_user({}) is False
