import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

import unittest
from unittest.mock import MagicMock, patch

from application.event_tag import EventTagData
from application.event_tag.service import EventTagService
from features.calendar.event_tag import (
    CALENDAR_ADD_EVENT_TAG_COLOR,
    CALENDAR_ADD_EVENT_TAG_NEW,
    CALENDAR_EVENT_TAG_COLORS_IN_USE,
    EDIT_DELETE_AO_CALLBACK_ID,
    EVENT_TAG_EDIT_DELETE,
    EventTagViews,
    _build_event_tag_service,
    handle_event_tag_add,
    handle_event_tag_edit_delete,
    manage_event_tags,
)


def _make_tag(id: int = 1, name: str = "Tag1", color: str = "Red", org_id: int = 1) -> EventTagData:
    return EventTagData(id=id, name=name, color=color, specific_org_id=org_id)


class EventTagServiceTest(unittest.TestCase):
    def _mock_repo(self):
        return MagicMock()

    def test_get_org_event_tags(self):
        repo = self._mock_repo()
        repo.get_by_org.return_value = [_make_tag()]

        service = EventTagService(repository=repo)
        result = service.get_org_event_tags("1")

        repo.get_by_org.assert_called_once_with(1)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].name, "Tag1")

    def test_create_org_specific_tag(self):
        repo = self._mock_repo()
        service = EventTagService(repository=repo)
        service.create_org_specific_tag("New Tag", "Green", "1")

        repo.create.assert_called_once_with("New Tag", "Green", 1)

    def test_get_event_tag_by_id(self):
        repo = self._mock_repo()
        repo.get_by_id.return_value = _make_tag(id=7)

        service = EventTagService(repository=repo)
        result = service.get_event_tag_by_id(7)

        repo.get_by_id.assert_called_once_with(7)
        self.assertEqual(result.id, 7)

    def test_update_org_specific_tag(self):
        repo = self._mock_repo()
        service = EventTagService(repository=repo)
        service.update_org_specific_tag(1, "Updated Tag", "Yellow")

        repo.update.assert_called_once_with(1, "Updated Tag", "Yellow")

    def test_delete_org_specific_tag(self):
        repo = self._mock_repo()
        service = EventTagService(repository=repo)
        service.delete_org_specific_tag(1)

        repo.delete.assert_called_once_with(1)


class EventTagViewsTest(unittest.TestCase):
    def test_build_add_tag_modal(self):
        org_tags = [_make_tag()]

        views = EventTagViews()
        form = views.build_add_tag_modal(org_tags)

        self.assertEqual(len(form.blocks), 4)
        colors_block = form.get_block(CALENDAR_EVENT_TAG_COLORS_IN_USE)
        self.assertIsNotNone(colors_block)
        self.assertIn("Colors already in use:", colors_block.text.text)
        self.assertIn("Tag1 - Red", colors_block.text.text)

    def test_build_edit_tag_modal(self):
        tag_to_edit = _make_tag()
        org_tags = [_make_tag()]

        views = EventTagViews()
        form = views.build_edit_tag_modal(tag_to_edit, org_tags)

        self.assertEqual(len(form.blocks), 4)
        name_block = form.get_block(CALENDAR_ADD_EVENT_TAG_NEW)
        self.assertIsNotNone(name_block)
        self.assertEqual(name_block.label.text, "Edit Event Tag")
        self.assertEqual(name_block.element.initial_value, "Tag1")

    def test_build_tag_list_modal(self):
        org_tags = [_make_tag()]

        views = EventTagViews()
        form = views.build_tag_list_modal(org_tags)

        self.assertEqual(len(form.blocks), 2)
        self.assertEqual(form.blocks[0].block_id, f"{EVENT_TAG_EDIT_DELETE}_1")
        self.assertEqual(form.blocks[0].accessory.action_id, f"{EVENT_TAG_EDIT_DELETE}_1")

    def test_build_tag_list_modal_with_notice(self):
        org_tags = [_make_tag()]

        views = EventTagViews()
        form = views.build_tag_list_modal(org_tags, notice_text="Tag missing")

        self.assertEqual(len(form.blocks), 3)
        self.assertEqual(form.blocks[0].text.text, "Tag missing")
        self.assertEqual(form.blocks[1].block_id, f"{EVENT_TAG_EDIT_DELETE}_1")


class EventTagHandlersTest(unittest.TestCase):
    @patch("features.calendar.event_tag.add_loading_form")
    @patch("features.calendar.event_tag.EventTagViews")
    @patch("features.calendar.event_tag._build_event_tag_service")
    def test_manage_event_tags_add(self, mock_build_service, mock_views, mock_add_loading_form):
        body = {"actions": [{"selected_option": {"value": "add"}}], "trigger_id": "trigger123"}
        client = MagicMock()
        logger = MagicMock()
        context = MagicMock()
        region_record = MagicMock()
        region_record.org_id = "org1"

        mock_service = MagicMock()
        mock_build_service.return_value = mock_service
        mock_add_loading_form.return_value = "view123"
        mock_service.get_org_event_tags.return_value = []
        mock_modal = MagicMock()
        mock_views.return_value.build_add_tag_modal.return_value = mock_modal

        manage_event_tags(body, client, logger, context, region_record)

        mock_service.get_org_event_tags.assert_called_once_with("org1")
        mock_views.return_value.build_add_tag_modal.assert_called_once_with([])
        mock_modal.update_modal.assert_called_once()

    @patch("features.calendar.event_tag.EventTagViews")
    @patch("features.calendar.event_tag._build_event_tag_service")
    def test_manage_event_tags_edit(self, mock_build_service, mock_views):
        body = {"actions": [{"selected_option": {"value": "edit"}}], "trigger_id": "trigger123"}
        client = MagicMock()
        logger = MagicMock()
        context = MagicMock()
        region_record = MagicMock()
        region_record.org_id = "org1"

        mock_service = MagicMock()
        mock_build_service.return_value = mock_service
        mock_service.get_org_event_tags.return_value = [_make_tag()]
        mock_modal = MagicMock()
        mock_views.return_value.build_tag_list_modal.return_value = mock_modal

        manage_event_tags(body, client, logger, context, region_record)

        mock_service.get_org_event_tags.assert_called_once_with("org1")
        mock_views.return_value.build_tag_list_modal.assert_called_once_with([_make_tag()])
        mock_modal.post_modal.assert_called_once()

    @patch("features.calendar.event_tag.EVENT_TAG_FORM")
    @patch("features.calendar.event_tag._build_event_tag_service")
    def test_handle_event_tag_add_new(self, mock_build_service, mock_form):
        mock_form.get_selected_values.return_value = {
            CALENDAR_ADD_EVENT_TAG_NEW: "New Tag",
            CALENDAR_ADD_EVENT_TAG_COLOR: "Green",
        }
        body = {"view": {"private_metadata": "{}"}}
        client = MagicMock()
        logger = MagicMock()
        context = MagicMock()
        region_record = MagicMock()
        region_record.org_id = "org1"

        mock_service = MagicMock()
        mock_build_service.return_value = mock_service

        handle_event_tag_add(body, client, logger, context, region_record)

        mock_service.create_org_specific_tag.assert_called_once_with("New Tag", "Green", "org1")

    @patch("features.calendar.event_tag.EVENT_TAG_FORM")
    @patch("features.calendar.event_tag._build_event_tag_service")
    def test_handle_event_tag_add_edit_existing(self, mock_build_service, mock_form):
        mock_form.get_selected_values.return_value = {
            CALENDAR_ADD_EVENT_TAG_NEW: "Updated Name",
            CALENDAR_ADD_EVENT_TAG_COLOR: "Blue",
        }
        body = {"view": {"private_metadata": '{"edit_event_tag_id": 99}'}}
        client = MagicMock()
        logger = MagicMock()
        context = MagicMock()
        region_record = MagicMock()
        region_record.org_id = "org1"

        mock_service = MagicMock()
        mock_build_service.return_value = mock_service

        handle_event_tag_add(body, client, logger, context, region_record)

        mock_service.update_org_specific_tag.assert_called_once_with(99, "Updated Name", "Blue")
        mock_service.create_org_specific_tag.assert_not_called()

    @patch("features.calendar.event_tag.EVENT_TAG_FORM")
    @patch("features.calendar.event_tag._build_event_tag_service")
    def test_handle_event_tag_add_missing_values_noop(self, mock_build_service, mock_form):
        mock_form.get_selected_values.return_value = {
            CALENDAR_ADD_EVENT_TAG_NEW: "",
            CALENDAR_ADD_EVENT_TAG_COLOR: "",
        }
        body = {"view": {"private_metadata": "{}"}}
        client = MagicMock()
        logger = MagicMock()
        context = MagicMock()
        region_record = MagicMock()
        region_record.org_id = "org1"

        mock_service = MagicMock()
        mock_build_service.return_value = mock_service

        handle_event_tag_add(body, client, logger, context, region_record)

        mock_service.update_org_specific_tag.assert_not_called()
        mock_service.create_org_specific_tag.assert_not_called()

    @patch("features.calendar.event_tag.add_loading_form")
    @patch("features.calendar.event_tag.EventTagViews")
    @patch("features.calendar.event_tag._build_event_tag_service")
    def test_handle_event_tag_edit_delete_edit(self, mock_build_service, mock_views, mock_add_loading_form):
        body = {
            "actions": [{"action_id": f"{EVENT_TAG_EDIT_DELETE}_1", "selected_option": {"value": "Edit"}}],
            "trigger_id": "trigger123",
        }
        client = MagicMock()
        logger = MagicMock()
        context = MagicMock()
        region_record = MagicMock()
        region_record.org_id = "org1"

        mock_service = MagicMock()
        mock_build_service.return_value = mock_service
        mock_add_loading_form.return_value = "view123"
        mock_event_tag = _make_tag()
        mock_service.get_org_event_tags.return_value = [mock_event_tag]
        mock_modal = MagicMock()
        mock_views.return_value.build_edit_tag_modal.return_value = mock_modal

        handle_event_tag_edit_delete(body, client, logger, context, region_record)

        mock_service.get_org_event_tags.assert_called_once_with("org1")
        mock_views.return_value.build_edit_tag_modal.assert_called_once_with(mock_event_tag, [mock_event_tag])
        mock_modal.update_modal.assert_called_once()

    @patch("features.calendar.event_tag.add_loading_form")
    @patch("features.calendar.event_tag.EventTagViews")
    @patch("features.calendar.event_tag._build_event_tag_service")
    def test_handle_event_tag_edit_delete_missing_tag_refreshes_list(
        self, mock_build_service, mock_views, mock_add_loading_form
    ):
        body = {
            "actions": [{"action_id": f"{EVENT_TAG_EDIT_DELETE}_1", "selected_option": {"value": "Edit"}}],
            "trigger_id": "trigger123",
        }
        client = MagicMock()
        logger = MagicMock()
        context = MagicMock()
        region_record = MagicMock()
        region_record.org_id = "org1"

        mock_service = MagicMock()
        mock_build_service.return_value = mock_service
        mock_add_loading_form.return_value = "view123"
        mock_service.get_org_event_tags.return_value = [_make_tag(id=2)]
        mock_modal = MagicMock()
        mock_views.return_value.build_tag_list_modal.return_value = mock_modal

        handle_event_tag_edit_delete(body, client, logger, context, region_record)

        mock_views.return_value.build_tag_list_modal.assert_called_once_with(
            [_make_tag(id=2)], notice_text="The selected event tag no longer exists. The list has been refreshed."
        )
        mock_views.return_value.build_edit_tag_modal.assert_not_called()
        mock_modal.update_modal.assert_called_once()
        self.assertEqual(mock_modal.update_modal.call_args.kwargs["callback_id"], EDIT_DELETE_AO_CALLBACK_ID)


class EventTagCompositionTest(unittest.TestCase):
    @patch("features.calendar.event_tag.EventTagService")
    @patch("features.calendar.event_tag.get_api_event_tag_repository")
    def test_build_event_tag_service_uses_api_repository(self, mock_get_repo, mock_service_cls):
        mock_repo = MagicMock()
        mock_get_repo.return_value = mock_repo
        expected_service = MagicMock()
        mock_service_cls.return_value = expected_service

        result = _build_event_tag_service()

        mock_get_repo.assert_called_once_with()
        mock_service_cls.assert_called_once_with(repository=mock_repo)
        self.assertIs(result, expected_service)

    @patch("features.calendar.event_tag.add_loading_form")
    @patch("features.calendar.event_tag.EventTagViews")
    @patch("features.calendar.event_tag._build_event_tag_service")
    def test_handle_event_tag_edit_delete_edit_invalid_id_noop(
        self, mock_build_service, mock_views, mock_add_loading_form
    ):
        body = {
            "actions": [{"action_id": f"{EVENT_TAG_EDIT_DELETE}_bad", "selected_option": {"value": "Edit"}}],
            "trigger_id": "trigger123",
        }
        client = MagicMock()
        logger = MagicMock()
        context = MagicMock()
        region_record = MagicMock()
        region_record.org_id = "org1"

        mock_service = MagicMock()
        mock_build_service.return_value = mock_service
        mock_service.get_org_event_tags.return_value = [_make_tag()]

        handle_event_tag_edit_delete(body, client, logger, context, region_record)

        mock_build_service.assert_not_called()
        mock_views.assert_not_called()
        mock_add_loading_form.assert_not_called()
        mock_service.get_org_event_tags.assert_not_called()

    @patch("features.calendar.event_tag.EventTagViews")
    @patch("features.calendar.event_tag._build_event_tag_service")
    def test_handle_event_tag_edit_delete_delete_invalid_id_noop(self, mock_build_service, mock_views):
        body = {
            "actions": [{"action_id": f"{EVENT_TAG_EDIT_DELETE}_bad", "selected_option": {"value": "Delete"}}],
            "view": {"id": "view123"},
        }
        client = MagicMock()
        logger = MagicMock()
        context = MagicMock()
        region_record = MagicMock()
        region_record.org_id = "org1"

        mock_service = MagicMock()
        mock_build_service.return_value = mock_service

        handle_event_tag_edit_delete(body, client, logger, context, region_record)

        mock_build_service.assert_not_called()
        mock_views.assert_not_called()
        mock_service.get_org_event_tags.assert_not_called()
        mock_service.delete_org_specific_tag.assert_not_called()

    @patch("features.calendar.event_tag.EventTagViews")
    @patch("features.calendar.event_tag._build_event_tag_service")
    def test_handle_event_tag_edit_delete_delete(self, mock_build_service, mock_views):
        body = {
            "actions": [{"action_id": f"{EVENT_TAG_EDIT_DELETE}_1", "selected_option": {"value": "Delete"}}],
            "view": {"id": "view123"},
        }
        client = MagicMock()
        logger = MagicMock()
        context = MagicMock()
        region_record = MagicMock()
        region_record.org_id = "org1"

        mock_service = MagicMock()
        mock_build_service.return_value = mock_service
        mock_service.get_org_event_tags.return_value = [_make_tag(id=1, name="Tag1"), _make_tag(id=2, name="Tag2")]
        mock_modal = MagicMock()
        mock_views.return_value.build_tag_list_modal.return_value = mock_modal

        handle_event_tag_edit_delete(body, client, logger, context, region_record)

        mock_service.delete_org_specific_tag.assert_called_once_with(1)
        mock_views.return_value.build_tag_list_modal.assert_called_once_with(
            [_make_tag(id=2, name="Tag2")],
            notice_text="The Tag1 tag has been deleted.",
        )
        mock_modal.update_modal.assert_called_once()
        self.assertEqual(mock_modal.update_modal.call_args.kwargs["callback_id"], EDIT_DELETE_AO_CALLBACK_ID)


if __name__ == "__main__":
    unittest.main()
