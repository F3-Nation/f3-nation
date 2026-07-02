from __future__ import annotations

from datetime import date
from typing import Any

from application.event_instance import EventInstanceData
from application.event_instance.repository import EventInstanceRepository


class EventInstanceService:
    """
    Business logic for event instances.

    Data access is delegated to an ``EventInstanceRepository`` injected by the
    caller (composition root), keeping the application layer independent of
    infrastructure details.
    """

    def __init__(self, repository: EventInstanceRepository) -> None:
        self._repository: EventInstanceRepository = repository

    def get_region_instances(
        self,
        region_org_id: int | str,
        start_date: date,
        ao_org_id: int | str | None = None,
        limit: int = 40,
    ) -> list[EventInstanceData]:
        """Return upcoming active instances for a region, optionally filtered by AO."""
        records = self._repository.get_list(
            region_org_id=int(region_org_id),
            start_date=start_date,
            ao_org_id=int(ao_org_id) if ao_org_id is not None else None,
        )
        # Sort by date, time, name then cap at limit
        records.sort(key=lambda x: (x.start_date or date.min, x.start_time or "", x.name or ""))
        return records[:limit]

    def get_by_id(self, instance_id: int) -> EventInstanceData | None:
        """Return a single event instance, or *None* if not found."""
        return self._repository.get_by_id(instance_id)

    def create_instance(
        self,
        name: str,
        org_id: int | str,
        start_date: date,
        start_time: str,
        end_time: str,
        description: str | None = None,
        location_id: int | str | None = None,
        event_type_ids: list[int] | None = None,
        event_tag_ids: list[int] | None = None,
        is_active: bool = True,
        is_private: bool = False,
        meta: dict | None = None,
        highlight: bool = False,
        preblast_rich: Any | None = None,
        preblast: str | None = None,
    ) -> EventInstanceData:
        """Create a new event instance and return the created record."""
        return self._repository.create(
            name=name,
            org_id=int(org_id),
            start_date=start_date,
            start_time=start_time,
            end_time=end_time,
            description=description,
            location_id=int(location_id) if location_id is not None else None,
            event_type_ids=event_type_ids or [],
            event_tag_ids=event_tag_ids or [],
            is_active=is_active,
            is_private=is_private,
            meta=meta,
            highlight=highlight,
            preblast_rich=preblast_rich,
            preblast=preblast,
        )

    def update_instance(
        self,
        instance_id: int,
        name: str,
        org_id: int | str,
        start_date: date,
        start_time: str,
        end_time: str,
        description: str | None = None,
        location_id: int | str | None = None,
        event_type_ids: list[int] | None = None,
        event_tag_ids: list[int] | None = None,
        is_active: bool = True,
        is_private: bool = False,
        meta: dict | None = None,
        highlight: bool = False,
        preblast_rich: Any | None = None,
        preblast: str | None = None,
    ) -> EventInstanceData:
        """Update an existing event instance and return the updated record."""
        return self._repository.update(
            instance_id=instance_id,
            name=name,
            org_id=int(org_id),
            start_date=start_date,
            start_time=start_time,
            end_time=end_time,
            description=description,
            location_id=int(location_id) if location_id is not None else None,
            event_type_ids=event_type_ids or [],
            event_tag_ids=event_tag_ids or [],
            is_active=is_active,
            is_private=is_private,
            meta=meta,
            highlight=highlight,
            preblast_rich=preblast_rich,
            preblast=preblast,
        )

    def _get_existing_instance_for_state_change(self, instance_id: int) -> EventInstanceData:
        """Return an existing instance for close/reopen operations."""
        existing = self._repository.get_by_id(instance_id)
        if existing is None:
            raise ValueError(f"Event instance {instance_id} was not found")
        return existing

    def close_instance(self, instance_id: int, close_reason: str | None) -> None:
        """Close an event instance with an optional reason stored in meta."""
        existing = self._get_existing_instance_for_state_change(instance_id)
        meta = dict(existing.meta or {})
        if close_reason:
            meta["series_exception_reason"] = close_reason
        self._repository.close(instance=existing, meta=meta)

    def reopen_instance(self, instance_id: int) -> None:
        """Remove the closed status from an event instance."""
        existing = self._get_existing_instance_for_state_change(instance_id)
        self._repository.reopen(instance=existing)

    def delete_instance(self, instance_id: int) -> None:
        """Hard-delete an event instance."""
        self._repository.delete(instance_id)
