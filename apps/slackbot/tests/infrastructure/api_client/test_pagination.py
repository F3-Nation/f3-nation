import os
import sys
import unittest
from unittest.mock import MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

from infrastructure.api_client.pagination import MAX_PAGE_SIZE, fetch_all_pages


class FetchAllPagesTest(unittest.TestCase):
    def setUp(self):
        self.client = MagicMock()

    def test_single_page_stops_when_total_reached(self):
        self.client.get.return_value = {"items": [{"id": 1}, {"id": 2}], "totalCount": 2}

        result = fetch_all_pages(self.client, "/v1/thing", params={"orgIds": [10]}, items_key="items")

        self.client.get.assert_called_once_with(
            "/v1/thing",
            params={"orgIds": [10], "pageSize": MAX_PAGE_SIZE, "pageIndex": 0},
        )
        self.assertEqual(result, [{"id": 1}, {"id": 2}])

    def test_single_page_stops_when_short_page_and_no_total(self):
        self.client.get.return_value = {"items": [{"id": 1}]}

        result = fetch_all_pages(self.client, "/v1/thing", params={}, items_key="items")

        self.client.get.assert_called_once()
        self.assertEqual(result, [{"id": 1}])

    def test_pages_through_until_total_reached(self):
        page_one = {"items": [{"id": i} for i in range(MAX_PAGE_SIZE)], "totalCount": MAX_PAGE_SIZE + 1}
        page_two = {"items": [{"id": MAX_PAGE_SIZE}], "totalCount": MAX_PAGE_SIZE + 1}
        self.client.get.side_effect = [page_one, page_two]

        result = fetch_all_pages(self.client, "/v1/thing", params={"orgIds": [10]}, items_key="items")

        self.assertEqual(self.client.get.call_count, 2)
        self.client.get.assert_any_call(
            "/v1/thing",
            params={"orgIds": [10], "pageSize": MAX_PAGE_SIZE, "pageIndex": 0},
        )
        self.client.get.assert_any_call(
            "/v1/thing",
            params={"orgIds": [10], "pageSize": MAX_PAGE_SIZE, "pageIndex": 1},
        )
        self.assertEqual(len(result), MAX_PAGE_SIZE + 1)
        self.assertEqual(result[-1], {"id": MAX_PAGE_SIZE})

    def test_uses_custom_total_key(self):
        self.client.get.return_value = {"orgs": [{"id": 1}], "total": 1}

        result = fetch_all_pages(self.client, "/v1/org", params={}, items_key="orgs", total_key="total")

        self.assertEqual(result, [{"id": 1}])
        self.client.get.assert_called_once()

    def test_falls_back_to_results_key(self):
        self.client.get.return_value = {"results": [{"id": 1}]}

        result = fetch_all_pages(self.client, "/v1/thing", params={}, items_key="items")

        self.assertEqual(result, [{"id": 1}])

    def test_returns_empty_list_when_no_expected_keys(self):
        self.client.get.return_value = {"unexpected": []}

        result = fetch_all_pages(self.client, "/v1/thing", params={}, items_key="items")

        self.assertEqual(result, [])


if __name__ == "__main__":
    unittest.main()
