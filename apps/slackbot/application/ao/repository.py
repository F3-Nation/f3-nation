from typing import Protocol

from application.ao import AoData


class AoRepository(Protocol):
    """
    Defines the data-access contract for AOs (workout locations / orgs of type "ao").

    Concrete implementations may be backed by the F3 Nation API, the legacy
    SQLAlchemy DbManager, or a test double.
    """

    def get_by_parent_org(self, parent_org_id: int) -> list[AoData]:
        """Return active AOs whose parent org is *parent_org_id*."""
        ...

    def get_by_id(self, ao_id: int) -> AoData | None:
        """Return a single AO by primary key, or None if not found."""
        ...

    def create(
        self,
        parent_id: int,
        name: str,
        description: str | None,
        slack_channel_id: str | None,
        default_location_id: int | None,
    ) -> AoData:
        """Create a new AO and return the created record."""
        ...

    def update(
        self,
        ao_id: int,
        parent_id: int,
        name: str,
        description: str | None,
        slack_channel_id: str | None,
        default_location_id: int | None,
        logo_url: str | None = None,
    ) -> None:
        """Update an existing AO (crupdate POST)."""
        ...

    def delete(self, ao_id: int) -> None:
        """Soft-delete an AO (cascades to associated events and instances)."""
        ...
