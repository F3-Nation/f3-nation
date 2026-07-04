import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

from infrastructure.api_client.event_tag_repository import ApiEventTagRepository, get_api_event_tag_repository
from infrastructure.api_client.exceptions import F3ApiNotFoundError


class ApiEventTagRepositoryTest(unittest.TestCase):
    def setUp(self):
        self.client = MagicMock()
        self.repo = ApiEventTagRepository(self.client)

    def test_get_by_org_filters_to_requested_org(self):
        self.client.get.return_value = {
            "eventTags": [
                {"id": 1, "name": "Mine", "color": "Red", "specificOrgId": 10, "isActive": True},
                {"id": 2, "name": "Other", "color": "Blue", "specificOrgId": 11, "isActive": True},
                {"id": 3, "name": "Global", "color": "Green", "specificOrgId": None, "isActive": True},
            ]
        }

        result = self.repo.get_by_org(10)

        self.client.get.assert_called_once_with("/v1/event-tag", params={"orgIds": [10], "statuses": ["active"]})
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].id, 1)
        self.assertEqual(result[0].specific_org_id, 10)

    def test_get_by_org_supports_results_fallback_and_snake_case(self):
        self.client.get.return_value = {
            "results": [
                {
                    "id": 99,
                    "name": "Fallback",
                    "color": None,
                    "specific_org_id": 77,
                    "is_active": True,
                    "description": "fallback payload",
                }
            ]
        }

        result = self.repo.get_by_org(77)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].id, 99)
        self.assertEqual(result[0].specific_org_id, 77)
        self.assertTrue(result[0].is_active)

    def test_get_by_org_returns_empty_list_when_payload_has_no_expected_keys(self):
        self.client.get.return_value = {"unexpected": []}

        result = self.repo.get_by_org(77)

        self.assertEqual(result, [])

    def test_get_by_id_returns_none_for_not_found(self):
        self.client.get.side_effect = F3ApiNotFoundError(404, "not found")

        result = self.repo.get_by_id(123)

        self.assertIsNone(result)

    def test_get_by_id_parses_payload(self):
        self.client.get.return_value = {
            "eventTag": {"id": 12, "name": "Tag", "color": "Orange", "specificOrgId": 5, "isActive": True}
        }

        result = self.repo.get_by_id(12)

        self.client.get.assert_called_once_with("/v1/event-tag/id/12")
        self.assertIsNotNone(result)
        self.assertEqual(result.id, 12)
        self.assertEqual(result.name, "Tag")

    def test_get_by_id_supports_result_fallback(self):
        self.client.get.return_value = {
            "result": {"id": 42, "name": "FallbackTag", "color": "Gray", "specific_org_id": 7, "is_active": True}
        }

        result = self.repo.get_by_id(42)

        self.assertIsNotNone(result)
        self.assertEqual(result.id, 42)
        self.assertEqual(result.specific_org_id, 7)

    def test_create_posts_expected_payload(self):
        self.repo.create("New", "Yellow", 3)

        self.client.post.assert_called_once_with(
            "/v1/event-tag",
            json={"name": "New", "color": "Yellow", "specificOrgId": 3, "isActive": True},
        )

    def test_update_posts_expected_payload(self):
        self.repo.update(7, "Renamed", "Purple")

        self.client.post.assert_called_once_with(
            "/v1/event-tag",
            json={"id": 7, "name": "Renamed", "color": "Purple"},
        )

    def test_delete_calls_expected_endpoint(self):
        self.repo.delete(44)

        self.client.delete.assert_called_once_with("/v1/event-tag/id/44")

    @patch("infrastructure.api_client.event_tag_repository.get_f3_api_client")
    def test_get_api_event_tag_repository_returns_singleton(self, mock_get_client):
        mock_get_client.return_value = MagicMock()
        with patch("infrastructure.api_client.event_tag_repository.ApiEventTagRepository") as mock_repo_cls:
            first_repo = MagicMock()
            second_repo = MagicMock()
            mock_repo_cls.side_effect = [first_repo, second_repo]

            with patch("infrastructure.api_client.event_tag_repository._repo", None):
                repo_one = get_api_event_tag_repository()
                repo_two = get_api_event_tag_repository()

        self.assertIs(repo_one, first_repo)
        self.assertIs(repo_two, first_repo)
        mock_repo_cls.assert_called_once()


if __name__ == "__main__":
    unittest.main()
