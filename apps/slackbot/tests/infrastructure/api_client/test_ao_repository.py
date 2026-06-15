import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

from infrastructure.api_client.ao_repository import ApiAoRepository, get_api_ao_repository
from infrastructure.api_client.exceptions import F3ApiNotFoundError


def _raw_ao(
    id: int = 1,
    name: str = "The Grind",
    parent_id: int = 10,
    is_active: bool = True,
    default_location_id: int = None,
    logo_url: str = None,
    meta: dict = None,
) -> dict:
    return {
        "id": id,
        "name": name,
        "parentId": parent_id,
        "orgType": "ao",
        "isActive": is_active,
        "defaultLocationId": default_location_id,
        "logoUrl": logo_url,
        "meta": meta or {},
    }


class ApiAoRepositoryTest(unittest.TestCase):
    def setUp(self):
        self.client = MagicMock()
        self.repo = ApiAoRepository(self.client)

    # ------------------------------------------------------------------
    # get_by_parent_org
    # ------------------------------------------------------------------

    def test_get_by_parent_org_returns_active_aos(self):
        self.client.get.return_value = {"orgs": [_raw_ao(id=1), _raw_ao(id=2)]}
        result = self.repo.get_by_parent_org(10)
        self.client.get.assert_called_once_with(
            "/v1/org",
            params={"orgTypes": ["ao"], "parentOrgIds": [10], "statuses": ["active"]},
        )
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].id, 1)
        self.assertEqual(result[0].name, "The Grind")

    def test_get_by_parent_org_supports_results_fallback(self):
        self.client.get.return_value = {"results": [_raw_ao(id=99)]}
        result = self.repo.get_by_parent_org(10)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].id, 99)

    def test_get_by_parent_org_returns_empty_list_when_no_key(self):
        self.client.get.return_value = {"unexpected": []}
        result = self.repo.get_by_parent_org(10)
        self.assertEqual(result, [])

    def test_get_by_parent_org_parses_snake_case_fields(self):
        self.client.get.return_value = {
            "orgs": [
                {
                    "id": 5,
                    "name": "Snake AO",
                    "parent_id": 10,
                    "org_type": "ao",
                    "is_active": True,
                    "default_location_id": 42,
                    "logo_url": "http://example.com/logo.png",
                    "meta": {"slack_channel_id": "C123"},
                }
            ]
        }
        result = self.repo.get_by_parent_org(10)
        ao = result[0]
        self.assertEqual(ao.parent_id, 10)
        self.assertEqual(ao.default_location_id, 42)
        self.assertEqual(ao.logo_url, "http://example.com/logo.png")
        self.assertEqual(ao.meta, {"slack_channel_id": "C123"})

    # ------------------------------------------------------------------
    # get_by_id
    # ------------------------------------------------------------------

    def test_get_by_id_returns_ao(self):
        self.client.get.return_value = {"org": _raw_ao(id=7)}
        result = self.repo.get_by_id(7)
        self.client.get.assert_called_once_with("/v1/org/id/7")
        self.assertIsNotNone(result)
        self.assertEqual(result.id, 7)

    def test_get_by_id_returns_none_when_not_found(self):
        self.client.get.side_effect = F3ApiNotFoundError(404, "Not found")
        result = self.repo.get_by_id(999)
        self.assertIsNone(result)

    def test_get_by_id_returns_none_when_response_empty(self):
        self.client.get.return_value = {}
        result = self.repo.get_by_id(1)
        self.assertIsNone(result)

    # ------------------------------------------------------------------
    # create
    # ------------------------------------------------------------------

    def test_create_posts_correct_payload(self):
        self.client.post.return_value = {"org": _raw_ao(id=20)}
        result = self.repo.create(
            parent_id=10,
            name="New AO",
            description="A description",
            slack_channel_id="C999",
            default_location_id=5,
        )
        self.client.post.assert_called_once_with(
            "/v1/org",
            json={
                "name": "New AO",
                "orgType": "ao",
                "parentId": 10,
                "isActive": True,
                "meta": {"slack_channel_id": "C999"},
                "description": "A description",
                "defaultLocationId": 5,
                "website": "",
                "twitter": "",
                "facebook": "",
                "instagram": "",
                "phone": "",
            },
        )
        self.assertEqual(result.id, 20)

    def test_create_omits_optional_fields_when_none(self):
        self.client.post.return_value = {"org": _raw_ao(id=21)}
        self.repo.create(
            parent_id=10,
            name="Minimal AO",
            description=None,
            slack_channel_id=None,
            default_location_id=None,
        )
        call_kwargs = self.client.post.call_args[1]["json"]
        self.assertNotIn("description", call_kwargs)
        self.assertNotIn("defaultLocationId", call_kwargs)
        self.assertEqual(call_kwargs["meta"], {})

    # ------------------------------------------------------------------
    # update
    # ------------------------------------------------------------------

    def test_update_posts_correct_payload(self):
        self.repo.update(
            ao_id=7,
            parent_id=10,
            name="Updated AO",
            description="New desc",
            slack_channel_id="C777",
            default_location_id=3,
            logo_url="http://example.com/new_logo.png",
        )
        self.client.post.assert_called_once_with(
            "/v1/org",
            json={
                "id": 7,
                "name": "Updated AO",
                "orgType": "ao",
                "parentId": 10,
                "isActive": True,
                "meta": {"slack_channel_id": "C777"},
                "description": "New desc",
                "defaultLocationId": 3,
                "logoUrl": "http://example.com/new_logo.png",
                "website": "",
                "twitter": "",
                "facebook": "",
                "instagram": "",
                "phone": "",
            },
        )

    def test_update_without_logo_omits_logo_url(self):
        self.repo.update(
            ao_id=7,
            parent_id=10,
            name="Updated AO",
            description=None,
            slack_channel_id=None,
            default_location_id=None,
        )
        call_kwargs = self.client.post.call_args[1]["json"]
        self.assertNotIn("logoUrl", call_kwargs)

    # ------------------------------------------------------------------
    # delete
    # ------------------------------------------------------------------

    def test_delete_calls_correct_endpoint(self):
        self.repo.delete(44)
        self.client.delete.assert_called_once_with("/v1/org/delete/44")

    # ------------------------------------------------------------------
    # singleton
    # ------------------------------------------------------------------

    @patch("infrastructure.api_client.ao_repository.get_f3_api_client")
    def test_get_api_ao_repository_returns_singleton(self, mock_get_client):
        mock_get_client.return_value = MagicMock()
        with patch("infrastructure.api_client.ao_repository.ApiAoRepository") as mock_repo_cls:
            first_repo = MagicMock()
            second_repo = MagicMock()
            mock_repo_cls.side_effect = [first_repo, second_repo]

            with patch("infrastructure.api_client.ao_repository._repo", None):
                repo_one = get_api_ao_repository()
                repo_two = get_api_ao_repository()

        self.assertIs(repo_one, first_repo)
        self.assertIs(repo_two, first_repo)
        mock_repo_cls.assert_called_once()


if __name__ == "__main__":
    unittest.main()
