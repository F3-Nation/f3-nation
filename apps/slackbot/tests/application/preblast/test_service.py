import os
import sys
import unittest
from datetime import date
from unittest.mock import MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

from application.event_instance import EventInstanceData
from application.preblast import (
    HC_ANNOUNCED_META_KEY,
    PREBLAST_CHANNEL_META_KEY,
    PREBLAST_POST_CHANNEL_META_KEY,
    PostMode,
    PreblastEventTypeData,
)
from application.preblast.service import PreblastService


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


def _announcement_ids(meta: dict, key: str) -> list[str]:
    return meta[HC_ANNOUNCED_META_KEY][key]


class PreblastServiceTest(unittest.TestCase):
    def setUp(self):
        self.service = PreblastService()

    def test_channel_selector_eligibility_table(self):
        cases = [
            ("normal first-f series", _event(), [PreblastEventTypeData(id=5, event_category="first_f")], False),
            ("one-off", _event(series_id=None), [PreblastEventTypeData(id=5, event_category="first_f")], True),
            ("highlight", _event(highlight=True), [PreblastEventTypeData(id=5, event_category="first_f")], True),
            ("private", _event(is_private=True), [PreblastEventTypeData(id=5, event_category="first_f")], True),
            ("second-f", _event(), [PreblastEventTypeData(id=5, event_category="second_f")], True),
            ("third-f", _event(), [PreblastEventTypeData(id=5, event_category="third_f")], True),
            ("unrelated type ignored", _event(), [PreblastEventTypeData(id=99, event_category="second_f")], False),
        ]
        for label, event, event_types, expected in cases:
            with self.subTest(label=label):
                self.assertEqual(self.service.is_channel_selector_eligible(event, event_types), expected)

    def test_channel_resolution_prefers_meta_over_default(self):
        selection = self.service.resolve_destination_channel(
            _event(meta={PREBLAST_CHANNEL_META_KEY: "COVERRIDE"}),
            default_channel_id="CDEFAULT",
        )
        self.assertEqual(selection.desired_channel_id, "COVERRIDE")
        self.assertEqual(selection.source, "event_meta")

    def test_channel_resolution_uses_default_when_no_override(self):
        selection = self.service.resolve_destination_channel(_event(meta={}), default_channel_id="CDEFAULT")
        self.assertEqual(selection.desired_channel_id, "CDEFAULT")
        self.assertEqual(selection.source, "default")

    def test_posted_channel_resolution_uses_meta_then_fallback(self):
        self.assertEqual(
            self.service.resolve_posted_channel(_event(meta={PREBLAST_POST_CHANNEL_META_KEY: "CPOST"}), "CFALLBACK"),
            "CPOST",
        )
        self.assertEqual(self.service.resolve_posted_channel(_event(meta={}), "CFALLBACK"), "CFALLBACK")

    def test_post_mode_decisions_table(self):
        cases = [
            ("save only", _event(preblast_ts=None), "C1", {"save_only": True}, PostMode.SAVE),
            ("no existing post", _event(preblast_ts=None), "C1", {}, PostMode.POST_NEW),
            (
                "force repost",
                _event(preblast_ts=111, meta={PREBLAST_POST_CHANNEL_META_KEY: "C1"}),
                "C1",
                {"force_repost": True},
                PostMode.POST_NEW,
            ),
            (
                "changed destination wins over force repost",
                _event(preblast_ts=111, meta={PREBLAST_POST_CHANNEL_META_KEY: "COLD"}),
                "CNEW",
                {"force_repost": True},
                PostMode.POST_NEW_CHANNEL,
            ),
            (
                "changed destination",
                _event(preblast_ts=111, meta={PREBLAST_POST_CHANNEL_META_KEY: "COLD"}),
                "CNEW",
                {},
                PostMode.POST_NEW_CHANNEL,
            ),
            (
                "same destination update",
                _event(preblast_ts=111, meta={PREBLAST_POST_CHANNEL_META_KEY: "C1"}),
                "C1",
                {},
                PostMode.UPDATE_EXISTING,
            ),
            (
                "updates disabled",
                _event(preblast_ts=111, meta={PREBLAST_POST_CHANNEL_META_KEY: "C1"}),
                "C1",
                {"update_existing": False},
                PostMode.POST_NEW,
            ),
            (
                "legacy posted channel fallback changed",
                _event(preblast_ts=111, meta={}),
                "CNEW",
                {"posted_channel_fallback_id": "COLD"},
                PostMode.POST_NEW_CHANNEL,
            ),
            (
                "legacy posted channel fallback same",
                _event(preblast_ts=111, meta={}),
                "COLD",
                {"posted_channel_fallback_id": "COLD"},
                PostMode.UPDATE_EXISTING,
            ),
            (
                "missing desired channel saves safely",
                _event(preblast_ts=None, meta={}),
                None,
                {},
                PostMode.SAVE,
            ),
        ]
        for label, event, desired_channel, flags, expected in cases:
            with self.subTest(label=label):
                decision = self.service.decide_post_mode(event, desired_channel, **flags)
                self.assertEqual(decision.mode, expected)

    def test_meta_merge_helpers_preserve_unrelated_keys(self):
        meta = {"keep": "yes"}
        desired = self.service.with_desired_channel_meta(meta, "CDEST")
        posted = self.service.with_posted_channel_meta(desired, "CPOST")
        self.assertEqual(posted["keep"], "yes")
        self.assertEqual(posted[PREBLAST_CHANNEL_META_KEY], "CDEST")
        self.assertEqual(posted[PREBLAST_POST_CHANNEL_META_KEY], "CPOST")

    def test_hc_announcement_dedupe_helpers(self):
        meta = self.service.mark_hc_announcement_sent({"keep": "yes"}, 20)
        meta = self.service.mark_hc_announcement_sent(meta, "20")
        meta = self.service.mark_hc_announcement_sent(meta, 30)
        self.assertTrue(self.service.has_hc_announcement_been_sent(meta, 20))
        self.assertFalse(self.service.has_hc_announcement_been_sent(meta, 40))
        self.assertEqual(_announcement_ids(meta, "hc"), ["20", "30"])
        self.assertEqual(meta["keep"], "yes")

    def test_hc_announcement_dedupe_supports_slack_user_ids(self):
        meta = self.service.mark_hc_announcement_sent({}, "U123", is_hc=True)
        meta = self.service.mark_hc_announcement_sent(meta, "U123", is_hc=True)
        meta = self.service.mark_hc_announcement_sent(meta, "U456", is_hc=False)
        self.assertTrue(self.service.has_hc_announcement_been_sent(meta, "U123", is_hc=True))
        self.assertFalse(self.service.has_hc_announcement_been_sent(meta, "U123", is_hc=False))
        self.assertTrue(self.service.has_hc_announcement_been_sent(meta, "U456", is_hc=False))
        self.assertEqual(_announcement_ids(meta, "hc"), ["U123"])
        self.assertEqual(_announcement_ids(meta, "unhc"), ["U456"])

    def test_hc_announcement_dedupe_distinguishes_hc_and_unhc(self):
        meta = self.service.mark_hc_announcement_sent({}, 20, is_hc=True)
        meta = self.service.mark_hc_announcement_sent(meta, 20, is_hc=False)
        self.assertTrue(self.service.has_hc_announcement_been_sent(meta, 20, is_hc=True))
        self.assertTrue(self.service.has_hc_announcement_been_sent(meta, 20, is_hc=False))
        self.assertEqual(_announcement_ids(meta, "hc"), ["20"])
        self.assertEqual(_announcement_ids(meta, "unhc"), ["20"])

    def test_build_update_command_assembles_event_update_payload(self):
        command = self.service.build_update_command(
            _event(id=55),
            name="New Title",
            preblast="plain",
            preblast_rich={"blocks": []},
            location_id=99,
            clear_location_id=False,
            start_date=date(2026, 8, 1),
            start_time="0530",
            event_tag_ids=[7],
            desired_channel_id="CDEST",
            meta_updates={"custom": "value"},
        )
        self.assertEqual(command.instance_id, 55)
        self.assertEqual(command.name, "New Title")
        self.assertEqual(command.preblast_channel_id, "CDEST")
        self.assertEqual(command.meta_updates, {"custom": "value"})

    def test_save_event_update_delegates_explicit_command(self):
        event_service = MagicMock()
        service = PreblastService(event_instance_service=event_service)
        command = service.build_update_command(_event(id=55), name="New Title", desired_channel_id="CDEST")
        service.save_event_update(command)
        event_service.update_preblast_fields.assert_called_once_with(
            instance_id=55,
            name="New Title",
            preblast_rich=None,
            preblast=None,
            location_id=None,
            clear_location_id=False,
            start_date=None,
            start_time=None,
            event_tag_ids=None,
            meta_updates=None,
            preblast_channel_id="CDEST",
        )

    def test_save_event_update_can_reuse_existing_event(self):
        event_service = MagicMock()
        service = PreblastService(event_instance_service=event_service)
        event = _event(id=55)
        command = service.build_update_command(event, name="New Title")
        service.save_event_update(command, existing_event=event)
        _, kwargs = event_service.update_preblast_fields.call_args
        self.assertEqual(kwargs["existing_instance"], event)

    def test_persist_posted_preblast_delegates_channel_persistence(self):
        event_service = MagicMock()
        service = PreblastService(event_instance_service=event_service)
        service.persist_posted_preblast(instance_id=55, preblast_ts=1234567890, channel_id="CPOST")
        event_service.persist_posted_preblast.assert_called_once_with(
            55,
            preblast_ts=1234567890,
            preblast_post_channel_id="CPOST",
        )

    def test_persist_posted_preblast_can_reuse_existing_event(self):
        event_service = MagicMock()
        service = PreblastService(event_instance_service=event_service)
        event = _event(id=55)
        service.persist_posted_preblast(
            instance_id=55,
            preblast_ts=1234567890,
            channel_id="CPOST",
            existing_event=event,
        )
        _, kwargs = event_service.persist_posted_preblast.call_args
        self.assertEqual(kwargs["existing_instance"], event)

    def test_attendance_transitions_delegate_when_service_available(self):
        attendance_service = MagicMock()
        service = PreblastService(attendance_service=attendance_service)
        service.add_hc("55", "20")
        service.remove_hc("55", "20")
        service.take_q("55", "20")
        service.remove_q("55", "20")
        service.assign_qs("55", "20", ["30"])
        attendance_service.add_hc.assert_called_once_with("55", "20")
        attendance_service.remove_hc.assert_called_once_with("55", "20")
        attendance_service.take_q.assert_called_once_with("55", "20")
        attendance_service.remove_q.assert_called_once_with("55", "20")
        attendance_service.assign_qs.assert_called_once_with("55", "20", ["30"])

    def test_attendance_transitions_raise_without_attendance_service(self):
        for method_name, args in [
            ("add_hc", ("55", "20")),
            ("remove_hc", ("55", "20")),
            ("take_q", ("55", "20")),
            ("remove_q", ("55", "20")),
            ("assign_qs", ("55", "20", ["30"])),
        ]:
            with self.subTest(method_name=method_name):
                with self.assertRaisesRegex(ValueError, "AttendanceService is required"):
                    getattr(self.service, method_name)(*args)


if __name__ == "__main__":
    unittest.main()
