import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

from infrastructure.api_client.event_type_repository import ApiEventTypeRepository, get_api_event_type_repository
from infrastructure.api_client.exceptions import F3ApiNotFoundError


class ApiEventTypeRepositoryTest(unittest.TestCase):
    def setUp(self):
        self.client = MagicMock()
        self.repo = ApiEventTypeRepository(self.client)

    # ------------------------------------------------------------------
    # get_by_org
    # ------------------------------------------------------------------

    def test_get_by_org_filters_to_requested_org(self):
        self.client.get.return_value = {
            "eventTypes": [
                {
                    "id": 1,
                    "name": "Bootcamp",
                    "acronym": "BC",
                    "eventCategory": "first_f",
                    "specificOrgId": 10,
                    "isActive": True,
                },
                {
                    "id": 2,
                    "name": "Ruck",
                    "acronym": "RK",
                    "eventCategory": "first_f",
                    "specificOrgId": 11,
                    "isActive": True,
                },
                {
                    "id": 3,
                    "name": "Global",
                    "acronym": "GL",
                    "eventCategory": "second_f",
                    "specificOrgId": None,
                    "isActive": True,
                },
            ]
        }

        result = self.repo.get_by_org(10)

        self.client.get.assert_called_once_with("/v1/event-type", params={"orgIds": [10], "statuses": ["active"]})
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].id, 1)
        self.assertEqual(result[0].specific_org_id, 10)

    def test_get_by_org_supports_results_fallback_and_snake_case(self):
        self.client.get.return_value = {
            "results": [
                {
                    "id": 99,
                    "name": "Swim",
                    "acronym": "SW",
                    "event_category": "third_f",
                    "specific_org_id": 77,
                    "is_active": True,
                }
            ]
        }

        result = self.repo.get_by_org(77)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].id, 99)
        self.assertEqual(result[0].event_category, "third_f")

    def test_get_by_org_excludes_global_types(self):
        self.client.get.return_value = {
            "eventTypes": [
                {
                    "id": 1,
                    "name": "Global",
                    "acronym": "GL",
                    "eventCategory": "first_f",
                    "specificOrgId": None,
                    "isActive": True,
                },
            ]
        }

        result = self.repo.get_by_org(10)

        self.assertEqual(result, [])

    # ------------------------------------------------------------------
    # get_all_for_org
    # ------------------------------------------------------------------

    def test_get_all_for_org_includes_global_and_org_specific(self):
        self.client.get.return_value = {
            "eventTypes": [
                {
                    "id": 1,
                    "name": "Bootcamp",
                    "acronym": "BC",
                    "eventCategory": "first_f",
                    "specificOrgId": 10,
                    "isActive": True,
                },
                {
                    "id": 2,
                    "name": "Other Org",
                    "acronym": "OO",
                    "eventCategory": "first_f",
                    "specificOrgId": 11,
                    "isActive": True,
                },
                {
                    "id": 3,
                    "name": "Global",
                    "acronym": "GL",
                    "eventCategory": "second_f",
                    "specificOrgId": None,
                    "isActive": True,
                },
            ]
        }

        result = self.repo.get_all_for_org(10)

        self.assertEqual(len(result), 2)
        ids = {r.id for r in result}
        self.assertIn(1, ids)
        self.assertIn(3, ids)
        self.assertNotIn(2, ids)

    # ------------------------------------------------------------------
    # get_by_id
    # ------------------------------------------------------------------

    def test_get_by_id_returns_event_type(self):
        self.client.get.return_value = {
            "eventType": {
                "id": 5,
                "name": "Yoga",
                "acronym": "YG",
                "eventCategory": "third_f",
                "specificOrgId": 10,
                "isActive": True,
            }
        }

        result = self.repo.get_by_id(5)

        self.client.get.assert_called_once_with("/v1/event-type/id/5")
        self.assertIsNotNone(result)
        self.assertEqual(result.id, 5)
        self.assertEqual(result.name, "Yoga")

    def test_get_by_id_returns_none_on_not_found(self):
        self.client.get.side_effect = F3ApiNotFoundError(404, "not found")

        result = self.repo.get_by_id(999)

        self.assertIsNone(result)

    def test_get_by_id_supports_result_fallback_key(self):
        self.client.get.return_value = {
            "result": {
                "id": 7,
                "name": "Run",
                "acronym": "RN",
                "eventCategory": "first_f",
                "specificOrgId": None,
                "isActive": True,
            }
        }

        result = self.repo.get_by_id(7)

        self.assertEqual(result.id, 7)

    # ------------------------------------------------------------------
    # create
    # ------------------------------------------------------------------

    def test_create_posts_correct_payload(self):
        self.repo.create("Bootcamp", "BC", "first_f", 10)

        self.client.post.assert_called_once_with(
            "/v1/event-type",
            json={
                "name": "Bootcamp",
                "acronym": "BC",
                "eventCategory": "first_f",
                "specificOrgId": 10,
                "isActive": True,
            },
        )

    # ------------------------------------------------------------------
    # update
    # ------------------------------------------------------------------

    def test_update_posts_correct_payload(self):
        self.repo.update(42, "Updated Name", "UN", "second_f")

        self.client.post.assert_called_once_with(
            "/v1/event-type",
            json={"id": 42, "name": "Updated Name", "acronym": "UN", "eventCategory": "second_f"},
        )

    # ------------------------------------------------------------------
    # delete
    # ------------------------------------------------------------------

    def test_delete_calls_correct_endpoint(self):
        self.repo.delete(99)

        self.client.delete.assert_called_once_with("/v1/event-type/id/99")

    # ------------------------------------------------------------------
    # Singleton
    # ------------------------------------------------------------------

    def test_get_api_event_type_repository_returns_same_instance(self):
        import infrastructure.api_client.event_type_repository as mod

        original = mod._repo
        try:
            mod._repo = None
            with patch("infrastructure.api_client.event_type_repository.get_f3_api_client", return_value=MagicMock()):
                r1 = get_api_event_type_repository()
                r2 = get_api_event_type_repository()
                self.assertIs(r1, r2)
        finally:
            mod._repo = original


if __name__ == "__main__":
    unittest.main()
