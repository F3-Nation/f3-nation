"""Regression tests for date/time picker parsing in the shared form parsers.

Slack's ``view_submission`` payload exposes picker values under ``selected_date``
and ``selected_time`` — not under ``value``, which is only used by the text-input
family. Two of the repo's three form parsers grouped the pickers in with the
text inputs, so date/time fields parsed by ``extract_state_values`` or
``SdkBlockView.get_selected_values`` silently resolved to ``None``. The third
parser (``utilities.slack.orm.BlockView``) delegates to per-element classes and
was never affected.

See https://github.com/F3-Nation/f3-nation/issues/730
"""

import os
import sys


sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))
from utilities.helper_functions import extract_state_values  # noqa: E402
from utilities.slack.sdk_orm import SdkBlockView  # noqa: E402
from utilities.slack import actions  # noqa: E402

def _body(block_id: str, state: dict) -> dict:
    """Wraps a single element state in a realistic view_submission payload."""
    return {"view": {"state": {"values": {block_id: {block_id: state}}}}}


# ---------------------------------------------------------------------------
# extract_state_values
# ---------------------------------------------------------------------------


def test_extract_state_values_timepicker():
    body = _body("start_time", {"type": "timepicker", "selected_time": "05:30"})
    assert extract_state_values(body) == {"start_time": "05:30"}


def test_extract_state_values_datepicker():
    body = _body("start_date", {"type": "datepicker", "selected_date": "2026-08-07"})
    assert extract_state_values(body) == {"start_date": "2026-08-07"}


def test_extract_state_values_pickers_cleared_are_none():
    """An optional picker left empty sends a null — it must not raise."""
    assert extract_state_values(_body("t", {"type": "timepicker", "selected_time": None})) == {"t": None}
    assert extract_state_values(_body("d", {"type": "datepicker", "selected_date": None})) == {"d": None}


def test_extract_state_values_text_inputs_still_use_value():
    """Guards against the pickers being split out at the cost of the text family."""
    for element_type in ("plain_text_input", "email_text_input", "url_text_input", "number_input"):
        body = _body("field", {"type": element_type, "value": "unchanged"})
        assert extract_state_values(body) == {"field": "unchanged"}, element_type


def test_extract_state_values_preblast_form_mixed_payload():
    """Mixed payload using the preblast form's real block IDs (issue #730).

    Block IDs come from ``actions`` rather than literals: the form uses those
    constants (``preblast_views.py``), and they are not uniformly formatted —
    ``EVENT_PREBLAST_START_TIME`` is underscored while the other two are
    hyphenated. The parser is block-ID agnostic, so a drifted literal would
    never fail here.

    This exercises the parser only; see
    ``test_preblast_views.TestPreblastEditStartTimeIntegration`` for the
    handler path.
    """
    body = {
        "view": {
            "state": {
                "values": {
                    actions.EVENT_PREBLAST_START_TIME: {
                        actions.EVENT_PREBLAST_START_TIME: {
                            "type": "timepicker",
                            "selected_time": "05:30",
                        }
                    },
                    actions.EVENT_PREBLAST_TITLE: {
                        actions.EVENT_PREBLAST_TITLE: {
                            "type": "plain_text_input",
                            "value": "The Gauntlet",
                        }
                    },
                    actions.EVENT_PREBLAST_LOCATION: {
                        actions.EVENT_PREBLAST_LOCATION: {
                            "type": "static_select",
                            "selected_option": {"value": "12"},
                        }
                    },
                }
            }
        }
    }
    assert extract_state_values(body) == {
        actions.EVENT_PREBLAST_START_TIME: "05:30",
        actions.EVENT_PREBLAST_TITLE: "The Gauntlet",
        actions.EVENT_PREBLAST_LOCATION: "12",
    }


# ---------------------------------------------------------------------------
# SdkBlockView.get_selected_values
# ---------------------------------------------------------------------------


def test_sdk_block_view_timepicker():
    body = _body("start_time", {"type": "timepicker", "selected_time": "05:30"})
    assert SdkBlockView(blocks=[]).get_selected_values(body) == {"start_time": "05:30"}


def test_sdk_block_view_datepicker():
    body = _body("start_date", {"type": "datepicker", "selected_date": "2026-08-07"})
    assert SdkBlockView(blocks=[]).get_selected_values(body) == {"start_date": "2026-08-07"}


def test_sdk_block_view_text_inputs_still_use_value():
    body = _body("field", {"type": "plain_text_input", "value": "unchanged"})
    assert SdkBlockView(blocks=[]).get_selected_values(body) == {"field": "unchanged"}


# ---------------------------------------------------------------------------
# Parity — the two parsers must not drift apart again
# ---------------------------------------------------------------------------


def test_both_parsers_agree_on_pickers():
    for state, expected in (
        ({"type": "timepicker", "selected_time": "18:45"}, "18:45"),
        ({"type": "datepicker", "selected_date": "2026-12-25"}, "2026-12-25"),
    ):
        body = _body("field", state)
        assert extract_state_values(body) == {"field": expected}
        assert SdkBlockView(blocks=[]).get_selected_values(body) == {"field": expected}
