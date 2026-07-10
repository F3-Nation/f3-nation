import os
import sys
import unittest
from datetime import date
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

from application.event_instance import EventInstanceData
from application.attendance import AttendanceData, HC_TYPE_ID, Q_TYPE_ID
from application.preblast.service import PreblastService
from features.calendar.event_preblast import handle_event_preblast_edit
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

    def test_build_preblast_form_shows_send_options_when_not_posted(self):
        """New preblast with a channel should show send options radio."""
        event = _event(preblast_ts=None)
        result = self._build_form(event, existing_preblast_ts=None)
        block_ids = [getattr(b, "block_id", None) for b in result.blocks]
        self.assertIn(actions.EVENT_PREBLAST_SEND_OPTIONS, block_ids)

    def test_build_preblast_form_shows_update_mode_when_posted(self):
        """Already-posted preblast should show update/repost radio."""
        event = _event(preblast_ts=1234567890)
        result = self._build_form(event, existing_preblast_ts=1234567890)
        block_ids = [getattr(b, "block_id", None) for b in result.blocks]
        self.assertIn(actions.EVENT_PREBLAST_UPDATE_MODE, block_ids)
        self.assertNotIn(actions.EVENT_PREBLAST_SEND_OPTIONS, block_ids)

    def test_build_preblast_form_shows_no_channel_notice_when_no_channel(self):
        """When no channel is set, show a notice instead of send options."""
        event = _event()
        result = self._build_form(event, default_channel_id=None)
        block_ids = [getattr(b, "block_id", None) for b in result.blocks]
        self.assertIn("preblast_no_channel_notice", block_ids)
        self.assertNotIn(actions.EVENT_PREBLAST_SEND_OPTIONS, block_ids)

    def test_build_preblast_form_loads_existing_preblast_rich(self):
        """Preblast rich text should always be loaded as initial value, not
        only when the preblast has been posted."""
        event = _event(preblast_rich={"type": "rich_text", "elements": []})
        result = self._build_form(event, existing_preblast_ts=None)
        # The rich text input block should exist
        block_ids = [getattr(b, "block_id", None) for b in result.blocks]
        self.assertIn(actions.EVENT_PREBLAST_MOLESKINE_EDIT, block_ids)
        # Check that the initial value was set
        rich_block = next(b for b in result.blocks if getattr(b, "block_id", None) == actions.EVENT_PREBLAST_MOLESKINE_EDIT)
        self.assertIsNotNone(rich_block.element.initial_value)

    def test_build_preblast_form_preloads_existing_coqs(self):
        event = _event()
        result = self._build_form(event, initial_coq_slack_ids=["UCOQ1", "UCOQ2"])

        coq_block = next(
            b for b in result.blocks
            if getattr(b, "block_id", None) == actions.EVENT_PREBLAST_COQS
        )
        self.assertEqual(coq_block.element.initial_users, ["UCOQ1", "UCOQ2"])

    def test_build_preblast_form_uses_moleskin_template_fallback(self):
        """When event has no preblast_rich, fall back to moleskin template."""
        event = _event(preblast_rich=None)
        result = self._build_form(
            event,
            existing_preblast_ts=None,
            preblast_moleskin_template={"type": "rich_text", "elements": [{"type": "text", "text": "template"}]},
        )
        rich_block = next(
            b for b in result.blocks
            if getattr(b, "block_id", None) == actions.EVENT_PREBLAST_MOLESKINE_EDIT
        )
        self.assertIsNotNone(rich_block.element.initial_value)

    def test_build_select_form_returns_sdk_block_view(self):
        events = [_event(id=1, name="Morning Madness"), _event(id=2, name="Evening Edge")]
        result = PreblastViews.build_select_form(events)
        self.assertIsInstance(result, SdkBlockView)
        self.assertGreater(len(result.blocks), 0)

    def test_build_select_form_shows_empty_when_no_events(self):
        result = PreblastViews.build_select_form([])
        block_ids = [getattr(b, "block_id", None) for b in result.blocks]
        self.assertIn("preblast_select_empty", block_ids)

    @patch("features.calendar.event_preblast.get_user")
    @patch("features.calendar.event_preblast.extract_state_values")
    @patch("features.calendar.event_preblast._build_attendance_service")
    @patch("features.calendar.event_preblast._build_event_instance_service")
    @patch("features.calendar.event_preblast._build_preblast_service")
    def test_handle_event_preblast_edit_preserves_existing_q_when_assigning_coq(
        self,
        mock_build_preblast_service,
        mock_build_event_service,
        mock_build_attendance_service,
        mock_extract_state_values,
        mock_get_user,
    ):
        event_id = 42
        existing_q_user_id = 100
        coq_user_id = 200
        event = _event(id=event_id)

        preblast_service = MagicMock()
        preblast_service.build_update_command.return_value = object()
        preblast_service.save_event_update.return_value = event
        mock_build_preblast_service.return_value = preblast_service

        event_service = MagicMock()
        event_service.get_by_id.return_value = event
        mock_build_event_service.return_value = event_service

        attendance_service = MagicMock()
        attendance_service.get_planned_for_event_instance.return_value = [
            AttendanceData(
                id=1,
                event_instance_id=event_id,
                user_id=existing_q_user_id,
                attendance_type_ids=[HC_TYPE_ID, Q_TYPE_ID],
            )
        ]
        mock_build_attendance_service.return_value = attendance_service

        mock_extract_state_values.return_value = {
            actions.EVENT_PREBLAST_COQS: ["USLACKCOQ"],
        }
        mock_get_user.return_value = MagicMock(user_id=coq_user_id)

        body = {
            "view": {
                "private_metadata": f'{{"event_instance_id": {event_id}, "preblast_ts": "None"}}'
            }
        }

        handle_event_preblast_edit(body, MagicMock(), MagicMock(), {}, MagicMock())

        preblast_service.assign_qs.assert_called_once_with(
            event_id,
            existing_q_user_id,
            [coq_user_id],
        )


if __name__ == "__main__":
    unittest.main()
