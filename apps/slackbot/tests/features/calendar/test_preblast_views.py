import os
import sys
import unittest
from datetime import date
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

from application.attendance import CO_Q_TYPE_ID, HC_TYPE_ID, Q_TYPE_ID, AttendanceData
from application.event_instance import EventInstanceData
from application.preblast.service import PreblastService
from features.calendar import get_preblast_action_blocks
from features.calendar.event_preblast import build_preblast_info, handle_event_preblast_edit
from features.calendar.preblast_views import PREBLAST_CHANNEL_SELECTOR, PreblastViews
from utilities import constants
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

    def _build_form(self, event, *, default_channel_id: str | None = "CDEFAULT", existing_preblast_ts=None, **kw):
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
        rich_block = next(b for b in result.blocks if b.block_id == actions.EVENT_PREBLAST_MOLESKINE_EDIT)
        self.assertIsNotNone(rich_block.element.initial_value)

    def test_build_preblast_form_preloads_existing_coqs(self):
        event = _event()
        result = self._build_form(event, initial_coq_slack_ids=["UCOQ1", "UCOQ2"])

        coq_block = next(b for b in result.blocks if b.block_id == actions.EVENT_PREBLAST_COQS)
        self.assertEqual(coq_block.element.initial_users, ["UCOQ1", "UCOQ2"])

    def test_build_preblast_form_uses_moleskin_template_fallback(self):
        """When event has no preblast_rich, fall back to moleskin template."""
        event = _event(preblast_rich=None)
        result = self._build_form(
            event,
            existing_preblast_ts=None,
            preblast_moleskin_template={"type": "rich_text", "elements": [{"type": "text", "text": "template"}]},
        )
        rich_block = next(b for b in result.blocks if b.block_id == actions.EVENT_PREBLAST_MOLESKINE_EDIT)
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

    def test_preblast_action_blocks_do_not_show_remove_q(self):
        blocks = [block.as_form_field() for block in get_preblast_action_blocks(has_q=True, event_instance_id=42)]
        action_ids = [
            element["action_id"]
            for block in blocks
            for element in block.get("elements", [])
            if element.get("type") == "button"
        ]

        self.assertNotIn(actions.EVENT_PREBLAST_TAKE_Q, action_ids)
        self.assertNotIn(actions.EVENT_PREBLAST_REMOVE_Q, action_ids)

    def test_build_preblast_form_shows_remove_q_button_for_q(self):
        event = _event()
        result = self._build_form(event, user_is_q=True)

        action_ids = [
            getattr(element, "action_id", None) for block in result.blocks for element in getattr(block, "elements", [])
        ]

        self.assertIn(actions.EVENT_PREBLAST_REMOVE_Q, action_ids)

    @patch("f3_data_models.utils.DbManager.find_records")
    @patch("features.calendar.event_preblast._build_attendance_service")
    @patch("features.calendar.event_preblast._build_event_instance_service")
    def test_build_preblast_info_uses_f3_name_fallback_when_slack_id_missing(
        self,
        mock_build_event_service,
        mock_build_attendance_service,
        mock_find_records,
    ):
        event_id = 42
        event_service = MagicMock()
        event_service.get_by_id.return_value = _event(id=event_id, org_name="The AO")
        mock_build_event_service.return_value = event_service

        attendance_service = MagicMock()
        attendance_service.get_planned_for_event_instance.return_value = [
            AttendanceData(
                id=1,
                event_instance_id=event_id,
                user_id=100,
                f3_name="Dredd",
                attendance_type_ids=[HC_TYPE_ID, Q_TYPE_ID],
            ),
            AttendanceData(
                id=2,
                event_instance_id=event_id,
                user_id=200,
                f3_name="Ghost",
                attendance_type_ids=[HC_TYPE_ID, CO_Q_TYPE_ID],
            ),
        ]
        mock_build_attendance_service.return_value = attendance_service
        mock_find_records.return_value = [MagicMock(user_id=200, slack_id="UGHOST")]

        preblast_info = build_preblast_info(
            logger=MagicMock(),
            region_record=MagicMock(team_id="T123"),
            event_instance_id=event_id,
        )

        event_details = preblast_info.preblast_blocks[0]["text"]["text"]
        self.assertIn("*Q:* @Dredd <@UGHOST>", event_details)
        self.assertIn("*HCs:* @Dredd <@UGHOST>", event_details)
        self.assertNotIn("*Q:* Open!", event_details)
        self.assertNotIn("*HCs:* None", event_details)

    @patch("f3_data_models.utils.DbManager.find_records")
    @patch("features.calendar.event_preblast._build_attendance_service")
    @patch("features.calendar.event_preblast._build_event_instance_service")
    def test_build_preblast_info_formats_start_time_for_display(
        self,
        mock_build_event_service,
        mock_build_attendance_service,
        mock_find_records,
    ):
        """The posted preblast renders a readable time, not the stored HHMM value.

        Unit tests cover ``format_event_time`` itself; this pins the rendering
        path so the formatter cannot be dropped from ``build_preblast_info``
        without a test failing.
        """
        event_id = 42
        event_service = MagicMock()
        event_service.get_by_id.return_value = _event(id=event_id, start_time="0530")
        mock_build_event_service.return_value = event_service

        attendance_service = MagicMock()
        attendance_service.get_planned_for_event_instance.return_value = []
        mock_build_attendance_service.return_value = attendance_service
        mock_find_records.return_value = []

        preblast_info = build_preblast_info(
            logger=MagicMock(),
            region_record=MagicMock(team_id="T123"),
            event_instance_id=event_id,
        )

        event_details = preblast_info.preblast_blocks[0]["text"]["text"]
        self.assertIn("*Time:* 05:30 AM", event_details)
        self.assertNotIn("*Time:* 0530", event_details)

    @patch("f3_data_models.utils.DbManager.find_records")
    @patch("features.calendar.event_preblast._build_attendance_service")
    @patch("features.calendar.event_preblast._build_event_instance_service")
    def test_build_preblast_info_renders_tbd_when_start_time_missing(
        self,
        mock_build_event_service,
        mock_build_attendance_service,
        mock_find_records,
    ):
        """Preserves the previous ``or 'TBD'`` behavior for unset times."""
        event_id = 43
        event_service = MagicMock()
        event_service.get_by_id.return_value = _event(id=event_id, start_time=None)
        mock_build_event_service.return_value = event_service

        attendance_service = MagicMock()
        attendance_service.get_planned_for_event_instance.return_value = []
        mock_build_attendance_service.return_value = attendance_service
        mock_find_records.return_value = []

        preblast_info = build_preblast_info(
            logger=MagicMock(),
            region_record=MagicMock(team_id="T123"),
            event_instance_id=event_id,
        )

        event_details = preblast_info.preblast_blocks[0]["text"]["text"]
        self.assertIn("*Time:* TBD", event_details)

    @patch("f3_data_models.utils.DbManager.find_records", side_effect=RuntimeError("db unavailable"))
    @patch("features.calendar.event_preblast._build_attendance_service")
    @patch("features.calendar.event_preblast._build_event_instance_service")
    def test_build_preblast_info_raises_when_slack_id_resolution_fails(
        self,
        mock_build_event_service,
        mock_build_attendance_service,
        _mock_find_records,
    ):
        event_id = 42
        event_service = MagicMock()
        event_service.get_by_id.return_value = _event(id=event_id)
        mock_build_event_service.return_value = event_service

        attendance_service = MagicMock()
        attendance_service.get_planned_for_event_instance.return_value = [
            AttendanceData(
                id=1,
                event_instance_id=event_id,
                user_id=100,
                f3_name="Dredd",
                attendance_type_ids=[HC_TYPE_ID, Q_TYPE_ID],
            )
        ]
        mock_build_attendance_service.return_value = attendance_service
        logger = MagicMock()

        with self.assertRaises(RuntimeError):
            build_preblast_info(
                logger=logger,
                region_record=MagicMock(team_id="T123"),
                event_instance_id=event_id,
            )
        logger.exception.assert_called_once()

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

        body = {"view": {"private_metadata": f'{{"event_instance_id": {event_id}, "preblast_ts": "None"}}'}}

        handle_event_preblast_edit(body, MagicMock(), MagicMock(), {}, MagicMock())

        preblast_service.assign_qs.assert_called_once_with(
            event_id,
            existing_q_user_id,
            [coq_user_id],
        )

    @patch("features.calendar.event_preblast.get_user")
    @patch("features.calendar.event_preblast.extract_state_values")
    @patch("features.calendar.event_preblast._build_attendance_service")
    @patch("features.calendar.event_preblast._build_event_instance_service")
    @patch("features.calendar.event_preblast._build_preblast_service")
    def test_handle_event_preblast_edit_clears_coqs_when_multiselect_is_empty(
        self,
        mock_build_preblast_service,
        mock_build_event_service,
        mock_build_attendance_service,
        mock_extract_state_values,
        mock_get_user,
    ):
        event_id = 42
        existing_q_user_id = 100
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
            actions.EVENT_PREBLAST_COQS: [],
        }

        body = {"view": {"private_metadata": f'{{"event_instance_id": {event_id}, "preblast_ts": "None"}}'}}

        handle_event_preblast_edit(body, MagicMock(), MagicMock(), {}, MagicMock())

        mock_get_user.assert_not_called()
        preblast_service.assign_qs.assert_called_once_with(
            event_id,
            existing_q_user_id,
            [],
        )

    @patch("features.calendar.event_preblast.update_submission_wait_view")
    @patch("features.calendar.event_preblast.get_user")
    @patch("features.calendar.event_preblast.extract_state_values")
    @patch("features.calendar.event_preblast._build_attendance_service")
    @patch("features.calendar.event_preblast._build_event_instance_service")
    @patch("features.calendar.event_preblast._build_preblast_service")
    def test_handle_event_preblast_edit_surfaces_unresolved_coq_and_skips_assignment(
        self,
        mock_build_preblast_service,
        mock_build_event_service,
        mock_build_attendance_service,
        mock_extract_state_values,
        mock_get_user,
        mock_update_submission_wait_view,
    ):
        event_id = 42
        event = _event(id=event_id)

        preblast_service = MagicMock()
        preblast_service.build_update_command.return_value = object()
        preblast_service.save_event_update.return_value = event
        mock_build_preblast_service.return_value = preblast_service

        event_service = MagicMock()
        event_service.get_by_id.return_value = event
        mock_build_event_service.return_value = event_service

        attendance_service = MagicMock()
        mock_build_attendance_service.return_value = attendance_service

        mock_extract_state_values.return_value = {
            actions.EVENT_PREBLAST_COQS: ["UBADCOQ"],
        }
        mock_get_user.side_effect = RuntimeError("not found")

        body = {
            "view": {
                "id": "V_SUBMISSION_1",
                "private_metadata": f'{{"event_instance_id": {event_id}, "preblast_ts": "None"}}',
            }
        }

        handle_event_preblast_edit(body, MagicMock(), MagicMock(), {}, MagicMock())

        preblast_service.assign_qs.assert_not_called()
        attendance_service.get_planned_for_event_instance.assert_not_called()
        mock_update_submission_wait_view.assert_called_once()
        _, kwargs = mock_update_submission_wait_view.call_args
        self.assertEqual(kwargs["title"], "Co-Qs not saved")
        self.assertIn("<@UBADCOQ>", kwargs["text"])
        self.assertEqual(kwargs["level"], constants.AlertLevel.ERROR)
        self.assertEqual(kwargs["view_id"], "V_SUBMISSION_1")

    @patch("features.calendar.event_preblast.update_submission_wait_view")
    @patch("features.calendar.event_preblast.get_user")
    @patch("features.calendar.event_preblast.extract_state_values")
    @patch("features.calendar.event_preblast._build_attendance_service")
    @patch("features.calendar.event_preblast._build_event_instance_service")
    @patch("features.calendar.event_preblast._build_preblast_service")
    def test_handle_event_preblast_edit_surfaces_assign_qs_failure(
        self,
        mock_build_preblast_service,
        mock_build_event_service,
        mock_build_attendance_service,
        mock_extract_state_values,
        mock_get_user,
        mock_update_submission_wait_view,
    ):
        event_id = 42
        existing_q_user_id = 100
        coq_user_id = 200
        event = _event(id=event_id)

        preblast_service = MagicMock()
        preblast_service.build_update_command.return_value = object()
        preblast_service.save_event_update.return_value = event
        preblast_service.assign_qs.side_effect = RuntimeError("api failed")
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
                "id": "V_SUBMISSION_2",
                "private_metadata": f'{{"event_instance_id": {event_id}, "preblast_ts": "None"}}',
            }
        }

        handle_event_preblast_edit(body, MagicMock(), MagicMock(), {}, MagicMock())

        preblast_service.assign_qs.assert_called_once_with(
            event_id,
            existing_q_user_id,
            [coq_user_id],
        )
        mock_update_submission_wait_view.assert_called_once()
        _, kwargs = mock_update_submission_wait_view.call_args
        self.assertEqual(kwargs["title"], "Co-Qs not saved")
        self.assertIn("<@USLACKCOQ>", kwargs["text"])
        self.assertEqual(kwargs["level"], constants.AlertLevel.ERROR)
        self.assertEqual(kwargs["view_id"], "V_SUBMISSION_2")


class TestPreblastEditStartTimeIntegration(unittest.TestCase):
    """Pins the parse → handler → service path that issue #730 broke.

    Deliberately does NOT patch ``extract_state_values``: the bug lived in the
    parser, and every other test in this file injects an already-parsed dict,
    so the real payload shape was never exercised.
    """

    @patch("features.calendar.event_preblast.get_user")
    @patch("features.calendar.event_preblast._build_attendance_service")
    @patch("features.calendar.event_preblast._build_event_instance_service")
    @patch("features.calendar.event_preblast._build_preblast_service")
    def test_start_time_reaches_service_from_raw_payload(
        self,
        mock_build_preblast_service,
        mock_build_event_service,
        mock_build_attendance_service,
        mock_get_user,
    ):
        event_id = 42
        event = _event(id=event_id, start_time="0600")

        preblast_service = MagicMock()
        preblast_service.build_update_command.return_value = object()
        preblast_service.save_event_update.return_value = event
        mock_build_preblast_service.return_value = preblast_service

        event_service = MagicMock()
        event_service.get_by_id.return_value = event
        mock_build_event_service.return_value = event_service

        attendance_service = MagicMock()
        attendance_service.get_planned_for_event_instance.return_value = []
        mock_build_attendance_service.return_value = attendance_service

        body = {
            "view": {
                "private_metadata": f'{{"event_instance_id": {event_id}, "preblast_ts": "None"}}',
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
                    }
                },
            }
        }

        handle_event_preblast_edit(body, MagicMock(), MagicMock(), {}, MagicMock())

        kwargs = preblast_service.build_update_command.call_args.kwargs
        self.assertEqual(kwargs["start_time"], "0530")
        self.assertEqual(kwargs["name"], "The Gauntlet")


if __name__ == "__main__":
    unittest.main()
