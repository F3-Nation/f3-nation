"""
API-backed implementation of ``EventTypeRepository``.

Maps responses from the F3 Nation REST API to ``EventTypeData`` objects.
The ``GET /v1/event-type/org/{orgId}`` endpoint returns both nation-wide
(global) and org-specific event types; filtering is applied client-side to
mirror the legacy DbManager behaviour.
"""

from __future__ import annotations

from application.event_type import EventTypeData
from infrastructure.api_client.client import F3ApiClient, get_f3_api_client
from infrastructure.api_client.exceptions import F3ApiNotFoundError


def _parse_event_type(raw: dict) -> EventTypeData:
    return EventTypeData(
        id=raw["id"],
        name=raw["name"],
        acronym=raw.get("acronym"),
        event_category=raw.get("eventCategory", raw.get("event_category")),
        specific_org_id=raw.get("specificOrgId", raw.get("specific_org_id")),
        is_active=raw.get("isActive", raw.get("is_active", True)),
    )


def _specific_org_id(raw: dict) -> int | None:
    return raw.get("specificOrgId", raw.get("specific_org_id"))


class ApiEventTypeRepository:
    """Fetches and mutates event types via the F3 Nation REST API."""

    def __init__(self, client: F3ApiClient) -> None:
        self._client = client

    def _fetch_raw(self, org_id: int) -> list[dict]:
        result = self._client.get("/v1/event-type", params={"orgIds": [org_id], "statuses": ["active"]})
        raw = result.get("eventTypes") or result.get("results") or []
        return [t for t in raw if t.get("isActive", t.get("is_active", True))]

    def get_by_org(self, org_id: int) -> list[EventTypeData]:
        """Return only org-specific event types for *org_id*."""
        raw_list = self._fetch_raw(org_id)
        return [_parse_event_type(t) for t in raw_list if _specific_org_id(t) == org_id]

    def get_all_for_org(self, org_id: int) -> list[EventTypeData]:
        """Return org-specific and global event types visible to *org_id*."""
        raw_list = self._fetch_raw(org_id)
        return [_parse_event_type(t) for t in raw_list if _specific_org_id(t) == org_id or _specific_org_id(t) is None]

    def get_by_id(self, event_type_id: int) -> EventTypeData | None:
        try:
            result = self._client.get(f"/v1/event-type/id/{event_type_id}")
        except F3ApiNotFoundError:
            return None
        raw = result.get("eventType") or result.get("result")
        return _parse_event_type(raw) if raw else None

    def create(self, name: str, acronym: str, event_category: str, org_id: int) -> None:
        self._client.post(
            "/v1/event-type",
            json={
                "name": name,
                "acronym": acronym,
                "eventCategory": event_category,
                "specificOrgId": org_id,
                "isActive": True,
            },
        )

    def update(self, event_type_id: int, name: str, acronym: str, event_category: str) -> None:
        self._client.post(
            "/v1/event-type",
            json={"id": event_type_id, "name": name, "acronym": acronym, "eventCategory": event_category},
        )

    def delete(self, event_type_id: int) -> None:
        self._client.delete(f"/v1/event-type/id/{event_type_id}")


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_repo: ApiEventTypeRepository | None = None


def get_api_event_type_repository() -> ApiEventTypeRepository:
    """Return the shared ``ApiEventTypeRepository`` instance."""
    global _repo
    if _repo is None:
        _repo = ApiEventTypeRepository(get_f3_api_client())
    return _repo
