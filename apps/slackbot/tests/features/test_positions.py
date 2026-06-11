import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from application.position import PositionData, PositionWithAssignmentsData, UserAssignmentData
from application.position.service import PositionService
from features.positions import (
    PositionViews,
    _build_position_service,
    build_config_slt_form,
    handle_config_slt_post,
    handle_edit_position_post,
    handle_new_position_post,
    handle_position_edit_delete,
)

# ---------------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------------


def _make_position(id=1, name="President", org_id=10, description="Top leader", is_active=True):
    return PositionData(id=id, name=name, description=description, org_id=org_id, is_active=is_active)


def _make_position_with_users(id=1, name="President", users=None):
    return PositionWithAssignmentsData(
        id=id,
        name=name,
        description="Role description",
        org_id=10,
        is_active=True,
        users=users or [],
    )


def _make_region_record(org_id=10, team_id="T123"):
    record = MagicMock()
    record.org_id = org_id
    record.team_id = team_id
    return record


# ---------------------------------------------------------------------------
# PositionService tests
# ---------------------------------------------------------------------------


class PositionServiceTest(unittest.TestCase):
    def _mock_repo(self):
        return MagicMock()

    def test_get_org_positions_coerces_string_org_id(self):
        repo = self._mock_repo()
        repo.get_by_org.return_value = [_make_position()]
        service = PositionService(repository=repo)

        result = service.get_org_positions("10")

        repo.get_by_org.assert_called_once_with(10)
        self.assertEqual(len(result), 1)

    def test_get_positions_with_assignments_passes_both_ids(self):
        repo = self._mock_repo()
        repo.get_assignments.return_value = []
        service = PositionService(repository=repo)

        service.get_positions_with_assignments("5", "10")

        repo.get_assignments.assert_called_once_with(5, 10)

    def test_create_position(self):
        repo = self._mock_repo()
        repo.create.return_value = _make_position(id=99)
        service = PositionService(repository=repo)

        result = service.create_position("VP", "Vice President", "10", "region")

        repo.create.assert_called_once_with("VP", "Vice President", 10, "region")
        self.assertEqual(result.id, 99)

    def test_update_position(self):
        repo = self._mock_repo()
        service = PositionService(repository=repo)

        service.update_position(3, "New Name", "New Desc")

        repo.update.assert_called_once_with(3, "New Name", "New Desc")

    def test_delete_position(self):
        repo = self._mock_repo()
        service = PositionService(repository=repo)

        service.delete_position(5)

        repo.delete.assert_called_once_with(5)

    def test_update_org_assignments_coerces_org_id(self):
        repo = self._mock_repo()
        service = PositionService(repository=repo)
        assignments = [{"positionId": 1, "userIds": [42]}]

        service.update_org_assignments("10", assignments)

        repo.update_all_assignments.assert_called_once_with(10, assignments)


# ---------------------------------------------------------------------------
# PositionViews tests
# ---------------------------------------------------------------------------


class PositionViewsBuildSltModalTest(unittest.TestCase):
    def _make_ao(self, id=20, name="Alpha AO"):
        ao = MagicMock()
        ao.id = id
        ao.name = name
        return ao

    def test_build_slt_modal_includes_level_selector(self):
        form = PositionViews.build_slt_modal(
            position_assignments=[],
            aos=[self._make_ao()],
            org_id=10,
            region_org_id=10,
            user_id_to_slack_id={},
        )
        # first block is the level selector
        self.assertEqual(form.blocks[0].action, "slt-level-select")

    def test_build_slt_modal_maps_user_ids_to_slack_ids(self):
        user = UserAssignmentData(user_id=42, f3_name="Dredd")
        position = _make_position_with_users(id=1, users=[user])
        form = PositionViews.build_slt_modal(
            position_assignments=[position],
            aos=[],
            org_id=10,
            region_org_id=10,
            user_id_to_slack_id={42: "USLACK1"},
        )
        # second block should be the position block with initial_value set
        position_block = form.blocks[1]
        self.assertEqual(position_block.element.initial_value, ["USLACK1"])

    def test_build_slt_modal_skips_unmapped_user_ids(self):
        user = UserAssignmentData(user_id=999, f3_name="Ghost")
        position = _make_position_with_users(id=1, users=[user])
        form = PositionViews.build_slt_modal(
            position_assignments=[position],
            aos=[],
            org_id=10,
            region_org_id=10,
            user_id_to_slack_id={},  # 999 not mapped
        )
        position_block = form.blocks[1]
        # initial_value should not be set when no mapped users
        self.assertFalse(hasattr(position_block.element, "initial_value") and position_block.element.initial_value)

    def test_build_slt_modal_shows_region_initial_when_org_matches(self):
        form = PositionViews.build_slt_modal(
            position_assignments=[],
            aos=[],
            org_id=10,
            region_org_id=10,
            user_id_to_slack_id={},
        )
        level_block = form.blocks[0]
        self.assertEqual(level_block.element.initial_value, "0")

    def test_build_slt_modal_shows_ao_initial_when_org_differs(self):
        form = PositionViews.build_slt_modal(
            position_assignments=[],
            aos=[],
            org_id=20,
            region_org_id=10,
            user_id_to_slack_id={},
        )
        level_block = form.blocks[0]
        self.assertEqual(level_block.element.initial_value, "20")


class PositionViewsBuildListModalTest(unittest.TestCase):
    def test_build_position_list_modal_shows_empty_message(self):
        form = PositionViews.build_position_list_modal([])
        # first block is context, second is the "no positions" message
        self.assertEqual(len(form.blocks), 2)

    def test_build_position_list_modal_shows_positions(self):
        positions = [_make_position(id=1, name="Alpha"), _make_position(id=2, name="Beta")]
        form = PositionViews.build_position_list_modal(positions)
        # context block + 2 position blocks
        self.assertEqual(len(form.blocks), 3)


# ---------------------------------------------------------------------------
# Handler tests
# ---------------------------------------------------------------------------


class BuildConfigSltFormTest(unittest.TestCase):
    @patch("features.positions._build_position_service")
    @patch("features.positions.DbManager")
    @patch("features.positions._user_id_to_slack_id_map", return_value={})
    @patch("features.positions.PositionViews.build_slt_modal")
    def test_build_config_slt_form_posts_modal(
        self, mock_build_modal, mock_uid_map, mock_dbmanager, mock_build_service
    ):
        mock_service = MagicMock()
        mock_build_service.return_value = mock_service
        mock_service.get_positions_with_assignments.return_value = []
        mock_dbmanager.find_records.return_value = []
        mock_build_modal.return_value = MagicMock()

        body = {"trigger_id": "T1"}
        client = MagicMock()
        region_record = _make_region_record()

        build_config_slt_form(body, client, MagicMock(), {}, region_record)

        mock_service.get_positions_with_assignments.assert_called_once_with(region_record.org_id, region_record.org_id)
        mock_build_modal.return_value.post_modal.assert_called_once()

    @patch("features.positions._build_position_service")
    @patch("features.positions.DbManager")
    @patch("features.positions._user_id_to_slack_id_map", return_value={})
    @patch("features.positions.PositionViews.build_slt_modal")
    def test_build_config_slt_form_updates_on_level_change(
        self, mock_build_modal, mock_uid_map, mock_dbmanager, mock_build_service
    ):
        mock_service = MagicMock()
        mock_build_service.return_value = mock_service
        mock_service.get_positions_with_assignments.return_value = []
        mock_dbmanager.find_records.return_value = []
        mock_build_modal.return_value = MagicMock()

        body = {
            "actions": [{"action_id": "slt-level-select", "selected_option": {"value": "20"}}],
            "view": {"id": "V1"},
        }
        region_record = _make_region_record()

        build_config_slt_form(body, MagicMock(), MagicMock(), {}, region_record)

        mock_service.get_positions_with_assignments.assert_called_once_with(20, region_record.org_id)
        mock_build_modal.return_value.update_modal.assert_called_once()


class HandleConfigSltPostTest(unittest.TestCase):
    @patch("features.positions._build_position_service")
    @patch("features.positions.get_user")
    def test_handle_config_slt_post_calls_update_assignments(self, mock_get_user, mock_build_service):
        mock_slack_user = MagicMock()
        mock_slack_user.user_id = 42
        mock_get_user.return_value = mock_slack_user

        mock_service = MagicMock()
        mock_build_service.return_value = mock_service

        body = {"view": {"state": {"values": {"slt-select1_10": {"slt-select1_10": {"selected_users": ["USLACK1"]}}}}}}
        region_record = _make_region_record(org_id=10)

        handle_config_slt_post(body, MagicMock(), MagicMock(), {}, region_record)

        mock_service.update_org_assignments.assert_called_once_with(
            org_id=10,
            assignments=[{"positionId": 1, "userIds": [42]}],
        )

    @patch("features.positions._build_position_service")
    @patch("features.positions.get_user")
    def test_handle_config_slt_post_maps_zero_org_to_region(self, mock_get_user, mock_build_service):
        mock_get_user.return_value = MagicMock(user_id=99)
        mock_service = MagicMock()
        mock_build_service.return_value = mock_service

        # org_id=0 should be replaced with region_record.org_id
        body = {"view": {"state": {"values": {"slt-select2_0": {"slt-select2_0": {"selected_users": ["U1"]}}}}}}
        region_record = _make_region_record(org_id=10)

        handle_config_slt_post(body, MagicMock(), MagicMock(), {}, region_record)

        call_args = mock_service.update_org_assignments.call_args
        self.assertEqual(call_args.kwargs["org_id"], 10)


class HandleNewPositionPostTest(unittest.TestCase):
    @patch("features.positions._build_position_service")
    @patch("features.positions.build_config_slt_form")
    def test_handle_new_position_post_creates_and_refreshes(self, mock_refresh, mock_build_service):
        mock_service = MagicMock()
        mock_build_service.return_value = mock_service

        body = {
            "view": {
                "private_metadata": '{"org_id": 10}',
                "previous_view_id": "V_PREV",
                "state": {"values": {}},
                "blocks": [],
            }
        }
        region_record = _make_region_record(org_id=10)

        with patch("features.positions.forms.CONFIG_NEW_POSITION_FORM") as mock_form:
            mock_form.get_selected_values.return_value = {
                "new_position_name": "Treasurer",
                "new_position_description": "Handles money",
            }
            handle_new_position_post(body, MagicMock(), MagicMock(), {}, region_record)

        mock_service.create_position.assert_called_once()
        mock_refresh.assert_called_once()


class HandlePositionEditDeleteTest(unittest.TestCase):
    @patch("features.positions._build_position_service")
    @patch("features.positions.build_position_list_form")
    def test_delete_calls_service_and_refreshes(self, mock_list_form, mock_build_service):
        mock_service = MagicMock()
        mock_build_service.return_value = mock_service

        body = {
            "actions": [{"action_id": "position-edit-delete_5", "selected_option": {"value": "Delete"}}],
            "view": {"id": "V1"},
        }
        region_record = _make_region_record()

        handle_position_edit_delete(body, MagicMock(), MagicMock(), {}, region_record)

        mock_service.delete_position.assert_called_once_with(5)
        mock_list_form.assert_called_once()

    @patch("features.positions._build_position_service")
    @patch("features.positions.build_edit_position_form")
    def test_edit_fetches_position_and_opens_form(self, mock_edit_form, mock_build_service):
        mock_service = MagicMock()
        mock_service.get_by_id.return_value = _make_position(id=3)
        mock_build_service.return_value = mock_service

        body = {
            "actions": [{"action_id": "position-edit-delete_3", "selected_option": {"value": "Edit"}}],
            "view": {"id": "V1"},
        }
        region_record = _make_region_record()

        handle_position_edit_delete(body, MagicMock(), MagicMock(), {}, region_record)

        mock_service.get_by_id.assert_called_once_with(3)
        mock_edit_form.assert_called_once()


class HandleEditPositionPostTest(unittest.TestCase):
    @patch("features.positions._build_position_service")
    @patch("features.positions.build_config_slt_form")
    def test_handle_edit_position_post_updates_and_refreshes(self, mock_refresh, mock_build_service):
        mock_service = MagicMock()
        mock_build_service.return_value = mock_service

        body = {
            "view": {
                "private_metadata": '{"position_id": 7}',
                "previous_view_id": "V_PREV",
                "state": {"values": {}},
                "blocks": [],
            }
        }
        region_record = _make_region_record()

        with patch("features.positions.forms.CONFIG_NEW_POSITION_FORM") as mock_form:
            mock_form.get_selected_values.return_value = {
                "new_position_name": "Treasurer",
                "new_position_description": "Updated desc",
            }
            handle_edit_position_post(body, MagicMock(), MagicMock(), {}, region_record)

        mock_service.update_position.assert_called_once()
        mock_refresh.assert_called_once()


# ---------------------------------------------------------------------------
# Composition root test
# ---------------------------------------------------------------------------


class BuildPositionServiceTest(unittest.TestCase):
    @patch("features.positions.get_api_position_repository")
    @patch("features.positions.PositionService")
    def test_build_position_service_uses_api_repository(self, mock_svc_cls, mock_get_repo):
        result = _build_position_service()

        mock_get_repo.assert_called_once_with()
        mock_svc_cls.assert_called_once_with(repository=mock_get_repo.return_value)
        self.assertIs(result, mock_svc_cls.return_value)


if __name__ == "__main__":
    unittest.main()
