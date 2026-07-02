import json
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

from application.series import SeriesData
from application.series.service import SeriesService
from features.calendar.series import (
    _build_series_service,
    build_series_list_form,
    handle_series_add,
    handle_series_edit_delete,
    manage_series,
)
from utilities.database.orm import SlackSettings


def _make_series(
    id: int = 1,
    name: str = "Test Series",
    org_id: int = 10,
    region_id: int = 5,
    start_date: str = "2025-01-06",
    end_date: str | None = None,
    day_of_week: str = "monday",
    start_time: str = "0530",
    end_time: str = "0615",
    event_type_ids: list | None = None,
    event_tag_ids: list | None = None,
    meta: dict | None = None,
    is_private: bool = False,
    highlight: bool = False,
) -> SeriesData:
    return SeriesData(
        id=id,
        name=name,
        org_id=org_id,
        region_id=region_id,
        start_date=start_date,
        end_date=end_date,
        day_of_week=day_of_week,
        start_time=start_time,
        end_time=end_time,
        event_type_ids=event_type_ids or [],
        event_tag_ids=event_tag_ids or [],
        meta=meta,
        is_private=is_private,
        highlight=highlight,
    )


def _make_region_record(org_id: int = 5) -> SlackSettings:
    r = MagicMock(spec=SlackSettings)
    r.org_id = org_id
    return r


def _make_series_service(
    region_series: list | None = None,
    by_id: SeriesData | None = None,
    created: SeriesData | None = None,
    updated: SeriesData | None = None,
) -> SeriesService:
    svc = MagicMock(spec=SeriesService)
    svc.get_region_series.return_value = region_series or []
    svc.get_by_id.return_value = by_id
    svc.create_series.return_value = created or _make_series(id=99)
    svc.update_series.return_value = updated or _make_series(id=1)
    return svc


class ManageSeriesTest(unittest.TestCase):
    @patch("features.calendar.series.build_series_add_form")
    def test_dispatches_add(self, mock_add):
        body = {"actions": [{"selected_option": {"value": "add"}}]}
        client = MagicMock()
        manage_series(body, client, MagicMock(), {}, _make_region_record())
        mock_add.assert_called_once()

    @patch("features.calendar.series.build_series_list_form")
    def test_dispatches_edit(self, mock_list):
        body = {"actions": [{"selected_option": {"value": "edit"}}]}
        client = MagicMock()
        manage_series(body, client, MagicMock(), {}, _make_region_record())
        mock_list.assert_called_once()


class BuildSeriesListFormTest(unittest.TestCase):
    def _patch_services(self, series_list=None, ao_list=None):
        series_svc = _make_series_service(region_series=series_list or [])
        ao_svc = MagicMock()
        ao_svc.get_region_aos.return_value = ao_list or []
        return series_svc, ao_svc

    @patch("features.calendar.series._build_ao_service")
    @patch("features.calendar.series._build_series_service")
    def test_no_filter_uses_region_id(self, mock_build_series, mock_build_ao):
        series_svc, ao_svc = self._patch_services(
            series_list=[_make_series(id=1, name="Monday Workout", day_of_week="monday")]
        )
        mock_build_series.return_value = series_svc
        mock_build_ao.return_value = ao_svc

        body = {
            "actions": [{"action_id": "other_action"}],
            "view": {"id": "V123", "private_metadata": "{}"},
        }
        region = _make_region_record(org_id=5)
        client = MagicMock()

        build_series_list_form(body, client, MagicMock(), {}, region, update_view_id="V123")

        series_svc.get_region_series.assert_called_once_with(5)
        client.views_update.assert_called_once()

    @patch("features.calendar.series._build_ao_service")
    @patch("features.calendar.series._build_series_service")
    def test_ao_filter_uses_ao_id(self, mock_build_series, mock_build_ao):
        series_svc = _make_series_service()
        ao_svc = MagicMock()
        ao_svc.get_region_aos.return_value = []
        mock_build_series.return_value = series_svc
        mock_build_ao.return_value = ao_svc

        # Simulate an AO filter action with a selected AO value
        filter_block_id = "calendar_manage_series_ao"
        body = {
            "actions": [{"action_id": filter_block_id}],
            "view": {
                "id": "V456",
                "blocks": [
                    {
                        "block_id": filter_block_id,
                        "element": {
                            "type": "static_select",
                            "selected_option": {"value": "10", "text": {"text": "AO Name"}},
                        },
                    }
                ],
                "state": {
                    "values": {
                        filter_block_id: {
                            filter_block_id: {
                                "type": "static_select",
                                "selected_option": {"value": "10", "text": {"text": "AO Name"}},
                            }
                        }
                    }
                },
                "private_metadata": "{}",
            },
        }
        region = _make_region_record(org_id=5)
        client = MagicMock()

        build_series_list_form(body, client, MagicMock(), {}, region)

        # filter_org should be 10, so get_region_series called with ao_id=10
        series_svc.get_region_series.assert_called_once_with(5, ao_id=10)

    @patch("features.calendar.series._build_ao_service")
    @patch("features.calendar.series._build_series_service")
    def test_label_uses_string_day_of_week(self, mock_build_series, mock_build_ao):
        series = _make_series(id=1, name="Workout", day_of_week="wednesday", start_time="0600")
        series_svc = _make_series_service(region_series=[series])
        ao_svc = MagicMock()
        ao_svc.get_region_aos.return_value = []
        mock_build_series.return_value = series_svc
        mock_build_ao.return_value = ao_svc

        body = {
            "actions": [{"action_id": "other"}],
            "view": {"id": "V789", "private_metadata": "{}"},
        }
        client = MagicMock()

        build_series_list_form(body, client, MagicMock(), {}, _make_region_record(), update_view_id="V789")
        call_kwargs = client.views_update.call_args.kwargs
        blocks = call_kwargs["view"]["blocks"]
        # The section block label should contain "Wednesday" (capitalized string)
        labels = [b.get("text", {}).get("text", "") for b in blocks if b.get("type") == "section"]
        self.assertTrue(any("Wednesday" in label for label in labels))


class HandleSeriesEditDeleteTest(unittest.TestCase):
    @patch("features.calendar.series.build_series_add_form")
    @patch("features.calendar.series._build_series_service")
    def test_edit_fetches_series_and_builds_form(self, mock_build_svc, mock_build_form):
        series = _make_series(id=7)
        svc = _make_series_service(by_id=series)
        mock_build_svc.return_value = svc

        body = {
            "actions": [
                {
                    "action_id": "series-edit-delete_7",
                    "selected_option": {"value": "Edit"},
                }
            ],
            "view": {"id": "V1", "private_metadata": "{}"},
        }
        client = MagicMock()
        handle_series_edit_delete(body, client, MagicMock(), {}, _make_region_record())

        svc.get_by_id.assert_called_once_with(7)
        mock_build_form.assert_called_once()
        # Ensure edit_event is passed
        call_kwargs = mock_build_form.call_args.kwargs
        self.assertEqual(call_kwargs["edit_event"], series)

    @patch("features.calendar.series.build_series_list_form")
    @patch("features.calendar.series.trigger_map_revalidation")
    @patch("features.calendar.series._build_series_service")
    def test_delete_calls_delete_service_and_shows_list(self, mock_build_svc, mock_trigger, mock_list_form):
        svc = _make_series_service()
        mock_build_svc.return_value = svc

        body = {
            "actions": [
                {
                    "action_id": "series-edit-delete_7",
                    "selected_option": {"value": "Delete"},
                }
            ],
            "view": {"id": "V1", "private_metadata": "{}"},
        }
        client = MagicMock()
        handle_series_edit_delete(body, client, MagicMock(), {}, _make_region_record())

        svc.delete_series.assert_called_once_with(7)
        mock_trigger.assert_called_once()
        mock_list_form.assert_called_once()

    @patch("features.calendar.series.build_series_list_form")
    @patch("features.calendar.series.trigger_map_revalidation")
    @patch("features.calendar.series._build_series_service")
    def test_delete_sets_is_series_metadata(self, mock_build_svc, mock_trigger, mock_list_form):
        svc = _make_series_service()
        mock_build_svc.return_value = svc

        body = {
            "actions": [
                {
                    "action_id": "series-edit-delete_7",
                    "selected_option": {"value": "Delete"},
                }
            ],
            "view": {"id": "V1", "private_metadata": "{}"},
        }
        handle_series_edit_delete(body, MagicMock(), MagicMock(), {}, _make_region_record())
        metadata = json.loads(body["view"]["private_metadata"])
        self.assertEqual(metadata.get("is_series"), "True")


class HandleSeriesAddUpdateTest(unittest.TestCase):
    """Tests for the update (edit) path of handle_series_add."""

    def _make_body(
        self,
        series_id: int = 1,
        series_name: str = "Test Series",
        ao_id: str = "10",
        event_type_id: str = "42",
        start_time: str = "05:30",
        end_time: str = "06:15",
        description: str = "",
        selected_options: list | None = None,
    ) -> dict:
        ao_block_id = "calendar_add_series_ao"
        location_block_id = "calendar_add_series_location"
        event_type_block_id = "calendar_add_series_type"
        start_time_block_id = "calendar_add_series_start_time"
        end_time_block_id = "calendar_add_series_end_time"
        name_block_id = "calendar_add_series_name"
        description_block_id = "calendar_add_series_description"
        options_block_id = "calendar_add_series_options"

        values = {
            ao_block_id: {
                ao_block_id: {"type": "static_select", "selected_option": {"value": ao_id, "text": {"text": "AO"}}}
            },
            location_block_id: {
                location_block_id: {
                    "type": "static_select",
                    "selected_option": {"value": "20", "text": {"text": "Park"}},
                }
            },
            event_type_block_id: {
                event_type_block_id: {
                    "type": "static_select",
                    "selected_option": {"value": event_type_id, "text": {"text": "Bootcamp"}},
                }
            },
            start_time_block_id: {start_time_block_id: {"type": "timepicker", "selected_time": start_time}},
            end_time_block_id: {end_time_block_id: {"type": "timepicker", "selected_time": end_time}},
            name_block_id: {name_block_id: {"type": "plain_text_input", "value": series_name}},
            description_block_id: {description_block_id: {"type": "plain_text_input", "value": description}},
            options_block_id: {
                options_block_id: {
                    "type": "checkboxes",
                    "selected_options": [{"value": o, "text": {"text": o}} for o in (selected_options or [])],
                }
            },
        }

        blocks = [
            {"block_id": ao_block_id, "element": {"type": "static_select", "initial_option": None}},
            {"block_id": location_block_id, "element": {"type": "static_select", "initial_option": {"value": "20"}}},
            {
                "block_id": event_type_block_id,
                "element": {"type": "static_select", "initial_option": {"value": event_type_id}},
            },
            {"block_id": start_time_block_id, "element": {"type": "timepicker"}},
            {"block_id": end_time_block_id, "element": {"type": "timepicker"}},
            {"block_id": name_block_id, "element": {"type": "plain_text_input"}},
            {"block_id": description_block_id, "element": {"type": "plain_text_input"}},
            {"block_id": options_block_id, "element": {"type": "checkboxes"}},
        ]

        return {
            "view": {
                "id": "V1",
                "previous_view_id": "V0",
                "private_metadata": json.dumps({"series_id": str(series_id)}),
                "blocks": blocks,
                "state": {"values": values},
            },
            "actions": [{"action_id": "add_series_callback_id"}],
        }

    @patch("features.calendar.series.build_series_list_form")
    @patch("features.calendar.series.trigger_map_revalidation")
    @patch("features.calendar.series._build_event_type_service")
    @patch("features.calendar.series._build_ao_service")
    @patch("features.calendar.series._build_series_service")
    def test_update_preserves_start_date_from_existing(
        self, mock_build_series, mock_build_ao, mock_build_et, mock_trigger, mock_list
    ):
        existing = _make_series(id=1, start_date="2025-01-06", end_date="2026-01-01")
        svc = _make_series_service(by_id=existing)
        mock_build_series.return_value = svc
        mock_build_ao.return_value = MagicMock()
        mock_build_et.return_value = MagicMock()

        body = self._make_body(series_id=1)
        client = MagicMock()

        handle_series_add(body, client, MagicMock(), {}, _make_region_record())

        svc.update_series.assert_called_once()
        call_kwargs = svc.update_series.call_args.kwargs
        self.assertEqual(call_kwargs["start_date"], "2025-01-06")
        self.assertEqual(call_kwargs["end_date"], "2026-01-01")

    @patch("features.calendar.series.build_series_list_form")
    @patch("features.calendar.series.trigger_map_revalidation")
    @patch("features.calendar.series._build_event_type_service")
    @patch("features.calendar.series._build_ao_service")
    @patch("features.calendar.series._build_series_service")
    def test_update_merges_meta_flags(self, mock_build_series, mock_build_ao, mock_build_et, mock_trigger, mock_list):
        existing = _make_series(id=1, meta={"existing_key": True})
        svc = _make_series_service(by_id=existing)
        mock_build_series.return_value = svc
        mock_build_ao.return_value = MagicMock()
        mock_build_et.return_value = MagicMock()

        body = self._make_body(series_id=1, selected_options=["no_auto_preblasts"])
        handle_series_add(body, MagicMock(), MagicMock(), {}, _make_region_record())

        call_kwargs = svc.update_series.call_args.kwargs
        self.assertEqual(call_kwargs["meta"].get("do_not_send_auto_preblasts"), True)
        self.assertEqual(call_kwargs["meta"].get("existing_key"), True)

    @patch("features.calendar.series.build_series_list_form")
    @patch("features.calendar.series.trigger_map_revalidation")
    @patch("features.calendar.series._build_event_type_service")
    @patch("features.calendar.series._build_ao_service")
    @patch("features.calendar.series._build_series_service")
    def test_update_no_meta_flags_passes_none(
        self, mock_build_series, mock_build_ao, mock_build_et, mock_trigger, mock_list
    ):
        existing = _make_series(id=1, meta=None)
        svc = _make_series_service(by_id=existing)
        mock_build_series.return_value = svc
        mock_build_ao.return_value = MagicMock()
        mock_build_et.return_value = MagicMock()

        body = self._make_body(series_id=1)
        handle_series_add(body, MagicMock(), MagicMock(), {}, _make_region_record())

        call_kwargs = svc.update_series.call_args.kwargs
        self.assertIsNone(call_kwargs["meta"])


class BuildSeriesServiceTest(unittest.TestCase):
    @patch("features.calendar.series.get_api_series_repository")
    def test_returns_series_service(self, mock_get_repo):
        mock_get_repo.return_value = MagicMock()
        svc = _build_series_service()
        self.assertIsInstance(svc, SeriesService)


if __name__ == "__main__":
    unittest.main()
