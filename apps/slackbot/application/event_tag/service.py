from application.event_tag import EventTagData
from application.event_tag.repository import EventTagRepository


class EventTagService:
    """
    Business logic for event tags.

    Data access is delegated to an ``EventTagRepository`` and is injected by the
    caller (composition root), which keeps the application layer independent of
    infrastructure details.
    """

    def __init__(self, repository: EventTagRepository) -> None:
        self._repository: EventTagRepository = repository

    def get_org_event_tags(self, org_id: int | str) -> list[EventTagData]:
        """Return org-specific event tags for *org_id*."""
        return self._repository.get_by_org(int(org_id))

    def get_all_tags_for_org(self, org_id: int | str) -> list[EventTagData]:
        """Return org-specific and global (nation-wide) event tags visible to *org_id*."""
        return self._repository.get_all_for_org(int(org_id))

    def get_event_tag_by_id(self, tag_id: int) -> EventTagData | None:
        """Return a single event tag, or *None* if not found."""
        return self._repository.get_by_id(tag_id)

    def create_org_specific_tag(self, name: str, color: str, org_id: int | str) -> None:
        """Create a new org-specific event tag."""
        self._repository.create(name, color, int(org_id))

    def update_org_specific_tag(self, tag_id: int, name: str, color: str) -> None:
        """Update the name and colour of an existing event tag."""
        self._repository.update(tag_id, name, color)

    def delete_org_specific_tag(self, tag_id: int) -> None:
        """Soft-delete an event tag."""
        self._repository.delete(tag_id)
