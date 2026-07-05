from typing import Protocol

from application.event_type import EventTypeData


class EventTypeRepository(Protocol):
    """
    Defines the data-access contract for event types.

    Concrete implementations may be backed by the F3 Nation API, the legacy
    SQLAlchemy DbManager, or a test double.
    """

    def get_by_org(self, org_id: int) -> list[EventTypeData]:
        """Return only org-specific event types for the given org."""
        ...

    def get_all_for_org(self, org_id: int) -> list[EventTypeData]:
        """Return org-specific and global (nation-wide) event types visible to the given org."""
        ...

    def get_by_id(self, event_type_id: int) -> EventTypeData | None:
        """Return a single event type by primary key, or None if not found."""
        ...

    def create(self, name: str, acronym: str, event_category: str, org_id: int) -> None:
        """Create a new org-specific event type."""
        ...

    def update(self, event_type_id: int, name: str, acronym: str, event_category: str) -> None:
        """Update the name, acronym, and category of an existing event type."""
        ...

    def delete(self, event_type_id: int) -> None:
        """Soft-delete an event type."""
        ...
