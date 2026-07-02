import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

from application.location import LocationData
from application.location.service import LocationService
from features.calendar.location import (
    _LOCATION_CITY,
    _LOCATION_COUNTRY,
    _LOCATION_DESCRIPTION,
    _LOCATION_LAT,
    _LOCATION_LON,
    _LOCATION_NAME,
    _LOCATION_STATE,
    _LOCATION_STREET,
    _LOCATION_STREET2,
    _LOCATION_ZIP,
    LOCATION_EDIT_DELETE,
    LocationViews,
    _build_location_service,
    handle_location_add,
    handle_location_edit_delete,
    manage_locations,
)


def _make_location(
    id: int = 1,
    name: str = "Central Park",
    org_id: int = 10,
    latitude: float = 34.05,
    longitude: float = -118.24,
) -> LocationData:
    return LocationData(id=id, name=name, org_id=org_id, latitude=latitude, longitude=longitude)


class LocationServiceTest(unittest.TestCase):
    def _mock_repo(self):
        return MagicMock()

    def test_get_org_locations_coerces_org_id(self):
        repo = self._mock_repo()
        repo.get_by_org.return_value = [_make_location()]

        service = LocationService(repository=repo)
        result = service.get_org_locations("10")

        repo.get_by_org.assert_called_once_with(10)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].name, "Central Park")

    def test_get_org_locations_filters_inactive(self):
        repo = self._mock_repo()
        active = _make_location(id=1, name="Active")
        inactive = LocationData(id=2, name="Inactive", org_id=10, is_active=False)
        repo.get_by_org.return_value = [active, inactive]

        service = LocationService(repository=repo)
        result = service.get_org_locations(10)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].id, 1)

    def test_create_location_coerces_org_id(self):
        repo = self._mock_repo()
        repo.create.return_value = _make_location(id=5)

        service = LocationService(repository=repo)
        result = service.create_location(name="Park", org_id="10")

        repo.create.assert_called_once()
        call_kwargs = repo.create.call_args[1]
        self.assertEqual(call_kwargs["org_id"], 10)
        self.assertEqual(result.id, 5)

    def test_update_location_delegates(self):
        repo = self._mock_repo()
        service = LocationService(repository=repo)
        service.update_location(location_id=7, name="Updated", org_id=10)

        repo.update.assert_called_once()
        call_kwargs = repo.update.call_args[1]
        self.assertEqual(call_kwargs["location_id"], 7)
        self.assertEqual(call_kwargs["name"], "Updated")
        self.assertEqual(call_kwargs["org_id"], 10)

    def test_delete_location_delegates(self):
        repo = self._mock_repo()
        service = LocationService(repository=repo)
        service.delete_location(3)

        repo.delete.assert_called_once_with(3)

    def test_get_location_by_id_delegates(self):
        repo = self._mock_repo()
        repo.get_by_id.return_value = _make_location(id=9)
        service = LocationService(repository=repo)

        result = service.get_location_by_id(9)

        repo.get_by_id.assert_called_once_with(9)
        self.assertEqual(result.id, 9)


class LocationViewsTest(unittest.TestCase):
    def test_build_add_modal_returns_ten_blocks(self):
        form = LocationViews.build_add_modal()
        self.assertEqual(len(form.blocks), 10)

    def test_build_add_modal_is_deep_copy(self):
        form1 = LocationViews.build_add_modal()
        form2 = LocationViews.build_add_modal()
        self.assertIsNot(form1, form2)
        self.assertIsNot(form1.blocks, form2.blocks)

    def test_build_edit_modal_sets_initial_values(self):
        loc = LocationData(
            id=1,
            name="Riverside",
            description="By the river",
            latitude=35.0,
            longitude=-90.0,
            address_street="1 River Rd",
            address_city="Memphis",
            address_state="TN",
            address_zip="38101",
            address_country="USA",
            org_id=5,
        )
        form = LocationViews.build_edit_modal(loc)
        # Check name block has initial value
        name_block = form.get_block(_LOCATION_NAME)
        self.assertIsNotNone(name_block)
        self.assertEqual(name_block.element.initial_value, "Riverside")
        # Check lat block
        lat_block = form.get_block(_LOCATION_LAT)
        self.assertIsNotNone(lat_block)

    def test_build_edit_modal_skips_none_fields(self):
        loc = LocationData(id=2, name="Minimal", org_id=1)
        form = LocationViews.build_edit_modal(loc)
        name_block = form.get_block(_LOCATION_NAME)
        self.assertEqual(name_block.element.initial_value, "Minimal")
        # lat/lon blocks should have no initial_value since lat/lon are None
        lat_block = form.get_block(_LOCATION_LAT)
        self.assertIsNone(getattr(lat_block.element, "initial_value", None))

    def test_build_list_modal_creates_section_per_location(self):
        locations = [_make_location(id=1, name="Park A"), _make_location(id=2, name="Park B")]
        form = LocationViews.build_list_modal(locations)
        self.assertEqual(len(form.blocks), 2)
        self.assertEqual(form.blocks[0].block_id, f"{LOCATION_EDIT_DELETE}_1")
        self.assertEqual(form.blocks[1].block_id, f"{LOCATION_EDIT_DELETE}_2")

    def test_build_list_modal_empty(self):
        form = LocationViews.build_list_modal([])
        self.assertEqual(len(form.blocks), 1)
        self.assertEqual(
            form.blocks[0].text.text, "No locations found. Please add a location to create AOs with a meetup spot."
        )

    def test_build_list_modal_with_notice_prepends_section(self):
        locations = [_make_location(id=1, name="Park A")]
        form = LocationViews.build_list_modal(locations, notice_text="A location was deleted.")
        self.assertEqual(len(form.blocks), 2)
        self.assertEqual(form.blocks[0].text.text, "A location was deleted.")
        self.assertEqual(form.blocks[1].block_id, f"{LOCATION_EDIT_DELETE}_1")


class LocationHandlersTest(unittest.TestCase):
    # ------------------------------------------------------------------
    # manage_locations
    # ------------------------------------------------------------------

    @patch("features.calendar.location.build_location_add_form")
    def test_manage_locations_add(self, mock_build_add):
        body = {"actions": [{"selected_option": {"value": "add"}}]}
        client = MagicMock()
        manage_locations(body, client, MagicMock(), MagicMock(), MagicMock())
        mock_build_add.assert_called_once()

    @patch("features.calendar.location._build_location_list_form")
    def test_manage_locations_edit(self, mock_build_list):
        body = {"actions": [{"selected_option": {"value": "edit"}}]}
        manage_locations(body, MagicMock(), MagicMock(), MagicMock(), MagicMock())
        mock_build_list.assert_called_once()

    # ------------------------------------------------------------------
    # handle_location_add — create
    # ------------------------------------------------------------------

    @patch("features.calendar.location._build_location_service")
    def test_handle_location_add_creates_new_location(self, mock_build_service):
        mock_service = MagicMock()
        mock_service.create_location.return_value = _make_location(id=99)
        mock_build_service.return_value = mock_service

        body = {
            "view": {
                "private_metadata": "{}",
                "state": {
                    "values": {
                        _LOCATION_NAME: {_LOCATION_NAME: {"type": "plain_text_input", "value": "New Park"}},
                        _LOCATION_LAT: {_LOCATION_LAT: {"type": "number_input", "value": "34.05"}},
                        _LOCATION_LON: {_LOCATION_LON: {"type": "number_input", "value": "-118.24"}},
                        _LOCATION_DESCRIPTION: {_LOCATION_DESCRIPTION: {"type": "plain_text_input", "value": None}},
                        _LOCATION_STREET: {_LOCATION_STREET: {"type": "plain_text_input", "value": None}},
                        _LOCATION_STREET2: {_LOCATION_STREET2: {"type": "plain_text_input", "value": None}},
                        _LOCATION_CITY: {_LOCATION_CITY: {"type": "plain_text_input", "value": None}},
                        _LOCATION_STATE: {_LOCATION_STATE: {"type": "plain_text_input", "value": None}},
                        _LOCATION_ZIP: {_LOCATION_ZIP: {"type": "plain_text_input", "value": None}},
                        _LOCATION_COUNTRY: {_LOCATION_COUNTRY: {"type": "plain_text_input", "value": None}},
                    }
                },
            }
        }
        region_record = MagicMock()
        region_record.org_id = 10

        with patch("features.calendar.location.trigger_map_revalidation"):
            handle_location_add(body, MagicMock(), MagicMock(), MagicMock(), region_record)

        mock_service.create_location.assert_called_once()
        call_kwargs = mock_service.create_location.call_args[1]
        self.assertEqual(call_kwargs["name"], "New Park")
        self.assertEqual(call_kwargs["org_id"], 10)

    @patch("features.calendar.location._build_location_service")
    def test_handle_location_add_updates_existing_location(self, mock_build_service):
        mock_service = MagicMock()
        mock_build_service.return_value = mock_service

        body = {
            "view": {
                "private_metadata": '{"location_id": 7}',
                "state": {
                    "values": {
                        _LOCATION_NAME: {_LOCATION_NAME: {"type": "plain_text_input", "value": "Edited Park"}},
                        _LOCATION_LAT: {_LOCATION_LAT: {"type": "number_input", "value": "35.0"}},
                        _LOCATION_LON: {_LOCATION_LON: {"type": "number_input", "value": "-119.0"}},
                        _LOCATION_DESCRIPTION: {_LOCATION_DESCRIPTION: {"type": "plain_text_input", "value": None}},
                        _LOCATION_STREET: {_LOCATION_STREET: {"type": "plain_text_input", "value": None}},
                        _LOCATION_STREET2: {_LOCATION_STREET2: {"type": "plain_text_input", "value": None}},
                        _LOCATION_CITY: {_LOCATION_CITY: {"type": "plain_text_input", "value": None}},
                        _LOCATION_STATE: {_LOCATION_STATE: {"type": "plain_text_input", "value": None}},
                        _LOCATION_ZIP: {_LOCATION_ZIP: {"type": "plain_text_input", "value": None}},
                        _LOCATION_COUNTRY: {_LOCATION_COUNTRY: {"type": "plain_text_input", "value": None}},
                    }
                },
            }
        }
        region_record = MagicMock()

        with patch("features.calendar.location.trigger_map_revalidation"):
            handle_location_add(body, MagicMock(), MagicMock(), MagicMock(), region_record)

        mock_service.update_location.assert_called_once()
        call_kwargs = mock_service.update_location.call_args[1]
        self.assertEqual(call_kwargs["location_id"], 7)
        self.assertEqual(call_kwargs["name"], "Edited Park")
        self.assertEqual(call_kwargs["org_id"], region_record.org_id)

    # ------------------------------------------------------------------
    # handle_location_edit_delete
    # ------------------------------------------------------------------

    @patch("features.calendar.location._build_location_service")
    @patch("features.calendar.location.build_location_add_form")
    def test_handle_location_edit_delete_edit(self, mock_build_add, mock_build_service):
        mock_service = MagicMock()
        mock_service.get_location_by_id.return_value = _make_location(id=5)
        mock_build_service.return_value = mock_service

        body = {
            "actions": [
                {
                    "action_id": f"{LOCATION_EDIT_DELETE}_5",
                    "selected_option": {"value": "Edit"},
                }
            ]
        }
        handle_location_edit_delete(body, MagicMock(), MagicMock(), MagicMock(), MagicMock())

        mock_service.get_location_by_id.assert_called_once_with(5)
        mock_build_add.assert_called_once()

    @patch("features.calendar.location._build_location_service")
    def test_handle_location_edit_delete_delete(self, mock_build_service):
        mock_service = MagicMock()
        mock_service.get_org_locations.return_value = [_make_location(id=5, name="Central Park")]
        mock_build_service.return_value = mock_service

        body = {
            "view": {"id": "V123"},
            "actions": [
                {
                    "action_id": f"{LOCATION_EDIT_DELETE}_5",
                    "selected_option": {"value": "Delete"},
                }
            ],
        }
        region_record = MagicMock()
        mock_form = MagicMock()
        with (
            patch("features.calendar.location.trigger_map_revalidation"),
            patch.object(LocationViews, "build_list_modal", return_value=mock_form) as mock_build_list,
        ):
            handle_location_edit_delete(body, MagicMock(), MagicMock(), MagicMock(), region_record)

        mock_service.delete_location.assert_called_once_with(5)
        mock_form.update_modal.assert_called_once()
        self.assertEqual(mock_form.update_modal.call_args[1]["view_id"], "V123")
        notice = mock_build_list.call_args[1].get("notice_text", "") or ""
        self.assertIn("Central Park", notice)

    @patch("features.calendar.location._build_location_service")
    def test_handle_location_edit_delete_missing_id_returns_early(self, mock_build_service):
        mock_service = MagicMock()
        mock_build_service.return_value = mock_service

        body = {
            "actions": [
                {
                    "action_id": "",
                    "selected_option": {"value": "Edit"},
                }
            ]
        }
        handle_location_edit_delete(body, MagicMock(), MagicMock(), MagicMock(), MagicMock())

        mock_service.get_location_by_id.assert_not_called()

    @patch("features.calendar.location._build_location_service")
    @patch("features.calendar.location.build_location_add_form")
    def test_handle_location_edit_delete_location_not_found_returns_early(self, mock_build_add, mock_build_service):
        mock_service = MagicMock()
        mock_service.get_location_by_id.return_value = None
        mock_build_service.return_value = mock_service

        body = {
            "actions": [
                {
                    "action_id": f"{LOCATION_EDIT_DELETE}_99",
                    "selected_option": {"value": "Edit"},
                }
            ]
        }
        handle_location_edit_delete(body, MagicMock(), MagicMock(), MagicMock(), MagicMock())

        mock_build_add.assert_not_called()

    # ------------------------------------------------------------------
    # Composition root
    # ------------------------------------------------------------------

    @patch("features.calendar.location.get_api_location_repository")
    @patch("features.calendar.location.LocationService")
    def test_build_location_service_uses_api_repository(self, mock_svc_cls, mock_get_repo):
        result = _build_location_service()
        mock_get_repo.assert_called_once_with()
        mock_svc_cls.assert_called_once_with(repository=mock_get_repo.return_value)
        self.assertEqual(result, mock_svc_cls.return_value)


if __name__ == "__main__":
    unittest.main()
