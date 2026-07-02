import os
import sys
import unittest
from unittest.mock import MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

from infrastructure.api_client.exceptions import F3ApiNotFoundError
from infrastructure.api_client.series_repository import ApiSeriesRepository, _parse_series


def _raw_series_list(
    id: int = 1,
    name: str = "Test Series",
    is_active: bool = True,
    day_of_week: str = "monday",
    start_date: str = "2025-01-06",
    start_time: str = "0530",
    end_time: str = "0615",
    parent_id: int = 10,
    region_id: int = 5,
    event_type_id: int | None = None,
) -> dict:
    """Simulates a record from GET /v1/event (list)."""
    raw: dict = {
        "id": id,
        "name": name,
        "isActive": is_active,
        "isPrivate": False,
        "dayOfWeek": day_of_week,
        "startDate": start_date,
        "startTime": start_time,
        "endTime": end_time,
        "highlight": False,
        "description": None,
        "locationId": None,
        "meta": None,
        "parents": [{"parentId": parent_id, "parentName": "AO Name"}],
        "regions": [{"regionId": region_id, "regionName": "Region Name"}],
        "eventTypes": [],
    }
    if event_type_id is not None:
        raw["eventTypes"] = [{"eventTypeId": event_type_id, "eventTypeName": "Bootcamp"}]
    return raw


def _raw_series_by_id(
    id: int = 1,
    name: str = "Test Series",
    is_active: bool = True,
    day_of_week: str = "monday",
    start_date: str = "2025-01-06",
    start_time: str = "0530",
    end_time: str = "0615",
    ao_id: int = 10,
    region_id: int = 5,
    event_type_id: int | None = None,
    highlight: bool = False,
    meta: dict | None = None,
) -> dict:
    """Simulates a record from GET /v1/event/id/{id}."""
    raw: dict = {
        "id": id,
        "name": name,
        "isActive": is_active,
        "isPrivate": False,
        "dayOfWeek": day_of_week,
        "startDate": start_date,
        "startTime": start_time,
        "endTime": end_time,
        "highlight": highlight,
        "description": None,
        "locationId": None,
        "meta": meta,
        "aos": [{"aoId": ao_id, "aoName": "AO Name"}],
        "regions": [{"regionId": region_id, "regionName": "Region Name"}],
        "eventTypes": [],
    }
    if event_type_id is not None:
        raw["eventTypes"] = [{"eventTypeId": event_type_id, "eventTypeName": "Bootcamp"}]
    return raw


def _raw_crupdate_response(
    id: int = 1,
    name: str = "Test Series",
    org_id: int = 10,
    region_id: int = 5,
    start_date: str = "2025-01-06",
    start_time: str = "0530",
    end_time: str = "0615",
    day_of_week: str = "monday",
) -> dict:
    """Simulates the POST /v1/event (crupdate) response envelope."""
    return {
        "event": {
            "id": id,
            "name": name,
            "orgId": org_id,
            "regionId": region_id,
            "isActive": True,
            "isPrivate": False,
            "highlight": False,
            "startDate": start_date,
            "endDate": None,
            "startTime": start_time,
            "endTime": end_time,
            "dayOfWeek": day_of_week,
            "description": None,
            "locationId": None,
            "meta": None,
        }
    }


class ParseSeriesTest(unittest.TestCase):
    def test_parse_list_response_uses_parents_for_org_id(self):
        raw = _raw_series_list(parent_id=10, region_id=5)
        data = _parse_series(raw)
        self.assertEqual(data.org_id, 10)
        self.assertEqual(data.region_id, 5)

    def test_parse_by_id_response_uses_aos_for_org_id(self):
        raw = _raw_series_by_id(ao_id=10, region_id=5)
        data = _parse_series(raw)
        self.assertEqual(data.org_id, 10)
        self.assertEqual(data.region_id, 5)

    def test_parse_crupdate_response_uses_org_id_directly(self):
        raw = _raw_crupdate_response(org_id=10, region_id=5)["event"]
        data = _parse_series(raw)
        self.assertEqual(data.org_id, 10)

    def test_parse_event_type_ids_from_nested_dict(self):
        raw = _raw_series_list(event_type_id=42)
        data = _parse_series(raw)
        self.assertEqual(data.event_type_ids, [42])

    def test_parse_event_tag_ids_always_empty(self):
        raw = _raw_series_list()
        data = _parse_series(raw)
        self.assertEqual(data.event_tag_ids, [])

    def test_parse_camelcase_fields(self):
        raw = _raw_series_list(
            start_date="2025-06-02",
            start_time="0600",
            end_time="0645",
            day_of_week="tuesday",
        )
        data = _parse_series(raw)
        self.assertEqual(data.start_date, "2025-06-02")
        self.assertEqual(data.start_time, "0600")
        self.assertEqual(data.end_time, "0645")
        self.assertEqual(data.day_of_week, "tuesday")

    def test_parse_highlight_from_get_by_id(self):
        raw = _raw_series_by_id(highlight=True)
        data = _parse_series(raw)
        self.assertTrue(data.highlight)

    def test_parse_meta_from_get_by_id(self):
        raw = _raw_series_by_id(meta={"do_not_send_auto_preblasts": True})
        data = _parse_series(raw)
        self.assertEqual(data.meta, {"do_not_send_auto_preblasts": True})


class ApiSeriesRepositoryTest(unittest.TestCase):
    def setUp(self):
        self.client = MagicMock()
        self.repo = ApiSeriesRepository(self.client)

    # ------------------------------------------------------------------
    # get_by_region
    # ------------------------------------------------------------------

    def test_get_by_region_uses_region_ids(self):
        self.client.get.return_value = {"events": [_raw_series_list(id=1), _raw_series_list(id=2)]}
        result = self.repo.get_by_region(region_id=5)
        self.client.get.assert_called_once_with("/v1/event", params={"regionIds": [5], "statuses": ["active"]})
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].id, 1)

    def test_get_by_region_with_ao_id_uses_ao_ids(self):
        self.client.get.return_value = {"events": [_raw_series_list(id=3)]}
        result = self.repo.get_by_region(region_id=5, ao_id=10)
        self.client.get.assert_called_once_with("/v1/event", params={"aoIds": [10], "statuses": ["active"]})
        self.assertEqual(result[0].id, 3)

    def test_get_by_region_supports_results_fallback(self):
        self.client.get.return_value = {"results": [_raw_series_list(id=5)]}
        result = self.repo.get_by_region(region_id=5)
        self.assertEqual(len(result), 1)

    def test_get_by_region_returns_empty_list_on_no_key(self):
        self.client.get.return_value = {"unexpected": []}
        result = self.repo.get_by_region(region_id=5)
        self.assertEqual(result, [])

    # ------------------------------------------------------------------
    # get_by_id
    # ------------------------------------------------------------------

    def test_get_by_id_returns_series(self):
        self.client.get.return_value = {"event": _raw_series_by_id(id=7)}
        result = self.repo.get_by_id(7)
        self.client.get.assert_called_once_with("/v1/event/id/7")
        self.assertIsNotNone(result)
        self.assertEqual(result.id, 7)

    def test_get_by_id_returns_none_when_not_found(self):
        self.client.get.side_effect = F3ApiNotFoundError(404, "not found")
        result = self.repo.get_by_id(999)
        self.assertIsNone(result)

    def test_get_by_id_supports_result_fallback(self):
        self.client.get.return_value = {"result": _raw_series_by_id(id=8)}
        result = self.repo.get_by_id(8)
        self.assertIsNotNone(result)
        self.assertEqual(result.id, 8)

    # ------------------------------------------------------------------
    # create
    # ------------------------------------------------------------------

    def test_create_posts_to_event_endpoint_without_id(self):
        self.client.post.return_value = _raw_crupdate_response(id=99)
        result = self.repo.create(
            region_id=5,
            ao_id=10,
            name="New Series",
            start_date="2025-01-06",
            start_time="0530",
            end_time="0615",
            day_of_week="monday",
            description=None,
            location_id=None,
            end_date=None,
            recurrence_pattern="weekly",
            recurrence_interval=1,
            index_within_interval=1,
            event_type_ids=[42],
            event_tag_ids=[],
            is_active=True,
            is_private=False,
            highlight=False,
            meta=None,
        )
        self.client.post.assert_called_once()
        payload = self.client.post.call_args.kwargs["json"]
        self.assertNotIn("id", payload)
        self.assertEqual(payload["name"], "New Series")
        self.assertEqual(payload["regionId"], 5)
        self.assertEqual(payload["aoId"], 10)
        self.assertTrue(payload["isActive"])
        self.assertEqual(payload["eventTypeIds"], [42])
        self.assertEqual(result.id, 99)

    def test_create_includes_optional_fields_when_set(self):
        self.client.post.return_value = _raw_crupdate_response(id=1)
        self.repo.create(
            region_id=5,
            ao_id=10,
            name="Series",
            start_date="2025-01-06",
            start_time="0530",
            end_time="0615",
            day_of_week="friday",
            description="A workout",
            location_id=20,
            end_date="2026-01-01",
            recurrence_pattern="weekly",
            recurrence_interval=1,
            index_within_interval=1,
            event_type_ids=[],
            event_tag_ids=[7],
            is_active=True,
            is_private=True,
            highlight=True,
            meta={"key": "val"},
        )
        payload = self.client.post.call_args.kwargs["json"]
        self.assertEqual(payload["locationId"], 20)
        self.assertEqual(payload["endDate"], "2026-01-01")
        self.assertEqual(payload["description"], "A workout")
        self.assertTrue(payload["isPrivate"])
        self.assertTrue(payload["highlight"])
        self.assertEqual(payload["eventTagIds"], [7])
        self.assertEqual(payload["meta"], {"key": "val"})

    # ------------------------------------------------------------------
    # update
    # ------------------------------------------------------------------

    def test_update_posts_with_id(self):
        self.client.post.return_value = _raw_crupdate_response(id=1)
        self.repo.update(
            series_id=1,
            region_id=5,
            ao_id=10,
            name="Updated Series",
            start_date="2025-01-06",
            start_time="0600",
            end_time="0645",
            description=None,
            location_id=None,
            end_date=None,
            event_type_ids=[42],
            event_tag_ids=[],
            is_active=True,
            is_private=False,
            highlight=False,
            meta=None,
        )
        payload = self.client.post.call_args.kwargs["json"]
        self.assertEqual(payload["id"], 1)
        self.assertEqual(payload["name"], "Updated Series")

    def test_update_omits_day_of_week(self):
        """day_of_week is immutable on edit and should not be sent."""
        self.client.post.return_value = _raw_crupdate_response(id=1)
        self.repo.update(
            series_id=1,
            region_id=5,
            ao_id=10,
            name="Series",
            start_date="2025-01-06",
            start_time="0530",
            end_time="0615",
            description=None,
            location_id=None,
            end_date=None,
            event_type_ids=[],
            event_tag_ids=[],
            is_active=True,
            is_private=False,
            highlight=False,
            meta=None,
        )
        payload = self.client.post.call_args.kwargs["json"]
        self.assertNotIn("dayOfWeek", payload)

    # ------------------------------------------------------------------
    # delete
    # ------------------------------------------------------------------

    def test_delete_calls_delete_endpoint(self):
        self.repo.delete(7)
        self.client.delete.assert_called_once_with("/v1/event/delete/7")


if __name__ == "__main__":
    unittest.main()
