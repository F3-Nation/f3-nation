"""
API-backed implementation of ``SeriesRepository``.

Maps responses from the F3 Nation REST API to ``SeriesData`` objects.

Endpoints used:
  GET    /v1/event                  - list by region or AO (filter by regionIds / aoIds)
  GET    /v1/event/id/{id}          - single series by ID
  POST   /v1/event                  - create or update (crupdate)
  DELETE /v1/event/delete/{id}      - soft-delete (cascades to future EventInstances)

Cascade behaviour note:
  The F3 Nation API automatically creates/updates/deletes future EventInstances
  when a series (Event) is created, updated, or deleted.  This application layer
  therefore does NOT manage EventInstance records directly; all cascade logic is
  handled server-side.

API field notes:
  - Response from GET /v1/event/id/{id} returns ``aos`` (list of {aoId, aoName})
    and ``regions`` (list of {regionId, regionName}), but NOT ``orgId`` directly.
  - Response from POST /v1/event (crupdate) returns ``orgId`` directly.
  - Response from GET /v1/event (list) returns ``parents`` (list of {parentId, parentName})
    for the AO and ``regions`` for the region.
  - Neither the list nor single-by-ID endpoint returns event tag IDs.
    ``SeriesData.event_tag_ids`` will always be ``[]`` when parsed from the API.
"""

from __future__ import annotations

from application.series import SeriesData
from infrastructure.api_client.client import F3ApiClient, get_f3_api_client
from infrastructure.api_client.exceptions import F3ApiNotFoundError

_repo: "ApiSeriesRepository | None" = None


def _parse_series(raw: dict) -> SeriesData:
    """Convert a raw API response dict to a ``SeriesData`` object."""
    # org_id: crupdate response → orgId; GET by ID → aos[0].aoId; list → parents[0].parentId
    org_id = (
        raw.get("orgId")
        or raw.get("org_id")
        or (raw["aos"][0].get("aoId") if raw.get("aos") else None)
        or (raw["parents"][0].get("parentId") if raw.get("parents") else None)
        or 0
    )

    # event_type_ids: list or GET by ID → eventTypes[{eventTypeId, ...}]
    event_types_raw = raw.get("eventTypes", [])
    if event_types_raw and isinstance(event_types_raw[0], dict):
        event_type_ids = [
            t.get("eventTypeId") or t.get("id") for t in event_types_raw if t.get("eventTypeId") or t.get("id")
        ]
    elif event_types_raw:
        event_type_ids = [int(t) for t in event_types_raw if t is not None]
    else:
        event_type_ids = []

    # regions
    regions = raw.get("regions", [])
    region_id = regions[0].get("regionId") if regions else raw.get("regionId", raw.get("region_id"))

    return SeriesData(
        id=raw["id"],
        name=raw.get("name", ""),
        description=raw.get("description"),
        is_active=raw.get("isActive", raw.get("is_active", True)),
        is_private=raw.get("isPrivate", raw.get("is_private", False)),
        highlight=raw.get("highlight", False),
        location_id=raw.get("locationId", raw.get("location_id")),
        org_id=org_id,
        region_id=region_id,
        start_date=raw.get("startDate", raw.get("start_date")),
        end_date=raw.get("endDate", raw.get("end_date")),
        start_time=raw.get("startTime", raw.get("start_time")),
        end_time=raw.get("endTime", raw.get("end_time")),
        day_of_week=raw.get("dayOfWeek", raw.get("day_of_week")),
        recurrence_pattern=raw.get("recurrencePattern", raw.get("recurrence_pattern")),
        recurrence_interval=raw.get("recurrenceInterval", raw.get("recurrence_interval")),
        index_within_interval=raw.get("indexWithinInterval", raw.get("index_within_interval")),
        meta=raw.get("meta"),
        event_type_ids=event_type_ids,
        event_tag_ids=[],  # API does not return event tag IDs for events
    )


def _build_crupdate_payload(
    *,
    series_id: int | None,
    region_id: int,
    ao_id: int,
    name: str,
    start_date: str,
    start_time: str | None,
    end_time: str | None,
    day_of_week: str | None,
    description: str | None,
    location_id: int | None,
    end_date: str | None,
    recurrence_pattern: str | None,
    recurrence_interval: int | None,
    index_within_interval: int | None,
    event_type_ids: list[int],
    event_tag_ids: list[int],
    is_active: bool,
    is_private: bool,
    highlight: bool,
    meta: dict | None,
) -> dict:
    payload: dict = {
        "name": name,
        "regionId": region_id,
        "aoId": ao_id,
        "isActive": is_active,
        "highlight": highlight,
        "startDate": start_date,
        "isPrivate": is_private,
        "eventTypeIds": event_type_ids,
    }
    if series_id is not None:
        payload["id"] = series_id
    if location_id is not None:
        payload["locationId"] = location_id
    if end_date is not None:
        payload["endDate"] = end_date
    if start_time is not None:
        payload["startTime"] = start_time
    if end_time is not None:
        payload["endTime"] = end_time
    if day_of_week is not None:
        payload["dayOfWeek"] = day_of_week
    if description is not None:
        payload["description"] = description
    if recurrence_pattern is not None:
        payload["recurrencePattern"] = recurrence_pattern
    if recurrence_interval is not None:
        payload["recurrenceInterval"] = recurrence_interval
    if index_within_interval is not None:
        payload["indexWithinInterval"] = index_within_interval
    if meta:
        payload["meta"] = meta
    if event_tag_ids:
        payload["eventTagIds"] = event_tag_ids
    return payload


class ApiSeriesRepository:
    """Fetches and mutates event series (Events) via the F3 Nation REST API."""

    def __init__(self, client: F3ApiClient) -> None:
        self._client = client

    def get_by_region(self, region_id: int, ao_id: int | None = None) -> list[SeriesData]:
        """Return active series for a region, optionally scoped to a single AO."""
        if ao_id is not None:
            params: dict = {"aoIds": [ao_id], "statuses": ["active"]}
        else:
            params = {"regionIds": [region_id], "statuses": ["active"]}
        result = self._client.get("/v1/event", params=params)
        events_raw: list[dict] = result.get("events") or result.get("results") or []
        return [_parse_series(e) for e in events_raw]

    def get_by_id(self, series_id: int) -> SeriesData | None:
        """Return a single series by primary key, or *None* if not found."""
        try:
            result = self._client.get(f"/v1/event/id/{series_id}")
        except F3ApiNotFoundError:
            return None
        raw = result.get("event") or result.get("result")
        return _parse_series(raw) if raw else None

    def create(
        self,
        region_id: int,
        ao_id: int,
        name: str,
        start_date: str,
        start_time: str | None,
        end_time: str | None,
        day_of_week: str,
        description: str | None,
        location_id: int | None,
        end_date: str | None,
        recurrence_pattern: str | None,
        recurrence_interval: int | None,
        index_within_interval: int | None,
        event_type_ids: list[int],
        event_tag_ids: list[int],
        is_active: bool,
        is_private: bool,
        highlight: bool,
        meta: dict | None,
    ) -> SeriesData:
        """Create a new series; the API automatically generates future instances."""
        payload = _build_crupdate_payload(
            series_id=None,
            region_id=region_id,
            ao_id=ao_id,
            name=name,
            start_date=start_date,
            start_time=start_time,
            end_time=end_time,
            day_of_week=day_of_week,
            description=description,
            location_id=location_id,
            end_date=end_date,
            recurrence_pattern=recurrence_pattern,
            recurrence_interval=recurrence_interval,
            index_within_interval=index_within_interval,
            event_type_ids=event_type_ids,
            event_tag_ids=event_tag_ids,
            is_active=is_active,
            is_private=is_private,
            highlight=highlight,
            meta=meta,
        )
        result = self._client.post("/v1/event", json=payload)
        raw = result.get("event") or result.get("result")
        return _parse_series(raw)

    def update(
        self,
        series_id: int,
        region_id: int,
        ao_id: int,
        name: str,
        start_date: str,
        start_time: str | None,
        end_time: str | None,
        description: str | None,
        location_id: int | None,
        end_date: str | None,
        event_type_ids: list[int],
        event_tag_ids: list[int],
        is_active: bool,
        is_private: bool,
        highlight: bool,
        meta: dict | None,
    ) -> SeriesData:
        """Update an existing series; the API cascades changes to future instances."""
        payload = _build_crupdate_payload(
            series_id=series_id,
            region_id=region_id,
            ao_id=ao_id,
            name=name,
            start_date=start_date,
            start_time=start_time,
            end_time=end_time,
            day_of_week=None,  # day_of_week is immutable on edit (form doesn't expose it)
            description=description,
            location_id=location_id,
            end_date=end_date,
            recurrence_pattern=None,  # recurrence fields immutable on edit
            recurrence_interval=None,
            index_within_interval=None,
            event_type_ids=event_type_ids,
            event_tag_ids=event_tag_ids,
            is_active=is_active,
            is_private=is_private,
            highlight=highlight,
            meta=meta,
        )
        result = self._client.post("/v1/event", json=payload)
        raw = result.get("event") or result.get("result")
        return _parse_series(raw)

    def delete(self, series_id: int) -> None:
        """Soft-delete a series; future instances are cascade-deleted by the API."""
        self._client.delete(f"/v1/event/delete/{series_id}")


def get_api_series_repository() -> ApiSeriesRepository:
    """Return the module-level singleton ``ApiSeriesRepository``."""
    global _repo
    if _repo is None:
        _repo = ApiSeriesRepository(get_f3_api_client())
    return _repo
