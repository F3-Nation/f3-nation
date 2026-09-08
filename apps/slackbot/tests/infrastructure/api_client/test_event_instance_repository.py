import os
import sys
import unittest
from datetime import date
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

from application.event_instance import EventInstanceData
from infrastructure.api_client.event_instance_repository import (
    ApiEventInstanceRepository,
    get_api_event_instance_repository,
)
from infrastructure.api_client.exceptions import F3ApiNotFoundError


def _instance(**overrides) -> EventInstanceData:
    """A fully-populated instance, as the close/reopen/preblast paths require."""
    fields: dict = {
        "id": 5,
        "name": "The Grind",
        "org_id": 10,
        "location_id": 3,
        "event_type_ids": [1],
        "event_tag_ids": [],
        "start_date": date(2026, 6, 1),
        "start_time": "0600",
        "end_time": "0700",
        "is_active": True,
        "is_private": False,
        "highlight": False,
    }
    fields.update(overrides)
    return EventInstanceData(**fields)


class BuildCrupdatePayloadTest(unittest.TestCase):
    """The outgoing crupdate payload is the Slackbot's half of the API contract.

    Regression: the API renamed `eventTypeId` to an `eventTypeIds` array. zod
    strips unknown keys, so every Slackbot-created instance silently landed with
    no event type at all — no error, nothing in the join table. Nothing here
    pinned the field name, so nothing failed. These assertions are that pin: if
    the wire name changes again, this file fails before a region notices.
    """

    def setUp(self):
        self.client = MagicMock()
        self.repo = ApiEventInstanceRepository(self.client)
        self.client.post.return_value = {"id": 5}

    def _posted_payload(self) -> dict:
        self.client.post.assert_called_once()
        args, kwargs = self.client.post.call_args
        self.assertEqual(args[0], "/v1/event-instance")
        return kwargs["json"]

    def test_create_posts_singular_event_type_id(self):
        self.repo.create(
            name="New Event",
            org_id=10,
            start_date=date(2026, 6, 1),
            start_time="0600",
            end_time="0700",
            description=None,
            location_id=3,
            event_type_ids=[7],
            event_tag_ids=[],
            is_active=True,
            is_private=False,
            meta=None,
            highlight=False,
            preblast_rich=None,
            preblast=None,
        )

        payload = self._posted_payload()
        self.assertEqual(payload["eventTypeId"], 7)
        self.assertEqual(payload["orgId"], 10)
        self.assertEqual(payload["startDate"], "2026-06-01")
        self.assertEqual(payload["startTime"], "0600")
        self.assertNotIn("id", payload)

    def test_create_collapses_multiple_event_types_to_the_first(self):
        """The wire field is singular, so only the first id survives the trip."""
        self.repo.create(
            name="New Event",
            org_id=10,
            start_date=date(2026, 6, 1),
            start_time="0600",
            end_time="0700",
            description=None,
            location_id=None,
            event_type_ids=[7, 8],
            event_tag_ids=[],
            is_active=True,
            is_private=False,
            meta=None,
            highlight=False,
            preblast_rich=None,
            preblast=None,
        )

        self.assertEqual(self._posted_payload()["eventTypeId"], 7)

    def test_create_sends_zero_when_no_event_type_is_selected(self):
        """0 is not a valid event type id — the API must read it as 'not provided'
        rather than clearing or inserting a bogus foreign key."""
        self.repo.create(
            name="New Event",
            org_id=10,
            start_date=date(2026, 6, 1),
            start_time="0600",
            end_time="0700",
            description=None,
            location_id=None,
            event_type_ids=[],
            event_tag_ids=[],
            is_active=True,
            is_private=False,
            meta=None,
            highlight=False,
            preblast_rich=None,
            preblast=None,
        )

        self.assertEqual(self._posted_payload()["eventTypeId"], 0)

    def test_create_omits_optional_fields_that_were_not_supplied(self):
        """Omission means 'leave it alone' on the API side, so an unset optional
        must not be sent as null."""
        self.repo.create(
            name="New Event",
            org_id=10,
            start_date=date(2026, 6, 1),
            start_time="0600",
            end_time="0700",
            description=None,
            location_id=None,
            event_type_ids=[7],
            event_tag_ids=[],
            is_active=True,
            is_private=False,
            meta=None,
            highlight=False,
            preblast_rich=None,
            preblast=None,
        )

        payload = self._posted_payload()
        for absent in ("locationId", "description", "meta", "preblast", "preblastRich", "eventTagId"):
            self.assertNotIn(absent, payload)

    def test_create_sends_first_event_tag_id(self):
        self.repo.create(
            name="New Event",
            org_id=10,
            start_date=date(2026, 6, 1),
            start_time="0600",
            end_time="0700",
            description="Notes",
            location_id=3,
            event_type_ids=[7],
            event_tag_ids=[4, 5],
            is_active=True,
            is_private=False,
            meta={"a": 1},
            highlight=True,
            preblast_rich={"blocks": []},
            preblast="text",
        )

        payload = self._posted_payload()
        self.assertEqual(payload["eventTagId"], 4)
        self.assertEqual(payload["description"], "Notes")
        self.assertEqual(payload["locationId"], 3)
        self.assertEqual(payload["meta"], {"a": 1})
        self.assertTrue(payload["highlight"])

    def test_update_sends_the_id_alongside_the_event_type(self):
        self.repo.update(
            instance_id=5,
            name="Renamed",
            org_id=10,
            start_date=date(2026, 6, 1),
            start_time="0700",
            end_time="0800",
            description=None,
            location_id=3,
            event_type_ids=[7],
            event_tag_ids=[],
            is_active=True,
            is_private=False,
            meta=None,
            highlight=False,
            preblast_rich=None,
            preblast=None,
        )

        payload = self._posted_payload()
        self.assertEqual(payload["id"], 5)
        self.assertEqual(payload["eventTypeId"], 7)
        self.assertEqual(payload["startTime"], "0700")

    def test_update_does_not_send_a_series_exception(self):
        """A plain time edit leaves the exception untouched: the field is absent,
        so the API preserves whatever is stored."""
        self.repo.update(
            instance_id=5,
            name="Renamed",
            org_id=10,
            start_date=date(2026, 6, 1),
            start_time="0700",
            end_time="0800",
            description=None,
            location_id=3,
            event_type_ids=[7],
            event_tag_ids=[],
            is_active=True,
            is_private=False,
            meta=None,
            highlight=False,
            preblast_rich=None,
            preblast=None,
        )

        self.assertNotIn("seriesException", self._posted_payload())


class StateChangeTest(unittest.TestCase):
    def setUp(self):
        self.client = MagicMock()
        self.repo = ApiEventInstanceRepository(self.client)
        self.client.post.return_value = {"id": 5}

    def _posted_payload(self) -> dict:
        _, kwargs = self.client.post.call_args
        return kwargs["json"]

    def test_close_sends_closed_exception_and_meta(self):
        self.repo.close(_instance(), {"series_exception_reason": "weather"})

        payload = self._posted_payload()
        self.assertEqual(payload["id"], 5)
        self.assertEqual(payload["seriesException"], "closed")
        self.assertEqual(payload["meta"], {"series_exception_reason": "weather"})
        self.assertEqual(payload["eventTypeId"], 1)

    def test_reopen_clears_the_exception_explicitly(self):
        """Null, not omitted — this one has to overwrite the stored value."""
        self.repo.reopen(_instance())

        payload = self._posted_payload()
        self.assertIsNone(payload["seriesException"])

    def test_state_change_rejects_an_instance_with_no_event_type(self):
        """The guard that turns a typeless instance into a Slack-visible error.

        An instance created while the `eventTypeId` regression was live has no
        event type, so close/reopen raise here rather than posting — the failure
        surfaces long after the create that caused it.
        """
        with self.assertRaises(ValueError) as ctx:
            self.repo.close(_instance(event_type_ids=[]), {})

        self.assertIn("event_type_ids", str(ctx.exception))
        self.client.post.assert_not_called()

    def test_state_change_rejects_an_instance_missing_a_start_time(self):
        with self.assertRaises(ValueError) as ctx:
            self.repo.close(_instance(start_time=None), {})

        self.assertIn("start_time", str(ctx.exception))
        self.client.post.assert_not_called()


class ParseInstanceTest(unittest.TestCase):
    def setUp(self):
        self.client = MagicMock()
        self.repo = ApiEventInstanceRepository(self.client)

    def test_get_by_id_parses_nested_event_types_and_display_data(self):
        self.client.get.return_value = {
            "id": 5,
            "name": "The Grind",
            "orgId": 10,
            "locationId": 3,
            "startDate": "2026-06-01",
            "startTime": "0600",
            "endTime": "0700",
            "isActive": True,
            "isPrivate": False,
            "highlight": False,
            "seriesId": 2,
            "seriesException": None,
            "org": {"id": 10, "name": "The Dark Tower", "parentId": 5, "meta": {"k": "v"}},
            "eventTypes": [{"eventTypeId": 1, "eventTypeName": "Bootcamp"}],
            "eventTags": [{"eventTagId": 4, "eventTagName": "VQ"}],
            "location": {"id": 3, "locationName": "The Field", "latitude": 1.5, "longitude": -2.5},
        }

        result = self.repo.get_by_id(5)

        self.client.get.assert_called_once_with("/v1/event-instance/id/5")
        self.assertIsNotNone(result)
        self.assertEqual(result.event_type_ids, [1])
        self.assertEqual(result.event_type_names, ["Bootcamp"])
        self.assertEqual(result.event_tag_ids, [4])
        self.assertEqual(result.start_date, date(2026, 6, 1))
        self.assertEqual(result.org_name, "The Dark Tower")
        self.assertEqual(result.location_name, "The Field")
        self.assertEqual(result.series_id, 2)

    def test_get_by_id_falls_back_to_a_singular_event_type_id(self):
        self.client.get.return_value = {
            "id": 5,
            "name": "The Grind",
            "orgId": 10,
            "startDate": "2026-06-01",
            "eventTypeId": 9,
        }

        result = self.repo.get_by_id(5)

        self.assertIsNotNone(result)
        self.assertEqual(result.event_type_ids, [9])

    def test_get_by_id_returns_none_for_not_found(self):
        self.client.get.side_effect = F3ApiNotFoundError(404, "not found")

        self.assertIsNone(self.repo.get_by_id(123))

    def test_get_list_passes_the_region_and_start_date_filters(self):
        self.client.get.return_value = {"eventInstances": []}

        self.repo.get_list(region_org_id=5, start_date=date(2026, 6, 1))

        self.client.get.assert_called_once_with(
            "/v1/event-instance",
            params={"regionOrgId": 5, "startDate": "2026-06-01"},
        )

    def test_get_list_adds_the_ao_filter_when_given(self):
        self.client.get.return_value = {"results": []}

        self.repo.get_list(region_org_id=5, start_date=date(2026, 6, 1), ao_org_id=10)

        _, kwargs = self.client.get.call_args
        self.assertEqual(kwargs["params"]["aoOrgId"], 10)

    def test_delete_calls_expected_endpoint(self):
        self.repo.delete(44)

        self.client.delete.assert_called_once_with("/v1/event-instance/id/44")


class PreblastFieldsTest(unittest.TestCase):
    def setUp(self):
        self.client = MagicMock()
        self.repo = ApiEventInstanceRepository(self.client)
        self.client.post.return_value = {"id": 5}

    def _posted_payload(self) -> dict:
        _, kwargs = self.client.post.call_args
        return kwargs["json"]

    def test_updating_the_time_carries_the_existing_event_type_through(self):
        """The preblast edit rebuilds the whole payload from the stored instance,
        so the event type has to survive a change that never mentions it."""
        self.repo.update_preblast_fields(
            5,
            start_time="0730",
            existing_instance=_instance(event_type_ids=[3]),
        )

        payload = self._posted_payload()
        self.assertEqual(payload["id"], 5)
        self.assertEqual(payload["startTime"], "0730")
        self.assertEqual(payload["eventTypeId"], 3)
        self.assertEqual(payload["locationId"], 3)

    def test_clearing_the_location_sends_an_explicit_null(self):
        self.repo.update_preblast_fields(
            5,
            clear_location_id=True,
            existing_instance=_instance(),
        )

        self.assertIsNone(self._posted_payload()["locationId"])

    def test_clearing_the_tags_sends_an_explicit_null(self):
        self.repo.update_preblast_fields(
            5,
            event_tag_ids=[],
            existing_instance=_instance(event_tag_ids=[4]),
        )

        self.assertIsNone(self._posted_payload()["eventTagId"])

    def test_the_preblast_channel_is_merged_into_meta(self):
        self.repo.update_preblast_fields(
            5,
            preblast_channel_id="C123",
            existing_instance=_instance(meta={"existing": True}),
        )

        meta = self._posted_payload()["meta"]
        self.assertEqual(meta["preblast_channel_id"], "C123")
        self.assertTrue(meta["existing"])

    def test_an_acknowledgement_only_response_falls_back_to_the_local_update(self):
        """The API returns the updated row, but the parser must not depend on it."""
        self.client.post.return_value = {"ok": True}

        result = self.repo.update_preblast_fields(
            5,
            name="Renamed",
            existing_instance=_instance(),
        )

        self.assertEqual(result.id, 5)
        self.assertEqual(result.name, "Renamed")

    def test_a_missing_instance_is_rejected_before_any_write(self):
        self.client.get.side_effect = F3ApiNotFoundError(404, "not found")

        with self.assertRaises(ValueError):
            self.repo.update_preblast_fields(5, start_time="0730")

        self.client.post.assert_not_called()


class RepositorySingletonTest(unittest.TestCase):
    @patch("infrastructure.api_client.event_instance_repository.get_f3_api_client")
    def test_get_api_event_instance_repository_returns_singleton(self, mock_get_client):
        mock_get_client.return_value = MagicMock()
        with patch("infrastructure.api_client.event_instance_repository._repo", None):
            first = get_api_event_instance_repository()
            second = get_api_event_instance_repository()

        self.assertIs(first, second)


if __name__ == "__main__":
    unittest.main()
