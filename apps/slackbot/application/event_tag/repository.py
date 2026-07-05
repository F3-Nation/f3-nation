from typing import Protocol

from application.event_tag import EventTagData


class EventTagRepository(Protocol):
    """
    Defines the data-access contract for event tags.

    Concrete implementations may be backed by the F3 Nation API, the legacy
    SQLAlchemy DbManager, or a test double.
    """

    def get_by_org(self, org_id: int) -> list[EventTagData]:
        """Return only org-specific (custom) event tags for the given org."""
        ...

    def get_all_for_org(self, org_id: int) -> list[EventTagData]:
        """Return org-specific and global (nation-wide) event tags visible to the given org."""
        ...

    def get_by_id(self, tag_id: int) -> EventTagData | None:
        """Return a single event tag by primary key, or None if not found."""
        ...

    def create(self, name: str, color: str, org_id: int) -> None:
        """Create a new org-specific event tag."""
        ...

    def update(self, tag_id: int, name: str, color: str) -> None:
        """Update the name and colour of an existing event tag."""
        ...

    def delete(self, tag_id: int) -> None:
        """Soft-delete an event tag."""
        ...
