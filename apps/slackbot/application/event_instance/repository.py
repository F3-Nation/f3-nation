from __future__ import annotations

from datetime import date
from typing import Any, Protocol

from application.event_instance import EventInstanceData


class EventInstanceRepository(Protocol):
    """
    Defines the data-access contract for event instances.

    Concrete implementations may be backed by the F3 Nation API, the legacy
    SQLAlchemy DbManager, or a test double.
    """

    def get_list(
        self,
        region_org_id: int,
        start_date: date,
        ao_org_id: int | None = None,
    ) -> list[EventInstanceData]:
        """Return active instances on or after *start_date* for the region (or specific AO)."""
        ...

    def get_by_id(self, instance_id: int) -> EventInstanceData | None:
        """Return a single event instance by primary key, or None if not found."""
        ...

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
        """Create a new event instance and return the created record."""
        ...

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
        """Update an existing event instance and return the updated record."""
        ...

    def close(self, instance: EventInstanceData, meta: dict) -> None:
        """Mark an instance as closed (seriesException="closed") with the given meta."""
        ...

    def reopen(self, instance: EventInstanceData) -> None:
        """Clear the seriesException field on an instance."""
        ...

    def delete(self, instance_id: int) -> None:
        """Hard-delete an event instance."""
        ...
