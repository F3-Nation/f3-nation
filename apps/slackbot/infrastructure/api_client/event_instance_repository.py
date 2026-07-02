"""
API-backed implementation of ``EventInstanceRepository``.

Maps responses from the F3 Nation REST API to ``EventInstanceData`` objects.

Endpoints used:
  GET    /v1/event-instance                 - list (filter by regionOrgId, aoOrgId, startDate)
  GET    /v1/event-instance/id/{id}         - single
  POST   /v1/event-instance                 - create or update (crupdate)
  DELETE /v1/event-instance/id/{id}         - hard delete

Note: DELETE on event-instance is a HARD delete (unlike most other domains which soft-delete).
Close and reopen are implemented via crupdate POST using the existing instance details plus the
updated seriesException value.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from application.event_instance import EventInstanceData
from infrastructure.api_client.client import F3ApiClient, get_f3_api_client
from infrastructure.api_client.exceptions import F3ApiNotFoundError


def _parse_instance(raw: dict) -> EventInstanceData:
    """Convert a raw API response dict to an ``EventInstanceData`` object."""
    # event_type_ids: API may return nested objects array (eventTypes),
    # a plain ID array (event_types), or a single number (eventTypeId).
    event_types_raw = raw.get("eventTypes", raw.get("event_types", []))
    if event_types_raw and isinstance(event_types_raw[0], dict):
        event_type_ids = [t["eventTypeId"] for t in event_types_raw]
    elif event_types_raw:
        event_type_ids = [int(t) for t in event_types_raw if t is not None]
    else:
        et = raw.get("eventTypeId", raw.get("event_type_id"))
        event_type_ids = [int(et)] if et is not None else []

    event_tags_raw = raw.get("eventTags", raw.get("event_tags", []))
    if event_tags_raw and isinstance(event_tags_raw[0], dict):
        event_tag_ids = [t["eventTagId"] for t in event_tags_raw]
    elif event_tags_raw:
        event_tag_ids = [int(t) for t in event_tags_raw if t is not None]
    else:
        etag = raw.get("eventTagId", raw.get("event_tag_id"))
        event_tag_ids = [int(etag)] if etag is not None else []

    # startDate may come as "YYYY-MM-DD" string or a date object
    raw_start_date = raw.get("startDate", raw.get("start_date"))
    if isinstance(raw_start_date, str):
        from datetime import datetime

        start_date = datetime.strptime(raw_start_date, "%Y-%m-%d").date()
    elif isinstance(raw_start_date, date):
        start_date = raw_start_date
    else:
        start_date = None

    return EventInstanceData(
        id=raw["id"],
        name=raw.get("name"),
        description=raw.get("description"),
        org_id=raw.get("orgId", raw.get("org_id", 0)),
        location_id=raw.get("locationId", raw.get("location_id")),
        event_type_ids=event_type_ids,
        event_tag_ids=event_tag_ids,
        start_date=start_date,
        start_time=raw.get("startTime", raw.get("start_time")),
        end_time=raw.get("endTime", raw.get("end_time")),
        is_active=raw.get("isActive", raw.get("is_active", True)),
        is_private=raw.get("isPrivate", raw.get("is_private", False)),
        meta=raw.get("meta"),
        highlight=raw.get("highlight", False),
        preblast_rich=raw.get("preblastRich", raw.get("preblast_rich")),
        preblast=raw.get("preblast"),
        series_exception=raw.get("seriesException", raw.get("series_exception")),
    )


def _build_crupdate_payload(
    name: str,
    org_id: int,
    start_date: date,
    start_time: str,
    end_time: str,
    description: str | None,
    location_id: int | None,
    event_type_id: int,
    event_tag_id: int | None,
    is_active: bool,
    is_private: bool,
    meta: dict | None,
    highlight: bool,
    preblast_rich: Any | None,
    preblast: str | None,
) -> dict:
    # The API accepts a single eventTypeId and eventTagId (not arrays).
    payload: dict = {
        "name": name,
        "orgId": org_id,
        "startDate": start_date.strftime("%Y-%m-%d"),
        "startTime": start_time,
        "endTime": end_time,
        "isActive": is_active,
        "isPrivate": is_private,
        "highlight": highlight,
        "eventTypeId": event_type_id,
    }
    if event_tag_id is not None:
        payload["eventTagId"] = event_tag_id
    if description is not None:
        payload["description"] = description
    if location_id is not None:
        payload["locationId"] = location_id
    if meta is not None:
        payload["meta"] = meta
    if preblast_rich is not None:
        payload["preblastRich"] = preblast_rich
    if preblast is not None:
        payload["preblast"] = preblast
    return payload


def _build_state_change_payload(
    instance: EventInstanceData,
    *,
    series_exception: str | None,
    meta: dict | None = None,
) -> dict:
    if not instance.name:
        raise ValueError(f"Event instance {instance.id} is missing required field 'name'")
    if not instance.org_id:
        raise ValueError(f"Event instance {instance.id} is missing required field 'org_id'")
    if instance.start_date is None:
        raise ValueError(f"Event instance {instance.id} is missing required field 'start_date'")
    if not instance.start_time:
        raise ValueError(f"Event instance {instance.id} is missing required field 'start_time'")
    if not instance.end_time:
        raise ValueError(f"Event instance {instance.id} is missing required field 'end_time'")
    if not instance.event_type_ids:
        raise ValueError(f"Event instance {instance.id} is missing required field 'event_type_ids'")

    payload = _build_crupdate_payload(
        name=instance.name,
        org_id=instance.org_id,
        start_date=instance.start_date,
        start_time=instance.start_time,
        end_time=instance.end_time,
        description=instance.description,
        location_id=instance.location_id,
        event_type_id=instance.event_type_ids[0],
        event_tag_id=instance.event_tag_ids[0] if instance.event_tag_ids else None,
        is_active=instance.is_active,
        is_private=instance.is_private,
        meta=instance.meta if meta is None else meta,
        highlight=instance.highlight,
        preblast_rich=instance.preblast_rich,
        preblast=instance.preblast,
    )
    payload["id"] = instance.id
    payload["seriesException"] = series_exception
    return payload


class ApiEventInstanceRepository:
    """Fetches and mutates event instances via the F3 Nation REST API."""

    def __init__(self, client: F3ApiClient) -> None:
        self._client = client

    def get_list(
        self,
        region_org_id: int,
        start_date: date,
        ao_org_id: int | None = None,
    ) -> list[EventInstanceData]:
        params: dict = {
            "regionOrgId": region_org_id,
            "startDate": start_date.strftime("%Y-%m-%d"),
        }
        if ao_org_id is not None:
            params["aoOrgId"] = ao_org_id
        result = self._client.get("/v1/event-instance", params=params)
        raw_list: list[dict] = result.get("eventInstances") or result.get("results") or []
        return [_parse_instance(i) for i in raw_list]

    def get_by_id(self, instance_id: int) -> EventInstanceData | None:
        try:
            result = self._client.get(f"/v1/event-instance/id/{instance_id}")
        except F3ApiNotFoundError:
            return None
        raw = result.get("eventInstance") or result.get("result") or result
        return _parse_instance(raw) if raw else None

    def create(
        self,
        name: str,
        org_id: int,
        start_date: date,
        start_time: str,
        end_time: str,
        description: str | None,
        location_id: int | None,
        event_type_ids: list[int],
        event_tag_ids: list[int],
        is_active: bool,
        is_private: bool,
        meta: dict | None,
        highlight: bool,
        preblast_rich: Any | None,
        preblast: str | None,
    ) -> EventInstanceData:
        payload = _build_crupdate_payload(
            name=name,
            org_id=org_id,
            start_date=start_date,
            start_time=start_time,
            end_time=end_time,
            description=description,
            location_id=location_id,
            event_type_id=event_type_ids[0] if event_type_ids else 0,
            event_tag_id=event_tag_ids[0] if event_tag_ids else None,
            is_active=is_active,
            is_private=is_private,
            meta=meta,
            highlight=highlight,
            preblast_rich=preblast_rich,
            preblast=preblast,
        )
        result = self._client.post("/v1/event-instance", json=payload)
        raw = result.get("eventInstance") or result.get("result") or result
        return _parse_instance(raw)

    def update(
        self,
        instance_id: int,
        name: str,
        org_id: int,
        start_date: date,
        start_time: str,
        end_time: str,
        description: str | None,
        location_id: int | None,
        event_type_ids: list[int],
        event_tag_ids: list[int],
        is_active: bool,
        is_private: bool,
        meta: dict | None,
        highlight: bool,
        preblast_rich: Any | None,
        preblast: str | None,
    ) -> EventInstanceData:
        payload = _build_crupdate_payload(
            name=name,
            org_id=org_id,
            start_date=start_date,
            start_time=start_time,
            end_time=end_time,
            description=description,
            location_id=location_id,
            event_type_id=event_type_ids[0] if event_type_ids else 0,
            event_tag_id=event_tag_ids[0] if event_tag_ids else None,
            is_active=is_active,
            is_private=is_private,
            meta=meta,
            highlight=highlight,
            preblast_rich=preblast_rich,
            preblast=preblast,
        )
        payload["id"] = instance_id
        result = self._client.post("/v1/event-instance", json=payload)
        raw = result.get("eventInstance") or result.get("result") or result
        return _parse_instance(raw)

    def close(self, instance: EventInstanceData, meta: dict) -> None:
        """Mark an instance as closed via a full crupdate POST."""
        self._client.post(
            "/v1/event-instance",
            json=_build_state_change_payload(instance, series_exception="closed", meta=meta),
        )

    def reopen(self, instance: EventInstanceData) -> None:
        """Clear the seriesException via a full crupdate POST."""
        self._client.post(
            "/v1/event-instance",
            json=_build_state_change_payload(instance, series_exception=None),
        )

    def delete(self, instance_id: int) -> None:
        """Hard-delete an event instance."""
        self._client.delete(f"/v1/event-instance/id/{instance_id}")


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_repo: ApiEventInstanceRepository | None = None


def get_api_event_instance_repository() -> ApiEventInstanceRepository:
    """Return the shared ``ApiEventInstanceRepository`` instance."""
    global _repo
    if _repo is None:
        _repo = ApiEventInstanceRepository(get_f3_api_client())
    return _repo
