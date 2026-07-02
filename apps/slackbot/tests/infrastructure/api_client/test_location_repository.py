import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

from infrastructure.api_client.exceptions import F3ApiNotFoundError
from infrastructure.api_client.location_repository import ApiLocationRepository, get_api_location_repository


class ApiLocationRepositoryTest(unittest.TestCase):
    def setUp(self):
        self.client = MagicMock()
        self.repo = ApiLocationRepository(self.client)

    # ------------------------------------------------------------------
    # get_by_org
    # ------------------------------------------------------------------

    def test_get_by_org_returns_locations(self):
        self.client.get.return_value = {
            "locations": [
                {
                    "id": 1,
                    "locationName": "Central Park",
                    "orgId": 10,
                    "isActive": True,
                },
                {
                    "id": 2,
                    "locationName": "City Hall",
                    "orgId": 10,
                    "isActive": True,
                },
            ]
        }

        result = self.repo.get_by_org(10)

        self.client.get.assert_called_once_with("/v1/location", params={"regionIds": [10]})
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].id, 1)
        self.assertEqual(result[0].name, "Central Park")

    def test_get_by_org_supports_results_fallback_and_snake_case(self):
        self.client.get.return_value = {
            "results": [
                {
                    "id": 99,
                    "name": "Riverside Park",  # snake_case fallback
                    "org_id": 77,
                    "is_active": True,
                    "address_street": "123 Main St",
                    "address_city": "Springfield",
                    "address_state": "IL",
                }
            ]
        }

        result = self.repo.get_by_org(77)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].id, 99)
        self.assertEqual(result[0].address_street, "123 Main St")
        self.assertEqual(result[0].address_city, "Springfield")

    def test_get_by_org_returns_empty_list_when_no_expected_keys(self):
        self.client.get.return_value = {"unexpected": []}

        result = self.repo.get_by_org(10)

        self.assertEqual(result, [])

    def test_get_by_org_parses_camel_case_address_fields(self):
        self.client.get.return_value = {
            "locations": [
                {
                    "id": 5,
                    "locationName": "Loc",
                    "addressStreet": "456 Elm St",
                    "addressStreet2": "Suite 1",
                    "addressCity": "Shelbyville",
                    "addressState": "IL",
                    "addressZip": "62700",
                    "addressCountry": "USA",
                    "latitude": 39.7,
                    "longitude": -88.5,
                    "isActive": True,
                }
            ]
        }

        result = self.repo.get_by_org(1)

        loc = result[0]
        self.assertEqual(loc.address_street, "456 Elm St")
        self.assertEqual(loc.address_street2, "Suite 1")
        self.assertEqual(loc.address_city, "Shelbyville")
        self.assertEqual(loc.address_state, "IL")
        self.assertEqual(loc.address_zip, "62700")
        self.assertEqual(loc.address_country, "USA")
        self.assertAlmostEqual(loc.latitude, 39.7)
        self.assertAlmostEqual(loc.longitude, -88.5)

    # ------------------------------------------------------------------
    # get_by_id
    # ------------------------------------------------------------------

    def test_get_by_id_returns_none_for_not_found(self):
        self.client.get.side_effect = F3ApiNotFoundError(404, "not found")

        result = self.repo.get_by_id(123)

        self.assertIsNone(result)

    def test_get_by_id_parses_payload(self):
        self.client.get.return_value = {
            "location": {"id": 12, "locationName": "Riverside", "orgId": 5, "isActive": True}
        }

        result = self.repo.get_by_id(12)

        self.client.get.assert_called_once_with("/v1/location/id/12")
        self.assertIsNotNone(result)
        self.assertEqual(result.id, 12)
        self.assertEqual(result.name, "Riverside")

    def test_get_by_id_supports_result_fallback(self):
        self.client.get.return_value = {"result": {"id": 33, "locationName": "Lake Park", "isActive": True}}

        result = self.repo.get_by_id(33)

        self.assertIsNotNone(result)
        self.assertEqual(result.id, 33)

    def test_get_by_id_returns_none_when_empty_payload(self):
        self.client.get.return_value = {}

        result = self.repo.get_by_id(9)

        self.assertIsNone(result)

    # ------------------------------------------------------------------
    # create
    # ------------------------------------------------------------------

    def test_create_posts_to_api_and_returns_location(self):
        self.client.post.return_value = {"location": {"id": 50, "name": "New Park", "orgId": 10, "isActive": True}}

        result = self.repo.create(
            name="New Park",
            org_id=10,
            description=None,
            latitude=34.05,
            longitude=-118.24,
            address_street=None,
            address_street2=None,
            address_city=None,
            address_state=None,
            address_zip=None,
            address_country=None,
        )

        self.client.post.assert_called_once()
        call_json = self.client.post.call_args[1]["json"]
        self.assertEqual(call_json["name"], "New Park")
        self.assertEqual(call_json["orgId"], 10)
        self.assertTrue(call_json["isActive"])
        self.assertAlmostEqual(call_json["latitude"], 34.05)
        self.assertEqual(result.id, 50)

    def test_create_omits_none_optional_fields(self):
        self.client.post.return_value = {"location": {"id": 51, "locationName": "Slim Park", "isActive": True}}

        self.repo.create(
            name="Slim Park",
            org_id=5,
            description=None,
            latitude=None,
            longitude=None,
            address_street=None,
            address_street2=None,
            address_city=None,
            address_state=None,
            address_zip=None,
            address_country=None,
        )

        call_json = self.client.post.call_args[1]["json"]
        self.assertNotIn("latitude", call_json)
        self.assertNotIn("longitude", call_json)
        self.assertNotIn("description", call_json)

    # ------------------------------------------------------------------
    # update
    # ------------------------------------------------------------------

    def test_update_posts_correct_payload(self):
        self.client.post.return_value = None

        self.repo.update(
            location_id=7,
            name="Updated Park",
            org_id=10,
            description="New desc",
            latitude=35.0,
            longitude=-119.0,
            address_street="789 Oak Ave",
            address_street2=None,
            address_city="Somewhere",
            address_state="CA",
            address_zip="90000",
            address_country="USA",
        )

        call_json = self.client.post.call_args[1]["json"]
        self.assertEqual(call_json["id"], 7)
        self.assertEqual(call_json["name"], "Updated Park")
        self.assertEqual(call_json["orgId"], 10)
        self.assertTrue(call_json["isActive"])
        self.assertEqual(call_json["description"], "New desc")
        self.assertEqual(call_json["addressStreet"], "789 Oak Ave")
        self.assertNotIn("addressStreet2", call_json)

    # ------------------------------------------------------------------
    # delete
    # ------------------------------------------------------------------

    def test_delete_calls_correct_endpoint(self):
        self.client.delete.return_value = None

        self.repo.delete(42)

        self.client.delete.assert_called_once_with("/v1/location/delete/42")

    # ------------------------------------------------------------------
    # Singleton
    # ------------------------------------------------------------------

    def test_singleton_reuses_instance(self):
        import infrastructure.api_client.location_repository as loc_mod

        original = loc_mod._repo
        try:
            loc_mod._repo = None
            with patch("infrastructure.api_client.location_repository.get_f3_api_client") as mock_client:
                mock_client.return_value = MagicMock()
                r1 = get_api_location_repository()
                r2 = get_api_location_repository()
                self.assertIs(r1, r2)
                mock_client.assert_called_once()
        finally:
            loc_mod._repo = original


if __name__ == "__main__":
    unittest.main()
