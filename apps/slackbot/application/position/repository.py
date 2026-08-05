from typing import Protocol

from application.position import PositionData, PositionWithAssignmentsData


class PositionRepository(Protocol):
    """
    Defines the data-access contract for positions and position assignments.

    Concrete implementations may be backed by the F3 Nation API, the legacy
    SQLAlchemy DbManager, or a test double.
    """

    def get_by_org(self, org_id: int) -> list[PositionData]:
        """Return org-specific (non-global) positions for the given org."""
        ...

    def get_assignments(self, org_id: int, region_org_id: int) -> list[PositionWithAssignmentsData]:
        """Return all positions (with their assigned users) relevant to *org_id*.

        *region_org_id* is always the parent region ID and is used to determine
        which position tier (region vs AO) to include.
        """
        ...

    def get_by_id(self, position_id: int) -> PositionData | None:
        """Return a single position by primary key, or None if not found."""
        ...

    def create(self, name: str, description: str | None, org_id: int, org_type: str) -> PositionData:
        """Create a new org-specific position."""
        ...

    def update(self, position_id: int, name: str, description: str | None) -> None:
        """Update the name and description of an existing position."""
        ...

    def delete(self, position_id: int) -> None:
        """Soft-delete a position by marking it as inactive."""
        ...

    def update_all_assignments(self, org_id: int, assignments: list[dict]) -> None:
        """Replace all position assignments for *org_id* with the given list.

        *assignments* is a list of ``{"positionId": int, "userIds": [int, ...]}``.
        """
        ...
