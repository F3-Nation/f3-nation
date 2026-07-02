"""
API-backed implementation of ``PositionRepository``.

Maps responses from the F3 Nation REST API to ``PositionData`` and
``PositionWithAssignmentsData`` objects.

Key endpoints used:

  GET  /v1/position/org/{orgId}              — org-specific positions (excludes global)
  GET  /v1/position/assignments/{orgId}      — positions with assigned users for an org
  GET  /v1/position/id/{positionId}          — single position by ID
  POST /v1/position                          — create or update (crupdate; omit id to create)
  DELETE /v1/position/id/{positionId}        — soft delete
  PUT  /v1/position/assignments              — replace all assignments for an org (deprecated
                                               but kept for backward compatibility)
"""

from __future__ import annotations

from application.position import PositionData, PositionWithAssignmentsData, UserAssignmentData
from infrastructure.api_client.client import F3ApiClient, get_f3_api_client
from infrastructure.api_client.exceptions import F3ApiNotFoundError


def _parse_position(raw: dict) -> PositionData:
    return PositionData(
        id=raw["id"],
        name=raw["name"],
        description=raw.get("description"),
        org_id=raw.get("orgId", raw.get("org_id")),
        org_type=raw.get("orgType", raw.get("org_type")),
        is_active=raw.get("isActive", raw.get("is_active", True)),
    )


def _parse_position_with_assignments(raw: dict) -> PositionWithAssignmentsData:
    users_raw = raw.get("users") or []
    users = [
        UserAssignmentData(
            user_id=u["id"],
            f3_name=u.get("f3Name", u.get("f3_name")),
        )
        for u in users_raw
    ]
    return PositionWithAssignmentsData(
        id=raw["id"],
        name=raw["name"],
        description=raw.get("description"),
        org_id=raw.get("orgId", raw.get("org_id")),
        org_type=raw.get("orgType", raw.get("org_type")),
        is_active=raw.get("isActive", raw.get("is_active", True)),
        users=users,
    )


class ApiPositionRepository:
    """Fetches and mutates positions and assignments via the F3 Nation REST API."""

    def __init__(self, client: F3ApiClient) -> None:
        self._client = client

    def get_by_org(self, org_id: int) -> list[PositionData]:
        """Return org-specific positions (excludes global/national) for *org_id*."""
        result = self._client.get(f"/v1/position/org/{org_id}", params={"isActive": True})
        raw_list = result.get("positions") or result.get("results") or []
        return [_parse_position(p) for p in raw_list if p.get("isActive", p.get("is_active", True))]

    def get_assignments(self, org_id: int, region_org_id: int) -> list[PositionWithAssignmentsData]:
        """Return all positions with their assigned users for *org_id*.

        *region_org_id* is passed as the ``regionOrgId`` query param so the API
        returns the correct tier of positions (region-level vs AO-level).
        """
        result = self._client.get(
            f"/v1/position/assignments/{org_id}",
            params={"regionOrgId": region_org_id},
        )
        raw_list = result.get("positions") or result.get("results") or []
        return [_parse_position_with_assignments(p) for p in raw_list]

    def get_by_id(self, position_id: int) -> PositionData | None:
        try:
            result = self._client.get(f"/v1/position/id/{position_id}")
        except F3ApiNotFoundError:
            return None
        raw = result.get("position") or result.get("result")
        return _parse_position(raw) if raw else None

    def create(self, name: str, description: str | None, org_id: int, org_type: str) -> PositionData:
        result = self._client.post(
            "/v1/position",
            json={
                "name": name,
                "description": description,
                "orgId": org_id,
                "orgType": org_type,
                "isActive": True,
            },
        )
        raw = result.get("position") or result.get("result")
        return _parse_position(raw) if raw else PositionData(id=0, name=name)

    def update(self, position_id: int, name: str, description: str | None) -> None:
        self._client.post(
            "/v1/position",
            json={
                "id": position_id,
                "name": name,
                "description": description,
            },
        )

    def delete(self, position_id: int) -> None:
        self._client.delete(f"/v1/position/id/{position_id}")

    def update_all_assignments(self, org_id: int, assignments: list[dict]) -> None:
        """Replace all position assignments for *org_id*.

        Uses the deprecated ``PUT /v1/position/assignments`` endpoint which
        atomically replaces all assignments for an org in one call.
        *assignments* format: ``[{"positionId": int, "userIds": [int, ...]}, ...]``.
        """
        self._client.put(
            "/v1/position/assignments",
            json={"orgId": org_id, "assignments": assignments},
        )


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_repo: ApiPositionRepository | None = None


def get_api_position_repository() -> ApiPositionRepository:
    global _repo
    if _repo is None:
        _repo = ApiPositionRepository(get_f3_api_client())
    return _repo
