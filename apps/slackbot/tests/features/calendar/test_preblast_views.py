import os
import sys
import unittest
from datetime import date
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

from application.event_instance import EventInstanceData
from application.preblast.service import PreblastService
from features.calendar.preblast_views import PREBLAST_CHANNEL_SELECTOR, PreblastViews
from utilities.slack import actions
from utilities.slack.sdk_orm import SdkBlockView


def _event(**overrides) -> EventInstanceData:
    data = {
        "id": 1,
        "name": "The Grind",
        "org_id": 10,
        "event_type_ids": [5],
        "event_tag_ids": [],
        "start_date": date(2026, 7, 1),
        "start_time": "0600",
        "end_time": "0700",
        "series_id": 100,
        "highlight": False,
        "is_private": False,
        "meta": {},
    }
    data.update(overrides)
    return EventInstanceData(**data)


def _locations():
    return [
        {"id": 1, "name": "The Parking Lot"},
        {"id": 2, "name": "The Track"},
    ]


def _event_tags():
    return [
        {"id": 10, "name": "Hard Charger"},
        {"id": 20, "name": "Open"},
        {"id": 30, "name": "Convergence"},
    ]


class PreblastViewsTest(unittest.TestCase):
    def setUp(self):
        self.service = PreblastService()

    def _build_form(self, event, *, default_channel_id="CDEFAULT", existing_preblast_ts=None, **kw):
        return PreblastViews.build_preblast_form(
            event,
            locations=_locations(),
            event_tags=_event_tags(),
            event_types=[],
            preblast_service=self.service,
            default_channel_id=default_channel_id,
            existing_preblast_ts=existing_preblast_ts,
            **kw,
        )

    def test_build_preblast_form_returns_sdk_block_view(self):
        event = _event()
        result = self._build_form(event)
        self.assertIsInstance(result, SdkBlockView)
        self.assertGreater(len(result.blocks), 0)

    def test_build_preblast_form_sets_initial_title_and_time(self):
        event = _event(name="Beatdown Blast", start_time="0530")
        result = self._build_form(event)
        block_ids = [getattr(b, "block_id", None) for b in result.blocks]
        self.assertIn(actions.EVENT_PREBLAST_TITLE, block_ids)
        self.assertIn(actions.EVENT_PREBLAST_START_TIME, block_ids)

    def test_build_preblast_form_channel_selector_shown_when_eligible(self):
        event = _event(series_id=None)
        with patch.object(self.service, "is_channel_selector_eligible", return_value=True) as mock_eligible:
            result = self._build_form(event)
            mock_eligible.assert_called_once()
            block_ids = [getattr(b, "block_id", None) for b in result.blocks]
            self.assertIn(PREBLAST_CHANNEL_SELECTOR, block_ids)

    def test_build_preblast_form_shows_channel_selector_for_posted_preblast(self):
        """When editing an already-posted preblast, the channel selector must
        remain visible so the user can change the destination channel."""
        event = _event(series_id=None, preblast_ts=1234567890)
        with patch.object(self.service, "is_channel_selector_eligible", return_value=True):
            result = self._build_form(event, existing_preblast_ts=1234567890)
            block_ids = [getattr(b, "block_id", None) for b in result.blocks]
            self.assertIn(PREBLAST_CHANNEL_SELECTOR, block_ids)

    def test_build_preblast_form_channel_selector_hidden_when_not_eligible(self):
        event = _event(series_id=100, highlight=False, is_private=False)
        with patch.object(self.service, "is_channel_selector_eligible", return_value=False) as mock_eligible:
            result = self._build_form(event)
            mock_eligible.assert_called_once()
            block_ids = [getattr(b, "block_id", None) for b in result.blocks]
            self.assertNotIn(PREBLAST_CHANNEL_SELECTOR, block_ids)

    def test_build_preblast_form_hides_channel_when_no_default(self):
        event = _event(series_id=None)
        result = self._build_form(event, default_channel_id=None)
        block_ids = [getattr(b, "block_id", None) for b in result.blocks]
        self.assertNotIn(PREBLAST_CHANNEL_SELECTOR, block_ids)

    def test_build_preblast_form_shows_channel_hint_when_not_eligible(self):
        event = _event(series_id=100)
        with patch.object(self.service, "is_channel_selector_eligible", return_value=False):
            result = self._build_form(event)
            block_ids = [getattr(b, "block_id", None) for b in result.blocks]
            self.assertIn("preblast_channel_selector_hint", block_ids)

    def test_build_preblast_form_no_channel_hint_when_no_default(self):
        event = _event(series_id=100)
        result = self._build_form(event, default_channel_id=None)
        block_ids = [getattr(b, "block_id", None) for b in result.blocks]
        self.assertNotIn("preblast_channel_selector_hint", block_ids)

    def test_build_select_form_returns_sdk_block_view(self):
        events = [_event(id=1, name="Morning Madness"), _event(id=2, name="Evening Edge")]
        result = PreblastViews.build_select_form(events)
        self.assertIsInstance(result, SdkBlockView)
        self.assertGreater(len(result.blocks), 0)

    def test_build_select_form_shows_empty_when_no_events(self):
        result = PreblastViews.build_select_form([])
        block_ids = [getattr(b, "block_id", None) for b in result.blocks]
        self.assertIn("preblast_select_empty", block_ids)


if __name__ == "__main__":
    unittest.main()
