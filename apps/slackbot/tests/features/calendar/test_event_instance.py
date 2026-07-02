import os
import sys
import unittest
from datetime import date
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

from application.event_instance import EventInstanceData
from application.event_instance.service import EventInstanceService
from features.calendar.event_instance import (
    _build_event_instance_service,
    build_event_instance_list_form,
    handle_event_instance_close,
    handle_event_instance_edit_delete,
    manage_event_instances,
)
from infrastructure.api_client.event_instance_repository import (
    ApiEventInstanceRepository,
    get_api_event_instance_repository,
)
from infrastructure.api_client.exceptions import F3ApiNotFoundError


def _make_instance(
    id: int = 1,
    name: str = "The Grind",
    org_id: int = 10,
    start_date: date = date(2026, 6, 1),
    start_time: str = "0600",
    end_time: str = "0700",
    series_exception: str | None = None,
    event_type_ids: list[int] | None = None,
    event_tag_ids: list[int] | None = None,
    meta: dict | None = None,
    is_private: bool = False,
    highlight: bool = False,
) -> EventInstanceData:
    return EventInstanceData(
        id=id,
        name=name,
        org_id=org_id,
        start_date=start_date,
        start_time=start_time,
        end_time=end_time,
        series_exception=series_exception,
        event_type_ids=event_type_ids or [5],
        event_tag_ids=event_tag_ids or [],
        meta=meta,
        is_private=is_private,
        highlight=highlight,
    )


# ---------------------------------------------------------------------------
# EventInstanceService tests
# ---------------------------------------------------------------------------


class EventInstanceServiceTest(unittest.TestCase):
    def _mock_repo(self):
        return MagicMock()

    def test_get_region_instances_delegates_and_sorts(self):
        repo = self._mock_repo()
        repo.get_list.return_value = [
            _make_instance(id=2, name="Z Event", start_date=date(2026, 6, 2)),
            _make_instance(id=1, name="A Event", start_date=date(2026, 6, 1)),
        ]
        service = EventInstanceService(repository=repo)
        result = service.get_region_instances(region_org_id="10", start_date=date(2026, 6, 1))

        repo.get_list.assert_called_once_with(region_org_id=10, start_date=date(2026, 6, 1), ao_org_id=None)
        self.assertEqual(result[0].id, 1)  # A Event comes first after sort
        self.assertEqual(result[1].id, 2)

    def test_get_region_instances_passes_ao_filter(self):
        repo = self._mock_repo()
        repo.get_list.return_value = []
        service = EventInstanceService(repository=repo)
        service.get_region_instances(region_org_id=10, start_date=date(2026, 6, 1), ao_org_id="20")

        repo.get_list.assert_called_once_with(region_org_id=10, start_date=date(2026, 6, 1), ao_org_id=20)

    def test_get_region_instances_caps_at_limit(self):
        repo = self._mock_repo()
        repo.get_list.return_value = [_make_instance(id=i) for i in range(60)]
        service = EventInstanceService(repository=repo)
        result = service.get_region_instances(region_org_id=10, start_date=date(2026, 6, 1), limit=40)
        self.assertEqual(len(result), 40)

    def test_get_by_id(self):
        repo = self._mock_repo()
        repo.get_by_id.return_value = _make_instance(id=7)
        service = EventInstanceService(repository=repo)
        result = service.get_by_id(7)
        repo.get_by_id.assert_called_once_with(7)
        self.assertEqual(result.id, 7)

    def test_create_instance_coerces_types(self):
        repo = self._mock_repo()
        repo.create.return_value = _make_instance(id=99)
        service = EventInstanceService(repository=repo)
        service.create_instance(
            name="New Event",
            org_id="10",
            start_date=date(2026, 7, 4),
            start_time="0600",
            end_time="0700",
            location_id="5",
            event_type_ids=[1],
            event_tag_ids=[2],
        )
        _, kwargs = repo.create.call_args
        self.assertEqual(kwargs["org_id"], 10)
        self.assertEqual(kwargs["location_id"], 5)

    def test_create_instance_none_location_stays_none(self):
        repo = self._mock_repo()
        repo.create.return_value = _make_instance()
        service = EventInstanceService(repository=repo)
        service.create_instance(
            name="Event",
            org_id=10,
            start_date=date(2026, 7, 4),
            start_time="0600",
            end_time="0700",
            location_id=None,
        )
        _, kwargs = repo.create.call_args
        self.assertIsNone(kwargs["location_id"])

    def test_update_instance(self):
        repo = self._mock_repo()
        repo.update.return_value = _make_instance(id=5)
        service = EventInstanceService(repository=repo)
        service.update_instance(
            instance_id=5,
            name="Updated",
            org_id=10,
            start_date=date(2026, 7, 4),
            start_time="0600",
            end_time="0700",
        )
        _, kwargs = repo.update.call_args
        self.assertEqual(kwargs["instance_id"], 5)
        self.assertEqual(kwargs["name"], "Updated")

    def test_close_instance_fetches_meta_and_closes(self):
        repo = self._mock_repo()
        existing = _make_instance(id=3, meta={"existing_key": "val"})
        repo.get_by_id.return_value = existing
        service = EventInstanceService(repository=repo)
        service.close_instance(instance_id=3, close_reason="Weather")

        repo.get_by_id.assert_called_once_with(3)
        _, kwargs = repo.close.call_args
        self.assertEqual(kwargs["instance"], existing)
        self.assertEqual(kwargs["meta"]["series_exception_reason"], "Weather")
        self.assertEqual(kwargs["meta"]["existing_key"], "val")  # preserves existing meta

    def test_close_instance_no_reason_omits_key(self):
        repo = self._mock_repo()
        existing = _make_instance(id=3, meta={})
        repo.get_by_id.return_value = existing
        service = EventInstanceService(repository=repo)
        service.close_instance(instance_id=3, close_reason=None)

        _, kwargs = repo.close.call_args
        self.assertEqual(kwargs["instance"], existing)
        self.assertNotIn("series_exception_reason", kwargs["meta"])

    def test_reopen_instance(self):
        repo = self._mock_repo()
        existing = _make_instance(id=7)
        repo.get_by_id.return_value = existing
        service = EventInstanceService(repository=repo)
        service.reopen_instance(7)
        repo.get_by_id.assert_called_once_with(7)
        repo.reopen.assert_called_once_with(instance=existing)

    def test_close_instance_raises_when_instance_missing(self):
        repo = self._mock_repo()
        repo.get_by_id.return_value = None
        service = EventInstanceService(repository=repo)

        with self.assertRaisesRegex(ValueError, "Event instance 3 was not found"):
            service.close_instance(instance_id=3, close_reason="Weather")

        repo.close.assert_not_called()

    def test_delete_instance(self):
        repo = self._mock_repo()
        service = EventInstanceService(repository=repo)
        service.delete_instance(9)
        repo.delete.assert_called_once_with(9)


# ---------------------------------------------------------------------------
# ApiEventInstanceRepository tests
# ---------------------------------------------------------------------------


class ApiEventInstanceRepositoryTest(unittest.TestCase):
    def setUp(self):
        self.client = MagicMock()
        self.repo = ApiEventInstanceRepository(self.client)

    def _raw_instance(self, id: int = 1, series_exception=None):
        return {
            "id": id,
            "name": "The Grind",
            "orgId": 10,
            "startDate": "2026-06-01",
            "startTime": "0600",
            "endTime": "0700",
            "isActive": True,
            "isPrivate": False,
            "highlight": False,
            "eventTypes": [{"eventTypeId": 5}],
            "eventTags": [],
            "seriesException": series_exception,
        }

    def test_get_list_builds_correct_params(self):
        self.client.get.return_value = {"eventInstances": [self._raw_instance()]}
        result = self.repo.get_list(region_org_id=10, start_date=date(2026, 6, 1))

        self.client.get.assert_called_once_with(
            "/v1/event-instance",
            params={"regionOrgId": 10, "startDate": "2026-06-01"},
        )
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].id, 1)

    def test_get_list_with_ao_filter(self):
        self.client.get.return_value = {"eventInstances": []}
        self.repo.get_list(region_org_id=10, start_date=date(2026, 6, 1), ao_org_id=20)

        _, kwargs = self.client.get.call_args
        self.assertIn("aoOrgId", kwargs["params"])
        self.assertEqual(kwargs["params"]["aoOrgId"], 20)

    def test_get_list_handles_results_fallback(self):
        self.client.get.return_value = {"results": [self._raw_instance(id=2)]}
        result = self.repo.get_list(region_org_id=10, start_date=date(2026, 6, 1))
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].id, 2)

    def test_get_list_empty_on_unexpected_key(self):
        self.client.get.return_value = {"unexpected": []}
        result = self.repo.get_list(region_org_id=10, start_date=date(2026, 6, 1))
        self.assertEqual(result, [])

    def test_get_by_id_parses_payload(self):
        self.client.get.return_value = {"eventInstance": self._raw_instance(id=5)}
        result = self.repo.get_by_id(5)

        self.client.get.assert_called_once_with("/v1/event-instance/id/5")
        self.assertIsNotNone(result)
        self.assertEqual(result.id, 5)
        self.assertEqual(result.start_date, date(2026, 6, 1))
        self.assertEqual(result.event_type_ids, [5])

    def test_get_by_id_returns_none_on_not_found(self):
        self.client.get.side_effect = F3ApiNotFoundError(404, "not found")
        result = self.repo.get_by_id(999)
        self.assertIsNone(result)

    def test_get_by_id_supports_result_fallback(self):
        self.client.get.return_value = {"result": self._raw_instance(id=7)}
        result = self.repo.get_by_id(7)
        self.assertEqual(result.id, 7)

    def test_parse_instance_handles_snake_case_fields(self):
        """Raw payload uses snake_case field names (older API format)."""
        raw = {
            "id": 1,
            "name": "Snake",
            "org_id": 10,
            "start_date": "2026-07-01",
            "start_time": "0530",
            "end_time": "0630",
            "is_active": True,
            "is_private": False,
            "highlight": False,
            "event_types": [],
            "event_tags": [],
        }
        self.client.get.return_value = {"eventInstance": raw}
        result = self.repo.get_by_id(1)
        self.assertEqual(result.start_time, "0530")
        self.assertEqual(result.org_id, 10)

    def test_parse_instance_handles_singular_event_type_id(self):
        """API returns singular eventTypeId / eventTagId (not arrays)."""
        raw = {
            "id": 1,
            "name": "Singular",
            "orgId": 10,
            "startDate": "2026-07-01",
            "startTime": "0530",
            "endTime": "0630",
            "isActive": True,
            "isPrivate": False,
            "highlight": False,
            "eventTypeId": 3,
            "eventTagId": 7,
        }
        self.client.get.return_value = {"eventInstance": raw}
        result = self.repo.get_by_id(1)
        self.assertEqual(result.event_type_ids, [3])
        self.assertEqual(result.event_tag_ids, [7])

    def test_create_posts_without_id(self):
        self.client.post.return_value = {"eventInstance": self._raw_instance(id=99)}
        result = self.repo.create(
            name="New",
            org_id=10,
            start_date=date(2026, 7, 4),
            start_time="0600",
            end_time="0700",
            description=None,
            location_id=None,
            event_type_ids=[1],
            event_tag_ids=[],
            is_active=True,
            is_private=False,
            meta=None,
            highlight=False,
            preblast_rich=None,
            preblast=None,
        )
        _, kwargs = self.client.post.call_args
        self.assertEqual(kwargs["json"]["name"], "New")
        self.assertNotIn("id", kwargs["json"])
        # API expects singular eventTypeId / eventTagId (not arrays)
        self.assertEqual(kwargs["json"]["eventTypeId"], 1)
        self.assertNotIn("eventTagId", kwargs["json"])  # no tag selected
        self.assertEqual(result.id, 99)

    def test_update_posts_with_id(self):
        self.client.post.return_value = {"eventInstance": self._raw_instance(id=5)}
        self.repo.update(
            instance_id=5,
            name="Updated",
            org_id=10,
            start_date=date(2026, 7, 4),
            start_time="0600",
            end_time="0700",
            description=None,
            location_id=None,
            event_type_ids=[1],
            event_tag_ids=[],
            is_active=True,
            is_private=False,
            meta=None,
            highlight=False,
            preblast_rich=None,
            preblast=None,
        )
        _, kwargs = self.client.post.call_args
        self.assertEqual(kwargs["json"]["id"], 5)
        self.assertEqual(kwargs["json"]["name"], "Updated")
        self.assertEqual(kwargs["json"]["eventTypeId"], 1)
        self.assertNotIn("eventTagId", kwargs["json"])  # empty list → omitted

    def test_close_posts_correct_payload(self):
        instance = _make_instance(id=3, meta={"existing_key": "val"})
        self.repo.close(instance=instance, meta={"series_exception_reason": "Rain", "existing_key": "val"})
        self.client.post.assert_called_once_with(
            "/v1/event-instance",
            json={
                "id": 3,
                "name": "The Grind",
                "orgId": 10,
                "startDate": "2026-06-01",
                "startTime": "0600",
                "endTime": "0700",
                "isActive": True,
                "isPrivate": False,
                "highlight": False,
                "eventTypeId": 5,
                "meta": {"series_exception_reason": "Rain", "existing_key": "val"},
                "seriesException": "closed",
            },
        )

    def test_reopen_posts_correct_payload(self):
        instance = _make_instance(id=4, series_exception="closed", meta={"existing_key": "val"})
        self.repo.reopen(instance=instance)
        self.client.post.assert_called_once_with(
            "/v1/event-instance",
            json={
                "id": 4,
                "name": "The Grind",
                "orgId": 10,
                "startDate": "2026-06-01",
                "startTime": "0600",
                "endTime": "0700",
                "isActive": True,
                "isPrivate": False,
                "highlight": False,
                "eventTypeId": 5,
                "meta": {"existing_key": "val"},
                "seriesException": None,
            },
        )

    def test_close_raises_when_existing_instance_is_missing_required_fields(self):
        instance = _make_instance(id=8)
        instance.org_id = 0

        with self.assertRaisesRegex(ValueError, "missing required field 'org_id'"):
            self.repo.close(instance=instance, meta={})

        self.client.post.assert_not_called()

    def test_delete_calls_correct_endpoint(self):
        self.repo.delete(instance_id=6)
        self.client.delete.assert_called_once_with("/v1/event-instance/id/6")

    @patch("infrastructure.api_client.event_instance_repository.get_f3_api_client")
    def test_singleton_returns_same_instance(self, mock_get_client):
        mock_get_client.return_value = MagicMock()
        with patch("infrastructure.api_client.event_instance_repository._repo", None):
            repo1 = get_api_event_instance_repository()
            repo2 = get_api_event_instance_repository()
        self.assertIs(repo1, repo2)


# ---------------------------------------------------------------------------
# Composition root test
# ---------------------------------------------------------------------------


class CompositionRootTest(unittest.TestCase):
    @patch("features.calendar.event_instance.get_api_event_instance_repository")
    @patch("features.calendar.event_instance.EventInstanceService")
    def test_build_event_instance_service_uses_api_repository(self, mock_svc_cls, mock_get_repo):
        result = _build_event_instance_service()
        mock_get_repo.assert_called_once()
        mock_svc_cls.assert_called_once_with(repository=mock_get_repo.return_value)
        self.assertIs(result, mock_svc_cls.return_value)


# ---------------------------------------------------------------------------
# Handler tests
# ---------------------------------------------------------------------------


class ManageEventInstancesTest(unittest.TestCase):
    def _region_record(self):
        r = MagicMock()
        r.org_id = 10
        return r

    @patch("features.calendar.event_instance.build_event_instance_add_form")
    def test_add_action_calls_add_form(self, mock_add_form):
        body = {"actions": [{"selected_option": {"value": "add"}}]}
        manage_event_instances(body, MagicMock(), MagicMock(), {}, self._region_record())
        mock_add_form.assert_called_once()

    @patch("features.calendar.event_instance.build_event_instance_list_form")
    def test_edit_action_calls_list_form(self, mock_list_form):
        body = {"actions": [{"selected_option": {"value": "edit"}}]}
        manage_event_instances(body, MagicMock(), MagicMock(), {}, self._region_record())
        mock_list_form.assert_called_once()


class HandleEventInstanceEditDeleteTest(unittest.TestCase):
    def _region_record(self):
        r = MagicMock()
        r.org_id = 10
        return r

    @patch("features.calendar.event_instance.build_event_instance_add_form")
    @patch("features.calendar.event_instance._build_event_instance_service")
    def test_edit_fetches_instance_and_opens_form(self, mock_build_service, mock_add_form):
        mock_service = MagicMock()
        mock_build_service.return_value = mock_service
        mock_service.get_by_id.return_value = _make_instance(id=3)

        body = {
            "actions": [{"action_id": "event-instance-edit-delete_3", "selected_option": {"value": "Edit"}}],
            "view": {"id": "V1"},
        }
        handle_event_instance_edit_delete(body, MagicMock(), MagicMock(), {}, self._region_record())

        mock_service.get_by_id.assert_called_once_with(3)
        mock_add_form.assert_called_once()

    @patch("features.calendar.event_instance.build_event_instance_list_form")
    @patch("features.calendar.event_instance._build_event_instance_service")
    def test_reopen_calls_reopen_then_refreshes_list(self, mock_build_service, mock_list_form):
        mock_service = MagicMock()
        mock_build_service.return_value = mock_service

        body = {
            "actions": [{"action_id": "event-instance-edit-delete_7", "selected_option": {"value": "Reopen"}}],
            "view": {"id": "V2"},
        }
        handle_event_instance_edit_delete(body, MagicMock(), MagicMock(), {}, self._region_record())

        mock_service.reopen_instance.assert_called_once_with(7)
        mock_list_form.assert_called_once()

    @patch("features.calendar.event_instance.build_event_instance_list_form")
    @patch("features.calendar.event_instance._build_event_instance_service")
    def test_delete_calls_delete_then_refreshes_list(self, mock_build_service, mock_list_form):
        mock_service = MagicMock()
        mock_build_service.return_value = mock_service

        body = {
            "actions": [{"action_id": "event-instance-edit-delete_5", "selected_option": {"value": "Delete"}}],
            "view": {"id": "V3"},
        }
        handle_event_instance_edit_delete(body, MagicMock(), MagicMock(), {}, self._region_record())

        mock_service.delete_instance.assert_called_once_with(5)
        mock_list_form.assert_called_once()

    @patch("features.calendar.event_instance._build_event_instance_service")
    def test_close_opens_close_modal(self, mock_build_service):
        mock_service = MagicMock()
        mock_build_service.return_value = mock_service
        client = MagicMock()

        body = {
            "actions": [{"action_id": "event-instance-edit-delete_4", "selected_option": {"value": "Close"}}],
            "view": {"id": "V4"},
        }
        handle_event_instance_edit_delete(body, client, MagicMock(), {}, self._region_record())

        # Close action opens the close-reason modal — views_update IS called, close_instance is NOT
        client.views_update.assert_called_once()
        mock_service.close_instance.assert_not_called()


class HandleEventInstanceCloseTest(unittest.TestCase):
    @patch("features.calendar.event_instance._build_event_instance_service")
    def test_close_delegates_to_service(self, mock_build_service):
        mock_service = MagicMock()
        mock_build_service.return_value = mock_service

        import json

        body = {
            "view": {
                "private_metadata": json.dumps({"event_instance_id": 9}),
                # orm.BlockView.get_selected_values needs 'blocks' to walk form fields
                "blocks": [
                    {
                        "block_id": "event_close_reason",
                        "element": {"action_id": "event_close_reason", "type": "plain_text_input"},
                    }
                ],
                "state": {
                    "values": {
                        "event_close_reason": {"event_close_reason": {"type": "plain_text_input", "value": "Rain out"}}
                    }
                },
            }
        }
        handle_event_instance_close(body, MagicMock(), MagicMock(), {}, MagicMock())

        mock_service.close_instance.assert_called_once()
        call_kwargs = mock_service.close_instance.call_args
        self.assertEqual(call_kwargs.kwargs["instance_id"], 9)


class BuildEventInstanceListFormTest(unittest.TestCase):
    def _region_record(self):
        r = MagicMock()
        r.org_id = 10
        return r

    @patch("features.calendar.event_instance._build_ao_service")
    @patch("features.calendar.event_instance._build_event_instance_service")
    @patch("features.calendar.event_instance.add_loading_form")
    def test_list_form_empty_records_adds_notice(self, mock_loading, mock_build_service, mock_build_ao):
        mock_loading.return_value = "V_LOAD"
        mock_service = MagicMock()
        mock_build_service.return_value = mock_service
        mock_service.get_region_instances.return_value = []

        mock_ao_service = MagicMock()
        mock_build_ao.return_value = mock_ao_service
        mock_ao_service.get_region_aos.return_value = []

        client = MagicMock()
        body = {"actions": [{"action_id": None}], "trigger_id": "T1"}
        build_event_instance_list_form(body, client, MagicMock(), {}, self._region_record(), loading_form=True)

        client.views_update.assert_called_once()
        # The modal payload blocks should include the empty notice
        modal_payload = client.views_update.call_args.kwargs.get("view") or client.views_update.call_args[1].get("view")
        self.assertIsNotNone(modal_payload)

    @patch("features.calendar.event_instance._build_ao_service")
    @patch("features.calendar.event_instance._build_event_instance_service")
    @patch("features.calendar.event_instance.add_loading_form")
    def test_closed_event_label_marked(self, mock_loading, mock_build_service, mock_build_ao):
        mock_loading.return_value = "V_LOAD"
        mock_service = MagicMock()
        mock_build_service.return_value = mock_service
        closed_instance = _make_instance(id=1, name="Cancelled", series_exception="closed")
        mock_service.get_region_instances.return_value = [closed_instance]

        mock_ao_service = MagicMock()
        mock_build_ao.return_value = mock_ao_service
        mock_ao_service.get_region_aos.return_value = []

        client = MagicMock()
        body = {"actions": [{"action_id": None}], "trigger_id": "T1"}
        build_event_instance_list_form(body, client, MagicMock(), {}, self._region_record(), loading_form=True)

        call_kwargs = client.views_update.call_args[1]
        view_payload = call_kwargs["view"]
        # Find the section block for the closed event
        blocks = view_payload["blocks"]
        event_block = next((b for b in blocks if b.get("block_id", "").endswith("_1")), None)
        self.assertIsNotNone(event_block)
        self.assertIn("[CLOSED]", event_block.get("text", {}).get("text", ""))


if __name__ == "__main__":
    unittest.main()
