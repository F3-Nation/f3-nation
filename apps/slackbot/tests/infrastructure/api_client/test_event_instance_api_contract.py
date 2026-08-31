"""Contract test: every key the Slackbot posts must exist in the API's schema.

The unit tests either side of this file each pin one half of the contract — the
Slackbot's outgoing payload here, the handler's accepted input over in
``packages/api``. Neither notices when the *other* half moves, which is exactly
how `eventTypeId` -> `eventTypeIds` shipped: the API dropped the key, zod
stripped it as unknown, and every Slackbot-created instance landed with no event
type. No error, no failing test, just missing rows.

This test closes that gap by checking the payload against the committed OpenAPI
golden (``apps/api/characterization/__snapshots__/openapi.golden.json``), which
is regenerated from the live router whenever the API's input schema changes. A
rename on either side fails here.

What it cannot catch: a field the API *accepts and then ignores* — the schema
still lists it. `eventTagIds` on ``POST /v1/event`` is exactly that today.
"""

import json
import os
import sys
import unittest
from datetime import date
from unittest.mock import MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

from application.event_instance import EventInstanceData
from infrastructure.api_client.event_instance_repository import ApiEventInstanceRepository

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../.."))
_GOLDEN = os.path.join(_REPO_ROOT, "apps/api/characterization/__snapshots__/openapi.golden.json")
_ENDPOINT = "/v1/event-instance"


def _load_request_schema() -> dict | None:
    """The crupdate request schema, or None when the golden isn't reachable.

    Returns None rather than raising so `apps/slackbot` stays runnable on its
    own; the skip below makes the reason visible instead of quietly passing.
    """
    if not os.path.exists(_GOLDEN):
        return None
    with open(_GOLDEN) as handle:
        spec = json.load(handle)
    endpoint = spec.get("paths", {}).get(_ENDPOINT, {}).get("post")
    if not endpoint:
        return None
    return endpoint.get("requestBody", {}).get("content", {}).get("application/json", {}).get("schema")


def _instance(**overrides) -> EventInstanceData:
    fields: dict = {
        "id": 5,
        "name": "The Grind",
        "org_id": 10,
        "location_id": 3,
        "event_type_ids": [1],
        "event_tag_ids": [4],
        "start_date": date(2026, 6, 1),
        "start_time": "0600",
        "end_time": "0700",
        "meta": {"existing": True},
        "preblast": "text",
        "preblast_rich": {"blocks": []},
        "preblast_ts": 1.0,
    }
    fields.update(overrides)
    return EventInstanceData(**fields)


class EventInstanceApiContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schema = _load_request_schema()
        if cls.schema is None:
            raise unittest.SkipTest(f"OpenAPI golden not found at {_GOLDEN} — run the API characterization tests")
        cls.allowed = set(cls.schema.get("properties", {}))
        cls.required = set(cls.schema.get("required", []))

    def setUp(self):
        self.client = MagicMock()
        self.client.post.return_value = {"id": 5}
        self.repo = ApiEventInstanceRepository(self.client)

    def _assert_payload_matches_schema(self, label: str):
        """Every posted key is a documented input, and every required one is sent."""
        self.client.post.assert_called_once()
        _, kwargs = self.client.post.call_args
        payload = kwargs["json"]

        unknown = sorted(set(payload) - self.allowed)
        self.assertEqual(
            unknown,
            [],
            f"{label}: the API's crupdate schema has no {unknown} — "
            f"these keys are silently dropped. Accepted inputs: {sorted(self.allowed)}",
        )

        missing = sorted(self.required - set(payload))
        self.assertEqual(missing, [], f"{label}: required input(s) {missing} were not sent")

    def test_the_event_type_field_is_still_accepted(self):
        """Named on its own so a rename reads as a contract break, not a typo."""
        self.assertIn(
            "eventTypeId",
            self.allowed,
            "The Slackbot posts the singular `eventTypeId` on every create and update "
            "(see _build_crupdate_payload). Dropping it from the API schema silently "
            "leaves every Slackbot-created instance with no event type.",
        )

    def test_create_payload_matches_the_schema(self):
        self.repo.create(
            name="New Event",
            org_id=10,
            start_date=date(2026, 6, 1),
            start_time="0600",
            end_time="0700",
            description="Notes",
            location_id=3,
            event_type_ids=[7],
            event_tag_ids=[4],
            is_active=True,
            is_private=False,
            meta={"a": 1},
            highlight=True,
            preblast_rich={"blocks": []},
            preblast="text",
            preblast_ts=1.0,
        )

        self._assert_payload_matches_schema("create")

    def test_update_payload_matches_the_schema(self):
        self.repo.update(
            instance_id=5,
            name="Renamed",
            org_id=10,
            start_date=date(2026, 6, 1),
            start_time="0700",
            end_time="0800",
            description=None,
            location_id=3,
            event_type_ids=[7],
            event_tag_ids=[],
            is_active=True,
            is_private=False,
            meta=None,
            highlight=False,
            preblast_rich=None,
            preblast=None,
        )

        self._assert_payload_matches_schema("update")

    def test_close_payload_matches_the_schema(self):
        self.repo.close(_instance(), {"series_exception_reason": "weather"})

        self._assert_payload_matches_schema("close")

    def test_reopen_payload_matches_the_schema(self):
        self.repo.reopen(_instance())

        self._assert_payload_matches_schema("reopen")

    def test_preblast_update_payload_matches_the_schema(self):
        self.repo.update_preblast_fields(
            5,
            name="Renamed",
            start_time="0730",
            preblast_channel_id="C123",
            existing_instance=_instance(),
        )

        self._assert_payload_matches_schema("update_preblast_fields")

    def test_persist_posted_preblast_payload_matches_the_schema(self):
        self.repo.persist_posted_preblast(
            5,
            preblast_ts=1.0,
            preblast_post_channel_id="C123",
            existing_instance=_instance(),
        )

        self._assert_payload_matches_schema("persist_posted_preblast")


if __name__ == "__main__":
    unittest.main()
