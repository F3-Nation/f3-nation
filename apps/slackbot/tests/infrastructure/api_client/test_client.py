import os
import sys
import unittest
from unittest.mock import MagicMock, patch

import requests

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

from infrastructure.api_client.client import F3ApiClient, get_f3_api_client
from infrastructure.api_client.exceptions import F3ApiAuthError, F3ApiError, F3ApiNotFoundError


class F3ApiClientTest(unittest.TestCase):
    def _make_response(self, status_code: int = 200, ok: bool = True, json_payload=None, text: str = ""):
        response = MagicMock()
        response.status_code = status_code
        response.ok = ok
        response.text = text
        if json_payload is None:
            response.json.side_effect = ValueError("no json")
        else:
            response.json.return_value = json_payload
        return response

    def test_requires_api_key(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "F3_API_KEY"):
                F3ApiClient()

    def test_get_uses_base_url_params_and_timeout(self):
        with patch("infrastructure.api_client.client.requests.Session") as mock_session_cls:
            mock_session = MagicMock()
            mock_session_cls.return_value = mock_session
            mock_session.get.return_value = self._make_response(json_payload={"ok": True})

            with patch.dict(
                os.environ,
                {
                    "F3_API_KEY": "test-key",
                    "F3_API_BASE_URL": "http://api.local",
                    "F3_API_TIMEOUT_SECONDS": "12.5",
                },
                clear=True,
            ):
                client = F3ApiClient()
                result = client.get("/v1/event-tag", params={"pageSize": 1})

        self.assertEqual(result, {"ok": True})
        mock_session.get.assert_called_once_with(
            "http://api.local/v1/event-tag",
            timeout=12.5,
            params={"pageSize": 1},
        )

    def test_invalid_timeout_falls_back_to_default(self):
        with patch("infrastructure.api_client.client.requests.Session") as mock_session_cls:
            mock_session = MagicMock()
            mock_session_cls.return_value = mock_session
            mock_session.get.return_value = self._make_response(json_payload={"ok": True})

            with patch.dict(
                os.environ,
                {
                    "F3_API_KEY": "test-key",
                    "F3_API_TIMEOUT_SECONDS": "not-a-number",
                },
                clear=True,
            ):
                client = F3ApiClient()
                client.get("/v1/event-tag")

        self.assertEqual(client._timeout_seconds, 8.0)
        mock_session.get.assert_called_once_with(
            "https://api.f3nation.com/v1/event-tag",
            timeout=8.0,
            params=None,
        )

    def test_raises_not_found_error(self):
        with patch("infrastructure.api_client.client.requests.Session") as mock_session_cls:
            mock_session = MagicMock()
            mock_session_cls.return_value = mock_session
            mock_session.get.return_value = self._make_response(status_code=404, ok=False, text="missing")

            with patch.dict(os.environ, {"F3_API_KEY": "test-key"}, clear=True):
                client = F3ApiClient()
                with self.assertRaises(F3ApiNotFoundError):
                    client.get("/v1/event-tag/id/1")

    def test_raises_auth_error(self):
        with patch("infrastructure.api_client.client.requests.Session") as mock_session_cls:
            mock_session = MagicMock()
            mock_session_cls.return_value = mock_session
            mock_session.get.return_value = self._make_response(status_code=401, ok=False, text="unauthorized")

            with patch.dict(os.environ, {"F3_API_KEY": "test-key"}, clear=True):
                client = F3ApiClient()
                with self.assertRaises(F3ApiAuthError):
                    client.get("/v1/event-tag/id/1")

    def test_raises_generic_api_error(self):
        with patch("infrastructure.api_client.client.requests.Session") as mock_session_cls:
            mock_session = MagicMock()
            mock_session_cls.return_value = mock_session
            mock_session.get.return_value = self._make_response(status_code=500, ok=False, text="server error")

            with patch.dict(os.environ, {"F3_API_KEY": "test-key"}, clear=True):
                client = F3ApiClient()
                with self.assertRaises(F3ApiError) as context:
                    client.get("/v1/event-tag/id/1")

        self.assertEqual(context.exception.status_code, 500)

    def test_wraps_network_errors(self):
        with patch("infrastructure.api_client.client.requests.Session") as mock_session_cls:
            mock_session = MagicMock()
            mock_session_cls.return_value = mock_session
            mock_session.get.side_effect = requests.RequestException("network down")

            with patch.dict(os.environ, {"F3_API_KEY": "test-key"}, clear=True):
                client = F3ApiClient()
                with self.assertRaises(F3ApiError) as context:
                    client.get("/v1/event-tag")

        self.assertEqual(context.exception.status_code, 0)

    def test_handles_204_and_non_json_success(self):
        with patch("infrastructure.api_client.client.requests.Session") as mock_session_cls:
            mock_session = MagicMock()
            mock_session_cls.return_value = mock_session

            response_204 = self._make_response(status_code=204, ok=True, text="")
            response_text = self._make_response(status_code=200, ok=True, json_payload=None, text="ok")
            mock_session.delete.return_value = response_204
            mock_session.post.return_value = response_text

            with patch.dict(os.environ, {"F3_API_KEY": "test-key"}, clear=True):
                client = F3ApiClient()
                delete_result = client.delete("/v1/event-tag/id/1")
                post_result = client.post("/v1/event-tag", json={"name": "Tag"})

        self.assertIsNone(delete_result)
        self.assertEqual(post_result, "ok")

    def test_get_f3_api_client_returns_singleton(self):
        with patch("infrastructure.api_client.client.F3ApiClient") as mock_client_cls:
            first_client = MagicMock()
            second_client = MagicMock()
            mock_client_cls.side_effect = [first_client, second_client]

            with patch("infrastructure.api_client.client._client", None):
                result_one = get_f3_api_client()
                result_two = get_f3_api_client()

        self.assertIs(result_one, first_client)
        self.assertIs(result_two, first_client)
        mock_client_cls.assert_called_once()


if __name__ == "__main__":
    unittest.main()
