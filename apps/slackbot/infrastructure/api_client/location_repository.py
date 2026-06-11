"""
API-backed implementation of ``LocationRepository``.

Maps responses from the F3 Nation REST API to ``LocationData`` objects.
"""

from __future__ import annotations

from application.location import LocationData
from infrastructure.api_client.client import F3ApiClient, get_f3_api_client
from infrastructure.api_client.exceptions import F3ApiNotFoundError


def _parse_location(raw: dict) -> LocationData:
    return LocationData(
        id=raw["id"],
        name=raw.get("locationName", raw.get("name", "")),  # API uses locationName
        description=raw.get("description"),
        latitude=raw.get("latitude"),
        longitude=raw.get("longitude"),
        address_street=raw.get("addressStreet", raw.get("address_street")),
        address_street2=raw.get("addressStreet2", raw.get("address_street2")),
        address_city=raw.get("addressCity", raw.get("address_city")),
        address_state=raw.get("addressState", raw.get("address_state")),
        address_zip=raw.get("addressZip", raw.get("address_zip")),
        address_country=raw.get("addressCountry", raw.get("address_country")),
        is_active=raw.get("isActive", raw.get("is_active", True)),
        org_id=raw.get("orgId", raw.get("org_id")),
    )


class ApiLocationRepository:
    """Fetches and mutates locations via the F3 Nation REST API."""

    def __init__(self, client: F3ApiClient) -> None:
        self._client = client

    def get_by_org(self, org_id: int) -> list[LocationData]:
        """Return active locations for *org_id*."""
        result = self._client.get("/v1/location", params={"regionIds": [org_id]})
        locations_raw: list[dict] = result.get("locations") or result.get("results") or []
        return [_parse_location(loc) for loc in locations_raw]

    def get_by_id(self, location_id: int) -> LocationData | None:
        try:
            result = self._client.get(f"/v1/location/id/{location_id}")
        except F3ApiNotFoundError:
            return None
        raw = result.get("location") or result.get("result")
        return _parse_location(raw) if raw else None

    def create(
        self,
        name: str,
        org_id: int,
        description: str | None,
        latitude: float | None,
        longitude: float | None,
        address_street: str | None,
        address_street2: str | None,
        address_city: str | None,
        address_state: str | None,
        address_zip: str | None,
        address_country: str | None,
    ) -> LocationData:
        payload: dict = {
            "name": name,
            "orgId": org_id,
            "isActive": True,
        }
        if description is not None:
            payload["description"] = description
        if latitude is not None:
            payload["latitude"] = latitude
        if longitude is not None:
            payload["longitude"] = longitude
        if address_street is not None:
            payload["addressStreet"] = address_street
        if address_street2 is not None:
            payload["addressStreet2"] = address_street2
        if address_city is not None:
            payload["addressCity"] = address_city
        if address_state is not None:
            payload["addressState"] = address_state
        if address_zip is not None:
            payload["addressZip"] = address_zip
        if address_country is not None:
            payload["addressCountry"] = address_country

        result = self._client.post("/v1/location", json=payload)
        raw = result.get("location") or result.get("result") or result
        return _parse_location(raw)

    def update(
        self,
        location_id: int,
        name: str,
        org_id: int,
        is_active: bool = True,
        description: str | None = None,
        latitude: float | None = None,
        longitude: float | None = None,
        address_street: str | None = None,
        address_street2: str | None = None,
        address_city: str | None = None,
        address_state: str | None = None,
        address_zip: str | None = None,
        address_country: str | None = None,
    ) -> None:
        payload: dict = {"id": location_id, "name": name, "orgId": org_id, "isActive": is_active}
        if description is not None:
            payload["description"] = description
        if latitude is not None:
            payload["latitude"] = latitude
        if longitude is not None:
            payload["longitude"] = longitude
        if address_street is not None:
            payload["addressStreet"] = address_street
        if address_street2 is not None:
            payload["addressStreet2"] = address_street2
        if address_city is not None:
            payload["addressCity"] = address_city
        if address_state is not None:
            payload["addressState"] = address_state
        if address_zip is not None:
            payload["addressZip"] = address_zip
        if address_country is not None:
            payload["addressCountry"] = address_country
        self._client.post("/v1/location", json=payload)

    def delete(self, location_id: int) -> None:
        self._client.delete(f"/v1/location/delete/{location_id}")


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_repo: ApiLocationRepository | None = None


def get_api_location_repository() -> ApiLocationRepository:
    """Return the shared ``ApiLocationRepository`` instance."""
    global _repo
    if _repo is None:
        _repo = ApiLocationRepository(get_f3_api_client())
    return _repo
