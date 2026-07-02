from application.ao import AoData
from application.ao.repository import AoRepository


class AoService:
    """
    Business logic for AOs (workout orgs of type "ao").

    Data access is delegated to an ``AoRepository`` injected by the caller
    (composition root), keeping the application layer independent of
    infrastructure details.
    """

    def __init__(self, repository: AoRepository) -> None:
        self._repository: AoRepository = repository

    def get_region_aos(self, parent_org_id: int | str) -> list[AoData]:
        """Return active AOs for the given parent org (region)."""
        return self._repository.get_by_parent_org(int(parent_org_id))

    def get_ao_by_id(self, ao_id: int) -> AoData | None:
        """Return a single AO by ID, or *None* if not found."""
        return self._repository.get_by_id(ao_id)

    def create_ao(
        self,
        parent_id: int | str,
        name: str,
        description: str | None,
        slack_channel_id: str | None,
        default_location_id: int | str | None,
    ) -> AoData:
        """Create a new AO and return the created record."""
        return self._repository.create(
            parent_id=int(parent_id),
            name=name,
            description=description,
            slack_channel_id=slack_channel_id,
            default_location_id=int(default_location_id) if default_location_id is not None else None,
        )

    def update_ao(
        self,
        ao_id: int,
        parent_id: int | str,
        name: str,
        description: str | None,
        slack_channel_id: str | None,
        default_location_id: int | str | None,
        logo_url: str | None = None,
    ) -> None:
        """Update an existing AO."""
        self._repository.update(
            ao_id=ao_id,
            parent_id=int(parent_id),
            name=name,
            description=description,
            slack_channel_id=slack_channel_id,
            default_location_id=int(default_location_id) if default_location_id is not None else None,
            logo_url=logo_url,
        )

    def delete_ao(self, ao_id: int) -> None:
        """Soft-delete an AO and cascade to associated events/instances."""
        self._repository.delete(ao_id)
