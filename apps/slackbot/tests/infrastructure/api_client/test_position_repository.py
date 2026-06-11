import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

from infrastructure.api_client.exceptions import F3ApiNotFoundError
from infrastructure.api_client.position_repository import ApiPositionRepository, get_api_position_repository


def _make_position_raw(id=1, name="President", org_id=10, org_type="region", is_active=True):
    return {
        "id": id,
        "name": name,
        "description": "Top leader",
        "orgId": org_id,
        "orgType": org_type,
        "isActive": is_active,
        "created": "2024-01-01",
        "updated": "2024-01-01",
    }


def _make_assignment_raw(id=1, name="President", org_id=10, users=None):
    return {
        "id": id,
        "name": name,
        "description": None,
        "orgId": org_id,
        "orgType": "region",
        "isActive": True,
        "created": "2024-01-01",
        "updated": "2024-01-01",
        "users": users or [],
    }


class ApiPositionRepositoryTest(unittest.TestCase):
    def setUp(self):
        self.client = MagicMock()
        self.repo = ApiPositionRepository(self.client)

    # ------------------------------------------------------------------
    # get_by_org
    # ------------------------------------------------------------------

    def test_get_by_org_returns_active_positions(self):
        self.client.get.return_value = {
            "positions": [
                _make_position_raw(id=1, name="President"),
                _make_position_raw(id=2, name="Old Role", is_active=False),
            ]
        }

        result = self.repo.get_by_org(10)

        self.client.get.assert_called_once_with("/v1/position/org/10", params={"isActive": True})
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].id, 1)
        self.assertEqual(result[0].name, "President")

    def test_get_by_org_falls_back_to_results_key(self):
        self.client.get.return_value = {"results": [_make_position_raw(id=5, name="Fallback")]}

        result = self.repo.get_by_org(10)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].id, 5)

    def test_get_by_org_returns_empty_list_on_unknown_key(self):
        self.client.get.return_value = {"unexpected": []}

        result = self.repo.get_by_org(10)

        self.assertEqual(result, [])

    def test_get_by_org_handles_snake_case_response(self):
        self.client.get.return_value = {
            "positions": [
                {
                    "id": 9,
                    "name": "Snake",
                    "description": None,
                    "org_id": 77,
                    "org_type": "ao",
                    "is_active": True,
                }
            ]
        }

        result = self.repo.get_by_org(77)

        self.assertEqual(result[0].org_id, 77)
        self.assertEqual(result[0].org_type, "ao")

    # ------------------------------------------------------------------
    # get_assignments
    # ------------------------------------------------------------------

    def test_get_assignments_parses_users(self):
        self.client.get.return_value = {
            "positions": [
                _make_assignment_raw(
                    id=1,
                    users=[{"id": 42, "f3Name": "Dredd", "firstName": "Joe", "lastName": "D", "avatarUrl": None}],
                )
            ]
        }

        result = self.repo.get_assignments(org_id=10, region_org_id=10)

        self.client.get.assert_called_once_with("/v1/position/assignments/10", params={"regionOrgId": 10})
        self.assertEqual(len(result), 1)
        self.assertEqual(len(result[0].users), 1)
        self.assertEqual(result[0].users[0].user_id, 42)
        self.assertEqual(result[0].users[0].f3_name, "Dredd")

    def test_get_assignments_handles_empty_users(self):
        self.client.get.return_value = {"positions": [_make_assignment_raw(id=1, users=[])]}

        result = self.repo.get_assignments(10, 10)

        self.assertEqual(result[0].users, [])

    def test_get_assignments_uses_region_org_id_param(self):
        self.client.get.return_value = {"positions": []}

        self.repo.get_assignments(org_id=5, region_org_id=99)

        self.client.get.assert_called_once_with("/v1/position/assignments/5", params={"regionOrgId": 99})

    # ------------------------------------------------------------------
    # get_by_id
    # ------------------------------------------------------------------

    def test_get_by_id_returns_position(self):
        self.client.get.return_value = {"position": _make_position_raw(id=7)}

        result = self.repo.get_by_id(7)

        self.client.get.assert_called_once_with("/v1/position/id/7")
        self.assertIsNotNone(result)
        self.assertEqual(result.id, 7)

    def test_get_by_id_returns_none_on_not_found(self):
        self.client.get.side_effect = F3ApiNotFoundError(404, "not found")

        result = self.repo.get_by_id(999)

        self.assertIsNone(result)

    # ------------------------------------------------------------------
    # create
    # ------------------------------------------------------------------

    def test_create_sends_correct_payload(self):
        self.client.post.return_value = {"position": _make_position_raw(id=10, name="VP")}

        result = self.repo.create(name="VP", description="Vice President", org_id=10, org_type="region")

        self.client.post.assert_called_once_with(
            "/v1/position",
            json={
                "name": "VP",
                "description": "Vice President",
                "orgId": 10,
                "orgType": "region",
                "isActive": True,
            },
        )
        self.assertEqual(result.id, 10)

    # ------------------------------------------------------------------
    # update
    # ------------------------------------------------------------------

    def test_update_sends_correct_payload(self):
        self.client.post.return_value = {"position": _make_position_raw(id=3)}

        self.repo.update(position_id=3, name="Updated", description="New desc")

        self.client.post.assert_called_once_with(
            "/v1/position",
            json={"id": 3, "name": "Updated", "description": "New desc"},
        )

    # ------------------------------------------------------------------
    # delete
    # ------------------------------------------------------------------

    def test_delete_calls_correct_endpoint(self):
        self.client.delete.return_value = {"positionId": 5}

        self.repo.delete(5)

        self.client.delete.assert_called_once_with("/v1/position/id/5")

    # ------------------------------------------------------------------
    # update_all_assignments
    # ------------------------------------------------------------------

    def test_update_all_assignments_sends_put(self):
        self.client.put.return_value = {"success": True, "assignmentCount": 2}

        assignments = [{"positionId": 1, "userIds": [10, 11]}, {"positionId": 2, "userIds": []}]
        self.repo.update_all_assignments(org_id=42, assignments=assignments)

        self.client.put.assert_called_once_with(
            "/v1/position/assignments",
            json={"orgId": 42, "assignments": assignments},
        )

    # ------------------------------------------------------------------
    # Singleton
    # ------------------------------------------------------------------

    def test_get_api_position_repository_returns_singleton(self):
        import infrastructure.api_client.position_repository as mod

        original = mod._repo
        mod._repo = None
        try:
            with patch("infrastructure.api_client.position_repository.get_f3_api_client") as mock_client_fn:
                mock_client_fn.return_value = MagicMock()
                repo1 = get_api_position_repository()
                repo2 = get_api_position_repository()
                self.assertIs(repo1, repo2)
                mock_client_fn.assert_called_once()
        finally:
            mod._repo = original


if __name__ == "__main__":
    unittest.main()
