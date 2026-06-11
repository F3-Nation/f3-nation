"""
API-backed implementation of ``AoRepository``.

Maps responses from the F3 Nation REST API to ``AoData`` objects.
Uses ``GET /v1/org`` filtered to ``orgTypes=ao`` and ``parentOrgIds``
to list AOs for a given region, and ``POST /v1/org`` (crupdate) for
create/update operations.
"""

from __future__ import annotations

from application.ao import AoData
from infrastructure.api_client.client import F3ApiClient, get_f3_api_client
from infrastructure.api_client.exceptions import F3ApiNotFoundError


def _parse_ao(raw: dict) -> AoData:
    return AoData(
        id=raw["id"],
        name=raw["name"],
        parent_id=raw.get("parentId", raw.get("parent_id")),
        org_type=raw.get("orgType", raw.get("org_type", "ao")),
        description=raw.get("description"),
        is_active=raw.get("isActive", raw.get("is_active", True)),
        default_location_id=raw.get("defaultLocationId", raw.get("default_location_id")),
        logo_url=raw.get("logoUrl", raw.get("logo_url")),
        meta=raw.get("meta"),
    )


class ApiAoRepository:
    """Fetches and mutates AOs via the F3 Nation REST API."""

    def __init__(self, client: F3ApiClient) -> None:
        self._client = client

    def get_by_parent_org(self, parent_org_id: int) -> list[AoData]:
        """Return active AOs whose parent org is *parent_org_id*."""
        result = self._client.get(
            "/v1/org",
            params={"orgTypes": ["ao"], "parentOrgIds": [parent_org_id], "statuses": ["active"]},
        )
        orgs_raw: list[dict] = result.get("orgs") or result.get("results") or []
        return [_parse_ao(o) for o in orgs_raw]

    def get_by_id(self, ao_id: int) -> AoData | None:
        """Return a single AO by primary key, or None if not found."""
        try:
            result = self._client.get(f"/v1/org/id/{ao_id}")
        except F3ApiNotFoundError:
            return None
        raw = result.get("org") or result.get("result")
        return _parse_ao(raw) if raw else None

    def create(
        self,
        parent_id: int,
        name: str,
        description: str | None,
        slack_channel_id: str | None,
        default_location_id: int | None,
    ) -> AoData:
        """Create a new AO and return the created record."""
        payload: dict = {
            "name": name,
            "orgType": "ao",
            "parentId": parent_id,
            "isActive": True,
            "website": "",
            "twitter": "",
            "facebook": "",
            "instagram": "",
            "meta": {"slack_channel_id": slack_channel_id} if slack_channel_id else {},
        }
        if description is not None:
            payload["description"] = description
        if default_location_id is not None:
            payload["defaultLocationId"] = default_location_id
        result = self._client.post("/v1/org", json=payload)
        raw = result.get("org") or result.get("result") or result
        return _parse_ao(raw)

    def update(
        self,
        ao_id: int,
        parent_id: int,
        name: str,
        description: str | None,
        slack_channel_id: str | None,
        default_location_id: int | None,
        logo_url: str | None = None,
    ) -> None:
        """Update an existing AO (crupdate POST — all required fields must be sent)."""
        payload: dict = {
            "id": ao_id,
            "name": name,
            "orgType": "ao",
            "parentId": parent_id,
            "isActive": True,
            "website": "",
            "twitter": "",
            "facebook": "",
            "instagram": "",
            "meta": {"slack_channel_id": slack_channel_id} if slack_channel_id else {},
        }
        if description is not None:
            payload["description"] = description
        if default_location_id is not None:
            payload["defaultLocationId"] = default_location_id
        if logo_url is not None:
            payload["logoUrl"] = logo_url
        self._client.post("/v1/org", json=payload)

    def delete(self, ao_id: int) -> None:
        """Soft-delete an AO (API cascades to associated events/instances)."""
        self._client.delete(f"/v1/org/delete/{ao_id}")


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_repo: ApiAoRepository | None = None


def get_api_ao_repository() -> ApiAoRepository:
    """Return the shared ``ApiAoRepository`` instance."""
    global _repo
    if _repo is None:
        _repo = ApiAoRepository(get_f3_api_client())
    return _repo
