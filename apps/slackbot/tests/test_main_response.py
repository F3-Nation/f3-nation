import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import main_response


def test_calendar_shortcut_acknowledges_before_loading_form_and_handler():
    events = []
    ack = MagicMock(side_effect=lambda: events.append("ack"))
    add_loading_form = MagicMock(side_effect=lambda **_: events.append("loading"))
    handler = MagicMock(side_effect=lambda **_: events.append("handler"))
    body = {"type": "shortcut", "callback_id": "calendar_shortcut", "team": {"id": "T123"}}

    with (
        patch("main.MAIN_MAPPER", {"shortcut": {"calendar_shortcut": (handler, True, False)}}),
        patch("main.add_loading_form", add_loading_form),
        patch("main.get_region_record", return_value=MagicMock()),
    ):
        main_response(body, MagicMock(), MagicMock(), ack, {})

    assert events == ["ack", "loading", "handler"]
    ack.assert_called_once_with()
