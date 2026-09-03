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
from infrastructure.api_client.pagination import fetch_all_pages

PREBLAST_CHANNEL_META_KEY = "preblast_channel_id"
PREBLAST_POST_CHANNEL_META_KEY = "preblast_post_channel_id"


def _resolve_and_validate_existing(
    repo: ApiEventInstanceRepository,
    instance_id: int,
    existing_instance: EventInstanceData | None,
) -> EventInstanceData:
    existing = existing_instance or repo.get_by_id(instance_id)
    if existing is None:
        raise ValueError(f"Event instance {instance_id} was not found")
    if existing.id != instance_id:
        raise ValueError(f"Existing event instance {existing.id} does not match requested id {instance_id}")
    if not existing.event_type_ids:
        raise ValueError(f"Event instance {instance_id} is missing required field 'event_type_ids'")
    return existing


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

    # Extract nested display data from by-id API response
    org_raw = raw.get("org")
    org_name = None
    org_meta = None
    if org_raw and isinstance(org_raw, dict):
        org_name = org_raw.get("name")
        org_meta = org_raw.get("meta")

    location_raw = raw.get("location")
    location_name = None
    location_latitude = None
    location_longitude = None
    if location_raw and isinstance(location_raw, dict):
        location_name = location_raw.get("locationName", location_raw.get("name"))
        location_latitude = location_raw.get("latitude")
        location_longitude = location_raw.get("longitude")

    # Extract event type names from nested objects
    event_type_names: list[str] = []
    if event_types_raw and isinstance(event_types_raw[0], dict):
        event_type_names = [t.get("eventTypeName", t.get("name", "")) for t in event_types_raw]

    # Extract event tag names from nested objects
    event_tag_names: list[str] = []
    if event_tags_raw and isinstance(event_tags_raw[0], dict):
        event_tag_names = [t.get("eventTagName", t.get("name", "")) for t in event_tags_raw]

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
        preblast_ts=raw.get("preblastTs", raw.get("preblast_ts")),
        series_id=raw.get("seriesId", raw.get("series_id")),
        series_exception=raw.get("seriesException", raw.get("series_exception")),
        org_name=org_name,
        org_meta=org_meta,
        location_name=location_name,
        location_latitude=location_latitude,
        location_longitude=location_longitude,
        event_type_names=event_type_names,
        event_tag_names=event_tag_names,
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
    preblast_ts: int | float | None = None,
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
    if preblast_ts is not None:
        payload["preblastTs"] = preblast_ts
    return payload


def _merged_meta(existing: dict | None, updates: dict | None = None) -> dict:
    meta = dict(existing or {})
    if updates:
        meta.update(updates)
    return meta


def _require_start_date(instance: EventInstanceData) -> date:
    if instance.start_date is None:
        raise ValueError(f"Event instance {instance.id} is missing required field 'start_date'")
    return instance.start_date


def _parse_mutation_response(result: dict, fallback: EventInstanceData) -> EventInstanceData:
    """Parse a crupdate response, falling back to the locally computed update.

    The event-instance API normally returns the updated object.  Some tests and
    older API shapes only return an acknowledgement, so callers provide a
    best-effort fallback to avoid an extra GET after every POST.
    """
    raw = result.get("eventInstance") or result.get("result")
    if raw is None and result.get("id") is not None:
        raw = result
    if isinstance(raw, dict) and raw.get("id") is not None:
        return _parse_instance(raw)
    return fallback


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
        preblast_ts=instance.preblast_ts,
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
        raw_list = fetch_all_pages(
            self._client,
            "/v1/event-instance",
            params=params,
            items_key="eventInstances",
        )
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
        preblast_ts: int | float | None = None,
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
            preblast_ts=preblast_ts,
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
        preblast_ts: int | float | None = None,
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
            preblast_ts=preblast_ts,
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

    def update_preblast_fields(
        self,
        instance_id: int,
        *,
        name: str | None = None,
        preblast_rich: Any | None = None,
        preblast: str | None = None,
        location_id: int | None = None,
        clear_location_id: bool = False,
        start_date: date | None = None,
        start_time: str | None = None,
        event_tag_ids: list[int] | None = None,
        meta_updates: dict | None = None,
        preblast_channel_id: str | None = None,
        existing_instance: EventInstanceData | None = None,
    ) -> EventInstanceData:
        existing = _resolve_and_validate_existing(self, instance_id, existing_instance)
        meta_updates = _merged_meta(
            meta_updates,
            {PREBLAST_CHANNEL_META_KEY: preblast_channel_id} if preblast_channel_id else None,
        )
        tag_ids = event_tag_ids if event_tag_ids is not None else existing.event_tag_ids
        resolved_location_id = None if clear_location_id else location_id
        if not clear_location_id and location_id is None:
            resolved_location_id = existing.location_id
        payload = _build_crupdate_payload(
            name=name if name is not None else existing.name or "",
            org_id=existing.org_id,
            start_date=start_date or _require_start_date(existing),
            start_time=start_time or existing.start_time or "",
            end_time=existing.end_time or "",
            description=existing.description,
            location_id=resolved_location_id,
            event_type_id=existing.event_type_ids[0],
            event_tag_id=tag_ids[0] if tag_ids else None,
            is_active=existing.is_active,
            is_private=existing.is_private,
            meta=_merged_meta(existing.meta, meta_updates),
            highlight=existing.highlight,
            preblast_rich=preblast_rich if preblast_rich is not None else existing.preblast_rich,
            preblast=preblast if preblast is not None else existing.preblast,
            preblast_ts=existing.preblast_ts,
        )
        payload["id"] = instance_id
        if event_tag_ids is not None and not event_tag_ids:
            payload["eventTagId"] = None
        if clear_location_id:
            payload["locationId"] = None
        result = self._client.post("/v1/event-instance", json=payload)
        fallback = existing.model_copy(
            update={
                "name": payload["name"],
                "start_date": start_date or existing.start_date,
                "start_time": payload["startTime"],
                "location_id": resolved_location_id,
                "event_tag_ids": tag_ids,
                "meta": payload.get("meta"),
                "preblast_rich": payload.get("preblastRich", existing.preblast_rich),
                "preblast": payload.get("preblast", existing.preblast),
            }
        )
        return _parse_mutation_response(result, fallback)

    def persist_posted_preblast(
        self,
        instance_id: int,
        *,
        preblast_ts: int | float,
        preblast_post_channel_id: str,
        existing_instance: EventInstanceData | None = None,
    ) -> EventInstanceData:
        existing = _resolve_and_validate_existing(self, instance_id, existing_instance)
        payload = _build_crupdate_payload(
            name=existing.name or "",
            org_id=existing.org_id,
            start_date=_require_start_date(existing),
            start_time=existing.start_time or "",
            end_time=existing.end_time or "",
            description=existing.description,
            location_id=existing.location_id,
            event_type_id=existing.event_type_ids[0],
            event_tag_id=existing.event_tag_ids[0] if existing.event_tag_ids else None,
            is_active=existing.is_active,
            is_private=existing.is_private,
            meta=_merged_meta(existing.meta, {PREBLAST_POST_CHANNEL_META_KEY: preblast_post_channel_id}),
            highlight=existing.highlight,
            preblast_rich=existing.preblast_rich,
            preblast=existing.preblast,
            preblast_ts=preblast_ts,
        )
        payload["id"] = instance_id
        result = self._client.post("/v1/event-instance", json=payload)
        fallback = existing.model_copy(
            update={
                "meta": payload.get("meta"),
                "preblast_ts": preblast_ts,
            }
        )
        return _parse_mutation_response(result, fallback)


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
