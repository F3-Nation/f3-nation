import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

from application.ao import AoData
from application.ao.service import AoService
from application.location import LocationData
from features.calendar.ao import (
    AoViews,
    _build_ao_service,
    _build_location_service,
    handle_ao_add,
    handle_ao_edit_delete,
    manage_aos,
)
from utilities.slack import actions


def _make_ao(
    id: int = 1,
    name: str = "The Grind",
    parent_id: int = 10,
    description: str = None,
    default_location_id: int = None,
    logo_url: str = None,
    meta: dict = None,
) -> AoData:
    return AoData(
        id=id,
        name=name,
        parent_id=parent_id,
        description=description,
        default_location_id=default_location_id,
        logo_url=logo_url,
        meta=meta or {},
    )


def _make_location(id: int = 1, name: str = "City Park") -> LocationData:
    return LocationData(id=id, name=name)


# ---------------------------------------------------------------------------
# Service tests
# ---------------------------------------------------------------------------


class AoServiceTest(unittest.TestCase):
    def _mock_repo(self):
        return MagicMock()

    def test_get_region_aos(self):
        repo = self._mock_repo()
        repo.get_by_parent_org.return_value = [_make_ao()]
        service = AoService(repository=repo)
        result = service.get_region_aos("10")
        repo.get_by_parent_org.assert_called_once_with(10)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].name, "The Grind")

    def test_get_ao_by_id(self):
        repo = self._mock_repo()
        repo.get_by_id.return_value = _make_ao(id=7)
        service = AoService(repository=repo)
        result = service.get_ao_by_id(7)
        repo.get_by_id.assert_called_once_with(7)
        self.assertEqual(result.id, 7)

    def test_create_ao_coerces_types(self):
        repo = self._mock_repo()
        repo.create.return_value = _make_ao(id=99)
        service = AoService(repository=repo)
        service.create_ao(
            parent_id="10",
            name="New AO",
            description=None,
            slack_channel_id="C123",
            default_location_id="5",
        )
        repo.create.assert_called_once_with(
            parent_id=10,
            name="New AO",
            description=None,
            slack_channel_id="C123",
            default_location_id=5,
        )

    def test_create_ao_with_none_location_stays_none(self):
        repo = self._mock_repo()
        repo.create.return_value = _make_ao()
        service = AoService(repository=repo)
        service.create_ao("10", "AO", None, None, None)
        _, kwargs = repo.create.call_args
        self.assertIsNone(kwargs["default_location_id"])

    def test_update_ao_coerces_types(self):
        repo = self._mock_repo()
        service = AoService(repository=repo)
        service.update_ao(1, "10", "Updated", None, "C999", "3", logo_url="http://x.com/logo.png")
        repo.update.assert_called_once_with(
            ao_id=1,
            parent_id=10,
            name="Updated",
            description=None,
            slack_channel_id="C999",
            default_location_id=3,
            logo_url="http://x.com/logo.png",
        )

    def test_delete_ao(self):
        repo = self._mock_repo()
        service = AoService(repository=repo)
        service.delete_ao(7)
        repo.delete.assert_called_once_with(7)


# ---------------------------------------------------------------------------
# Views tests
# ---------------------------------------------------------------------------


class AoViewsTest(unittest.TestCase):
    def test_build_add_ao_modal_sets_location_options(self):
        locations = [_make_location(id=1, name="City Park"), _make_location(id=2, name="River Trail")]
        form = AoViews.build_add_ao_modal(locations)
        location_block = form.get_block(actions.CALENDAR_ADD_AO_LOCATION)
        self.assertIsNotNone(location_block)
        self.assertEqual(len(location_block.element.options), 2)
        self.assertEqual(location_block.element.options[0].value, "1")
        self.assertEqual(location_block.element.options[1].value, "2")

    def test_build_add_ao_modal_has_five_blocks(self):
        form = AoViews.build_add_ao_modal([])
        self.assertEqual(len(form.blocks), 5)

    def test_build_edit_ao_modal_sets_initial_name(self):
        ao = _make_ao(name="The Ridgeline", meta={"slack_channel_id": "C123"})
        form = AoViews.build_edit_ao_modal(ao, [])
        name_block = form.get_block(actions.CALENDAR_ADD_AO_NAME)
        self.assertIsNotNone(name_block)
        self.assertEqual(name_block.element.initial_value, "The Ridgeline")

    def test_build_edit_ao_modal_sets_channel(self):
        ao = _make_ao(meta={"slack_channel_id": "C456"})
        form = AoViews.build_edit_ao_modal(ao, [])
        channel_block = form.get_block(actions.CALENDAR_ADD_AO_CHANNEL)
        self.assertIsNotNone(channel_block)
        self.assertEqual(channel_block.element.initial_channel, "C456")

    def test_build_edit_ao_modal_sets_location(self):
        ao = _make_ao(default_location_id=3)
        locations = [_make_location(id=3, name="The Park")]
        form = AoViews.build_edit_ao_modal(ao, locations)
        location_block = form.get_block(actions.CALENDAR_ADD_AO_LOCATION)
        self.assertIsNotNone(location_block)
        self.assertIsNotNone(location_block.element.initial_option)

    def test_build_ao_list_modal_has_one_block_per_ao(self):
        aos = [_make_ao(id=1), _make_ao(id=2), _make_ao(id=3)]
        form = AoViews.build_ao_list_modal(aos)
        self.assertEqual(len(form.blocks), 3)
        self.assertEqual(form.blocks[0].block_id, f"{actions.AO_EDIT_DELETE}_1")

    def test_build_ao_list_modal_empty(self):
        form = AoViews.build_ao_list_modal([])
        self.assertEqual(len(form.blocks), 1)
        self.assertEqual(form.blocks[0].block_id, "ao-notice")


# ---------------------------------------------------------------------------
# Handler tests
# ---------------------------------------------------------------------------


class ManageAosTest(unittest.TestCase):
    @patch("features.calendar.ao.add_loading_form")
    @patch("features.calendar.ao.AoViews")
    @patch("features.calendar.ao._build_location_service")
    def test_manage_aos_add(self, mock_loc_svc, mock_views, mock_loading_form):
        body = {"actions": [{"selected_option": {"value": "add"}}], "trigger_id": "t1"}
        client = MagicMock()
        region_record = MagicMock()
        region_record.org_id = 10

        mock_loading_form.return_value = "view_id_123"
        mock_loc_svc.return_value.get_org_locations.return_value = [_make_location()]
        mock_modal = MagicMock()
        mock_views.build_add_ao_modal.return_value = mock_modal

        manage_aos(body, client, MagicMock(), {}, region_record)

        mock_loc_svc.return_value.get_org_locations.assert_called_once_with(10)
        mock_modal.update_modal.assert_called_once()

    @patch("features.calendar.ao.AoViews")
    @patch("features.calendar.ao._build_ao_service")
    def test_manage_aos_edit(self, mock_svc, mock_views):
        body = {"actions": [{"selected_option": {"value": "edit"}}], "trigger_id": "t1"}
        client = MagicMock()
        region_record = MagicMock()
        region_record.org_id = 10

        mock_svc.return_value.get_region_aos.return_value = [_make_ao()]
        mock_modal = MagicMock()
        mock_views.build_ao_list_modal.return_value = mock_modal

        manage_aos(body, client, MagicMock(), {}, region_record)

        mock_svc.return_value.get_region_aos.assert_called_once_with(10)
        mock_modal.post_modal.assert_called_once()


class HandleAoAddTest(unittest.TestCase):
    @patch("features.calendar.ao._build_ao_service")
    @patch("features.calendar.ao.trigger_map_revalidation")
    def test_handle_ao_add_creates_new(self, mock_trigger, mock_svc):
        mock_service = MagicMock()
        mock_svc.return_value = mock_service
        mock_service.create_ao.return_value = _make_ao(id=99)

        body = {
            "view": {
                "state": {
                    "values": {
                        actions.CALENDAR_ADD_AO_NAME: {
                            actions.CALENDAR_ADD_AO_NAME: {"type": "plain_text_input", "value": "New AO"}
                        },
                        actions.CALENDAR_ADD_AO_DESCRIPTION: {
                            actions.CALENDAR_ADD_AO_DESCRIPTION: {"type": "plain_text_input", "value": None}
                        },
                        actions.CALENDAR_ADD_AO_CHANNEL: {
                            actions.CALENDAR_ADD_AO_CHANNEL: {"type": "channels_select", "selected_channel": "C123"}
                        },
                        actions.CALENDAR_ADD_AO_LOCATION: {
                            actions.CALENDAR_ADD_AO_LOCATION: {"type": "static_select", "selected_option": None}
                        },
                        actions.CALENDAR_ADD_AO_LOGO: {
                            actions.CALENDAR_ADD_AO_LOGO: {"type": "file_input", "files": None}
                        },
                    }
                },
                "private_metadata": "{}",
            }
        }
        region_record = MagicMock()
        region_record.org_id = 10

        handle_ao_add(body, MagicMock(), MagicMock(), {}, region_record)

        mock_service.create_ao.assert_called_once()
        mock_service.update_ao.assert_not_called()
        mock_trigger.assert_called_once()

    @patch("features.calendar.ao._build_ao_service")
    @patch("features.calendar.ao.trigger_map_revalidation")
    def test_handle_ao_add_updates_existing(self, mock_trigger, mock_svc):
        mock_service = MagicMock()
        mock_svc.return_value = mock_service

        body = {
            "view": {
                "state": {
                    "values": {
                        actions.CALENDAR_ADD_AO_NAME: {
                            actions.CALENDAR_ADD_AO_NAME: {"type": "plain_text_input", "value": "Updated AO"}
                        },
                        actions.CALENDAR_ADD_AO_DESCRIPTION: {
                            actions.CALENDAR_ADD_AO_DESCRIPTION: {"type": "plain_text_input", "value": None}
                        },
                        actions.CALENDAR_ADD_AO_CHANNEL: {
                            actions.CALENDAR_ADD_AO_CHANNEL: {"type": "channels_select", "selected_channel": None}
                        },
                        actions.CALENDAR_ADD_AO_LOCATION: {
                            actions.CALENDAR_ADD_AO_LOCATION: {"type": "static_select", "selected_option": None}
                        },
                        actions.CALENDAR_ADD_AO_LOGO: {
                            actions.CALENDAR_ADD_AO_LOGO: {"type": "file_input", "files": None}
                        },
                    }
                },
                "private_metadata": '{"ao_id": 7}',
            }
        }
        region_record = MagicMock()
        region_record.org_id = 10

        handle_ao_add(body, MagicMock(), MagicMock(), {}, region_record)

        mock_service.update_ao.assert_called_once()
        mock_service.create_ao.assert_not_called()
        call_kwargs = mock_service.update_ao.call_args[1]
        self.assertEqual(call_kwargs["ao_id"], 7)
        mock_trigger.assert_called_once()


class HandleAoEditDeleteTest(unittest.TestCase):
    @patch("features.calendar.ao.build_ao_add_form")
    @patch("features.calendar.ao._build_ao_service")
    def test_edit_action_calls_build_form(self, mock_svc, mock_build_form):
        mock_service = MagicMock()
        mock_svc.return_value = mock_service
        ao = _make_ao(id=5)
        mock_service.get_ao_by_id.return_value = ao

        body = {"actions": [{"action_id": f"{actions.AO_EDIT_DELETE}_5", "selected_option": {"value": "Edit"}}]}
        region_record = MagicMock()

        handle_ao_edit_delete(body, MagicMock(), MagicMock(), {}, region_record)

        mock_service.get_ao_by_id.assert_called_once_with(5)
        mock_build_form.assert_called_once()

    @patch("features.calendar.ao.trigger_map_revalidation")
    @patch("features.calendar.ao._build_ao_service")
    def test_delete_action_calls_delete(self, mock_svc, mock_trigger):
        mock_service = MagicMock()
        mock_svc.return_value = mock_service

        body = {"actions": [{"action_id": f"{actions.AO_EDIT_DELETE}_5", "selected_option": {"value": "Delete"}}]}
        region_record = MagicMock()

        handle_ao_edit_delete(body, MagicMock(), MagicMock(), {}, region_record)

        mock_service.delete_ao.assert_called_once_with(5)
        mock_trigger.assert_called_once()

    @patch("features.calendar.ao._build_ao_service")
    def test_edit_noop_when_ao_not_found(self, mock_svc):
        mock_service = MagicMock()
        mock_svc.return_value = mock_service
        mock_service.get_ao_by_id.return_value = None

        body = {"actions": [{"action_id": f"{actions.AO_EDIT_DELETE}_99", "selected_option": {"value": "Edit"}}]}
        with patch("features.calendar.ao.build_ao_add_form") as mock_build:
            handle_ao_edit_delete(body, MagicMock(), MagicMock(), {}, MagicMock())
            mock_build.assert_not_called()


class CompositionRootTest(unittest.TestCase):
    @patch("features.calendar.ao.get_api_ao_repository")
    @patch("features.calendar.ao.AoService")
    def test_build_ao_service_uses_api_repository(self, mock_svc_cls, mock_get_repo):
        result = _build_ao_service()  # noqa
        mock_get_repo.assert_called_once_with()
        mock_svc_cls.assert_called_once_with(repository=mock_get_repo.return_value)

    @patch("features.calendar.ao.get_api_location_repository")
    @patch("features.calendar.ao.LocationService")
    def test_build_location_service_uses_api_repository(self, mock_svc_cls, mock_get_repo):
        result = _build_location_service()  # noqa
        mock_get_repo.assert_called_once_with()
        mock_svc_cls.assert_called_once_with(repository=mock_get_repo.return_value)


if __name__ == "__main__":
    unittest.main()
