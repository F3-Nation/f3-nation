from application.position import PositionData, PositionWithAssignmentsData
from application.position.repository import PositionRepository


class PositionService:
    """
    Business logic for positions and position assignments.

    Data access is delegated to a ``PositionRepository`` injected by the caller
    (composition root), which keeps the application layer independent of
    infrastructure details.
    """

    def __init__(self, repository: PositionRepository) -> None:
        self._repository: PositionRepository = repository

    def get_org_positions(self, org_id: int | str) -> list[PositionData]:
        """Return org-specific positions for *org_id*."""
        return self._repository.get_by_org(int(org_id))

    def get_positions_with_assignments(
        self, org_id: int | str, region_org_id: int | str
    ) -> list[PositionWithAssignmentsData]:
        """Return all positions (with assigned users) relevant to *org_id*."""
        return self._repository.get_assignments(int(org_id), int(region_org_id))

    def get_by_id(self, position_id: int) -> PositionData | None:
        """Return a single position, or *None* if not found."""
        return self._repository.get_by_id(position_id)

    def create_position(self, name: str, description: str | None, org_id: int | str, org_type: str) -> PositionData:
        """Create a new org-specific position."""
        return self._repository.create(name, description, int(org_id), org_type)

    def update_position(self, position_id: int, name: str, description: str | None) -> None:
        """Update the name and description of an existing position."""
        self._repository.update(position_id, name, description)

    def delete_position(self, position_id: int) -> None:
        """Soft-delete a position."""
        self._repository.delete(position_id)

    def update_org_assignments(self, org_id: int | str, assignments: list[dict]) -> None:
        """Replace all position assignments for *org_id*.

        *assignments* is a list of ``{"positionId": int, "userIds": [int, ...]}``.
        """
        self._repository.update_all_assignments(int(org_id), assignments)
