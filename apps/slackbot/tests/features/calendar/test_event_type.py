import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

import unittest
from unittest.mock import MagicMock, patch

from application.event_type import EventTypeData
from application.event_type.service import EventTypeService
from features.calendar.event_type import (
    CALENDAR_ADD_EVENT_TYPE_ACRONYM,
    CALENDAR_ADD_EVENT_TYPE_CATEGORY,
    CALENDAR_ADD_EVENT_TYPE_LIST,
    CALENDAR_ADD_EVENT_TYPE_NEW,
    EVENT_TYPE_EDIT_DELETE,
    EventTypeViews,
    _build_event_type_service,
    handle_event_type_add,
    handle_event_type_edit_delete,
    manage_event_types,
)


def _make_type(
    id: int = 1,
    name: str = "Bootcamp",
    acronym: str = "BC",
    event_category: str = "first_f",
    org_id: int = 1,
) -> EventTypeData:
    return EventTypeData(id=id, name=name, acronym=acronym, event_category=event_category, specific_org_id=org_id)


class EventTypeServiceTest(unittest.TestCase):
    def _mock_repo(self):
        return MagicMock()

    def test_get_org_specific_event_types(self):
        repo = self._mock_repo()
        repo.get_by_org.return_value = [_make_type()]

        service = EventTypeService(repository=repo)
        result = service.get_org_specific_event_types("1")

        repo.get_by_org.assert_called_once_with(1)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].name, "Bootcamp")

    def test_get_all_event_types_for_org(self):
        repo = self._mock_repo()
        repo.get_all_for_org.return_value = [_make_type(), _make_type(id=2, org_id=None)]

        service = EventTypeService(repository=repo)
        result = service.get_all_event_types_for_org("1")

        repo.get_all_for_org.assert_called_once_with(1)
        self.assertEqual(len(result), 2)

    def test_get_event_type_by_id(self):
        repo = self._mock_repo()
        repo.get_by_id.return_value = _make_type(id=7)

        service = EventTypeService(repository=repo)
        result = service.get_event_type_by_id(7)

        repo.get_by_id.assert_called_once_with(7)
        self.assertEqual(result.id, 7)

    def test_create_org_specific_type(self):
        repo = self._mock_repo()
        service = EventTypeService(repository=repo)
        service.create_org_specific_type("Swim", "SW", "third_f", "2")

        repo.create.assert_called_once_with("Swim", "SW", "third_f", 2)

    def test_update_org_specific_type(self):
        repo = self._mock_repo()
        service = EventTypeService(repository=repo)
        service.update_org_specific_type(5, "Updated", "UP", "second_f")

        repo.update.assert_called_once_with(5, "Updated", "UP", "second_f")

    def test_delete_org_specific_type(self):
        repo = self._mock_repo()
        service = EventTypeService(repository=repo)
        service.delete_org_specific_type(3)

        repo.delete.assert_called_once_with(3)


class EventTypeViewsTest(unittest.TestCase):
    def test_build_add_type_modal_includes_note_and_list(self):
        all_types = [_make_type()]

        form = EventTypeViews.build_add_type_modal(all_types)

        # Note block present (5 blocks: note, name, category, acronym, list)
        self.assertEqual(len(form.blocks), 5)
        list_block = form.get_block(CALENDAR_ADD_EVENT_TYPE_LIST)
        self.assertIsNotNone(list_block)
        self.assertIn("Bootcamp", list_block.text.text)

    def test_build_add_type_modal_category_options_populated(self):
        form = EventTypeViews.build_add_type_modal([])

        category_block = form.get_block(CALENDAR_ADD_EVENT_TYPE_CATEGORY)
        self.assertIsNotNone(category_block)
        self.assertEqual(len(category_block.element.options), 3)
        option_values = [o.value for o in category_block.element.options]
        self.assertIn("first_f", option_values)
        self.assertIn("second_f", option_values)
        self.assertIn("third_f", option_values)

    def test_build_edit_type_modal_removes_note_and_relabels(self):
        event_type = _make_type()
        all_types = [_make_type()]

        form = EventTypeViews.build_edit_type_modal(event_type, all_types)

        # Note block removed (4 blocks: name, category, acronym, list)
        self.assertEqual(len(form.blocks), 4)
        name_block = form.get_block(CALENDAR_ADD_EVENT_TYPE_NEW)
        self.assertIsNotNone(name_block)
        self.assertEqual(name_block.label.text, "Edit Event Type")
        self.assertEqual(name_block.element.initial_value, "Bootcamp")

    def test_build_edit_type_modal_sets_initial_category(self):
        event_type = _make_type(event_category="second_f")
        form = EventTypeViews.build_edit_type_modal(event_type, [])

        category_block = form.get_block(CALENDAR_ADD_EVENT_TYPE_CATEGORY)
        self.assertIsNotNone(category_block)
        self.assertEqual(category_block.element.initial_option.value, "second_f")

    def test_build_type_list_modal_one_row_per_type(self):
        org_types = [_make_type(id=1), _make_type(id=2, name="Ruck", acronym="RK")]

        form = EventTypeViews.build_type_list_modal(org_types)

        # 1 context block + 2 section blocks
        self.assertEqual(len(form.blocks), 3)
        self.assertEqual(form.blocks[1].block_id, f"{EVENT_TYPE_EDIT_DELETE}_1")
        self.assertEqual(form.blocks[2].block_id, f"{EVENT_TYPE_EDIT_DELETE}_2")

    def test_build_type_list_modal_empty(self):
        form = EventTypeViews.build_type_list_modal([])

        # Only context block
        self.assertEqual(len(form.blocks), 1)


class EventTypeHandlersTest(unittest.TestCase):
    # ------------------------------------------------------------------
    # manage_event_types
    # ------------------------------------------------------------------

    @patch("features.calendar.event_type.add_loading_form")
    @patch("features.calendar.event_type.EventTypeViews")
    @patch("features.calendar.event_type._build_event_type_service")
    def test_manage_event_types_add(self, mock_build_service, mock_views_cls, mock_loading):
        body = {"actions": [{"selected_option": {"value": "add"}}], "trigger_id": "t1"}
        client = MagicMock()
        region_record = MagicMock()
        region_record.org_id = "org1"

        mock_service = MagicMock()
        mock_build_service.return_value = mock_service
        mock_loading.return_value = "view123"
        mock_service.get_all_event_types_for_org.return_value = []
        mock_modal = MagicMock()
        mock_views_cls.return_value.build_add_type_modal.return_value = mock_modal

        manage_event_types(body, client, MagicMock(), {}, region_record)

        mock_service.get_all_event_types_for_org.assert_called_once_with("org1")
        mock_views_cls.return_value.build_add_type_modal.assert_called_once_with([])
        mock_modal.update_modal.assert_called_once()

    @patch("features.calendar.event_type.EventTypeViews")
    @patch("features.calendar.event_type._build_event_type_service")
    def test_manage_event_types_edit(self, mock_build_service, mock_views_cls):
        body = {"actions": [{"selected_option": {"value": "edit"}}], "trigger_id": "t1"}
        client = MagicMock()
        region_record = MagicMock()
        region_record.org_id = "org1"

        mock_service = MagicMock()
        mock_build_service.return_value = mock_service
        mock_service.get_org_specific_event_types.return_value = [_make_type()]
        mock_modal = MagicMock()
        mock_views_cls.return_value.build_type_list_modal.return_value = mock_modal

        manage_event_types(body, client, MagicMock(), {}, region_record)

        mock_service.get_org_specific_event_types.assert_called_once_with("org1")
        mock_views_cls.return_value.build_type_list_modal.assert_called_once()
        mock_modal.post_modal.assert_called_once()

    # ------------------------------------------------------------------
    # handle_event_type_add — create
    # ------------------------------------------------------------------

    @patch("features.calendar.event_type.EVENT_TYPE_FORM")
    @patch("features.calendar.event_type._build_event_type_service")
    def test_handle_event_type_add_creates_new(self, mock_build_service, mock_form):
        mock_form.get_selected_values.return_value = {
            CALENDAR_ADD_EVENT_TYPE_NEW: "Bootcamp",
            CALENDAR_ADD_EVENT_TYPE_CATEGORY: "first_f",
            CALENDAR_ADD_EVENT_TYPE_ACRONYM: "BC",
        }
        body = {"view": {"private_metadata": "{}"}}
        region_record = MagicMock()
        region_record.org_id = "org1"

        mock_service = MagicMock()
        mock_build_service.return_value = mock_service

        handle_event_type_add(body, MagicMock(), MagicMock(), {}, region_record)

        mock_service.create_org_specific_type.assert_called_once_with("Bootcamp", "BC", "first_f", "org1")
        mock_service.update_org_specific_type.assert_not_called()

    @patch("features.calendar.event_type.EVENT_TYPE_FORM")
    @patch("features.calendar.event_type._build_event_type_service")
    def test_handle_event_type_add_defaults_acronym(self, mock_build_service, mock_form):
        mock_form.get_selected_values.return_value = {
            CALENDAR_ADD_EVENT_TYPE_NEW: "Bootcamp",
            CALENDAR_ADD_EVENT_TYPE_CATEGORY: "first_f",
            CALENDAR_ADD_EVENT_TYPE_ACRONYM: None,
        }
        body = {"view": {"private_metadata": "{}"}}
        region_record = MagicMock()
        region_record.org_id = "org1"

        mock_service = MagicMock()
        mock_build_service.return_value = mock_service

        handle_event_type_add(body, MagicMock(), MagicMock(), {}, region_record)

        mock_service.create_org_specific_type.assert_called_once_with("Bootcamp", "Bo", "first_f", "org1")

    # ------------------------------------------------------------------
    # handle_event_type_add — update
    # ------------------------------------------------------------------

    @patch("features.calendar.event_type.EVENT_TYPE_FORM")
    @patch("features.calendar.event_type._build_event_type_service")
    def test_handle_event_type_add_updates_existing(self, mock_build_service, mock_form):
        mock_form.get_selected_values.return_value = {
            CALENDAR_ADD_EVENT_TYPE_NEW: "Updated",
            CALENDAR_ADD_EVENT_TYPE_CATEGORY: "second_f",
            CALENDAR_ADD_EVENT_TYPE_ACRONYM: "UP",
        }
        body = {"view": {"private_metadata": '{"edit_event_type_id": 42}'}}
        region_record = MagicMock()

        mock_service = MagicMock()
        mock_build_service.return_value = mock_service

        handle_event_type_add(body, MagicMock(), MagicMock(), {}, region_record)

        mock_service.update_org_specific_type.assert_called_once_with(42, "Updated", "UP", "second_f")
        mock_service.create_org_specific_type.assert_not_called()

    # ------------------------------------------------------------------
    # handle_event_type_add — no-op when fields missing
    # ------------------------------------------------------------------

    @patch("features.calendar.event_type.EVENT_TYPE_FORM")
    @patch("features.calendar.event_type._build_event_type_service")
    def test_handle_event_type_add_noop_when_missing_fields(self, mock_build_service, mock_form):
        mock_form.get_selected_values.return_value = {
            CALENDAR_ADD_EVENT_TYPE_NEW: None,
            CALENDAR_ADD_EVENT_TYPE_CATEGORY: None,
            CALENDAR_ADD_EVENT_TYPE_ACRONYM: None,
        }
        body = {"view": {"private_metadata": "{}"}}
        region_record = MagicMock()

        mock_service = MagicMock()
        mock_build_service.return_value = mock_service

        handle_event_type_add(body, MagicMock(), MagicMock(), {}, region_record)

        mock_service.create_org_specific_type.assert_not_called()
        mock_service.update_org_specific_type.assert_not_called()

    # ------------------------------------------------------------------
    # handle_event_type_edit_delete — edit
    # ------------------------------------------------------------------

    @patch("features.calendar.event_type.add_loading_form")
    @patch("features.calendar.event_type.EventTypeViews")
    @patch("features.calendar.event_type._build_event_type_service")
    def test_handle_edit_delete_opens_edit_modal(self, mock_build_service, mock_views_cls, mock_loading):
        body = {
            "actions": [
                {
                    "action_id": f"{EVENT_TYPE_EDIT_DELETE}_1",
                    "selected_option": {"value": "Edit"},
                }
            ]
        }
        client = MagicMock()
        region_record = MagicMock()
        region_record.org_id = "org1"

        mock_service = MagicMock()
        mock_build_service.return_value = mock_service
        event_type = _make_type(id=1)
        mock_service.get_all_event_types_for_org.return_value = [event_type]
        mock_loading.return_value = "view456"
        mock_modal = MagicMock()
        mock_views_cls.return_value.build_edit_type_modal.return_value = mock_modal

        handle_event_type_edit_delete(body, client, MagicMock(), {}, region_record)

        mock_views_cls.return_value.build_edit_type_modal.assert_called_once_with(event_type, [event_type])
        mock_modal.update_modal.assert_called_once()

    @patch("features.calendar.event_type._build_event_type_service")
    def test_handle_edit_delete_deletes_type(self, mock_build_service):
        body = {
            "actions": [
                {
                    "action_id": f"{EVENT_TYPE_EDIT_DELETE}_7",
                    "selected_option": {"value": "Delete"},
                }
            ]
        }
        region_record = MagicMock()

        mock_service = MagicMock()
        mock_build_service.return_value = mock_service

        handle_event_type_edit_delete(body, MagicMock(), MagicMock(), {}, region_record)

        mock_service.delete_org_specific_type.assert_called_once_with(7)

    @patch("features.calendar.event_type._build_event_type_service")
    def test_handle_edit_delete_returns_early_on_missing_id(self, mock_build_service):
        body = {
            "actions": [
                {
                    "action_id": "",
                    "selected_option": {"value": "Delete"},
                }
            ]
        }
        region_record = MagicMock()
        mock_service = MagicMock()
        mock_build_service.return_value = mock_service

        handle_event_type_edit_delete(body, MagicMock(), MagicMock(), {}, region_record)

        mock_service.delete_org_specific_type.assert_not_called()


class BuildEventTypeServiceTest(unittest.TestCase):
    @patch("features.calendar.event_type.get_api_event_type_repository")
    @patch("features.calendar.event_type.EventTypeService")
    def test_uses_api_repository(self, mock_svc_cls, mock_get_repo):
        result = _build_event_type_service()

        mock_get_repo.assert_called_once_with()
        mock_svc_cls.assert_called_once_with(repository=mock_get_repo.return_value)
        self.assertEqual(result, mock_svc_cls.return_value)


if __name__ == "__main__":
    unittest.main()
