import os
import sys

import pytest

sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))
from utilities.helper_functions import format_event_time, is_deactivated_slack_user, safe_get


def test_safe_get():
    assert safe_get({"a": {"b": {"c": 1}}}, "a", "b", "c") == 1
    assert safe_get({"a": {"b": {"c": 1}}}, "a", "b", "d") is None


def test_is_deactivated_slack_user():
    assert is_deactivated_slack_user({"deleted": True}) is True
    assert is_deactivated_slack_user({"deleted": False}) is False
    assert is_deactivated_slack_user({}) is False


# ---------------------------------------------------------------------------
# format_event_time
#
# ``start_time`` is stored as a bare "HHMM" string, unlike ``start_date`` which
# is a ``datetime.date``. The read path does no validation — the model declares
# ``str | None`` and the API repository defaults it to "" — so None, empty and
# unparseable values all reach this formatter and must not raise. An exception
# here propagates out of ``build_preblast_info`` and stops the preblast posting.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("stored", "expected"),
    [
        ("0530", "05:30 AM"),
        ("0600", "06:00 AM"),
        ("1730", "05:30 PM"),
        ("2359", "11:59 PM"),
        ("0000", "12:00 AM"),  # midnight is 12 AM, not 00 AM
        ("1200", "12:00 PM"),  # noon is 12 PM, not 00 PM
        ("0059", "12:59 AM"),
        ("1259", "12:59 PM"),
    ],
)
def test_format_event_time_formats_stored_hhmm(stored, expected):
    assert format_event_time(stored) == expected


def test_format_event_time_uses_zero_padded_twelve_hour():
    """``%I`` matches the style already used in emergency.py and calendar_images.py.

    It is also the only portable choice: ``%-I`` is a glibc extension that fails
    on Windows, which needs ``%#I``.
    """
    assert format_event_time("0530") == "05:30 AM"
    assert format_event_time("0930") == "09:30 AM"


@pytest.mark.parametrize("stored", [None, ""])
def test_format_event_time_missing_value_returns_tbd(stored):
    """``None`` is the model default; ``""`` is written by the API repository."""
    assert format_event_time(stored) == "TBD"


@pytest.mark.parametrize("stored", ["5:30", "05:30", "abcd", "99999", "7", "530pm"])
def test_format_event_time_unparseable_falls_back_to_raw(stored):
    """Unrecognized values pass through unchanged rather than raising.

    Showing an odd string is cosmetic; raising here would propagate out of
    ``build_preblast_info`` and stop the preblast posting entirely.
    """
    assert format_event_time(stored) == stored


@pytest.mark.parametrize("stored", [None, "", "0530", "5:30", "abcd", "99999", "2400", "-100"])
def test_format_event_time_never_raises(stored):
    """No input reachable from storage may raise out of this function."""
    assert isinstance(format_event_time(stored), str)


def test_format_event_time_does_not_render_raw_hhmm():
    """The original defect: the stored value reaching Slack unformatted."""
    assert format_event_time("0530") != "0530"
