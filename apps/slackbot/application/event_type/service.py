from application.event_type import EventTypeData
from application.event_type.repository import EventTypeRepository


class EventTypeService:
    """
    Business logic for event types.

    Data access is delegated to an ``EventTypeRepository`` injected by the
    caller (composition root), keeping the application layer independent of
    infrastructure details.
    """

    def __init__(self, repository: EventTypeRepository) -> None:
        self._repository: EventTypeRepository = repository

    def get_org_specific_event_types(self, org_id: int | str) -> list[EventTypeData]:
        """Return only org-specific event types for *org_id*."""
        return self._repository.get_by_org(int(org_id))

    def get_all_event_types_for_org(self, org_id: int | str) -> list[EventTypeData]:
        """Return org-specific and global event types visible to *org_id*."""
        return self._repository.get_all_for_org(int(org_id))

    def get_event_type_by_id(self, event_type_id: int) -> EventTypeData | None:
        """Return a single event type, or *None* if not found."""
        return self._repository.get_by_id(event_type_id)

    def create_org_specific_type(self, name: str, acronym: str, event_category: str, org_id: int | str) -> None:
        """Create a new org-specific event type."""
        self._repository.create(name, acronym, event_category, int(org_id))

    def update_org_specific_type(self, event_type_id: int, name: str, acronym: str, event_category: str) -> None:
        """Update the name, acronym, and category of an existing event type."""
        self._repository.update(event_type_id, name, acronym, event_category)

    def delete_org_specific_type(self, event_type_id: int) -> None:
        """Soft-delete an event type."""
        self._repository.delete(event_type_id)
