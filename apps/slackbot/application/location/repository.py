from typing import Protocol

from application.location import LocationData


class LocationRepository(Protocol):
    """
    Defines the data-access contract for locations.

    Concrete implementations may be backed by the F3 Nation API, the legacy
    SQLAlchemy DbManager, or a test double.
    """

    def get_by_org(self, org_id: int) -> list[LocationData]:
        """Return active locations belonging to *org_id*."""
        ...

    def get_by_id(self, location_id: int) -> LocationData | None:
        """Return a single location by primary key, or None if not found."""
        ...

    def create(
        self,
        name: str,
        org_id: int,
        description: str | None,
        latitude: float | None,
        longitude: float | None,
        address_street: str | None,
        address_street2: str | None,
        address_city: str | None,
        address_state: str | None,
        address_zip: str | None,
        address_country: str | None,
    ) -> LocationData:
        """Create a new location and return it."""
        ...

    def update(
        self,
        location_id: int,
        name: str,
        org_id: int,
        is_active: bool = True,
        description: str | None = None,
        latitude: float | None = None,
        longitude: float | None = None,
        address_street: str | None = None,
        address_street2: str | None = None,
        address_city: str | None = None,
        address_state: str | None = None,
        address_zip: str | None = None,
        address_country: str | None = None,
    ) -> None:
        """Update an existing location."""
        ...

    def delete(self, location_id: int) -> None:
        """Soft-delete a location."""
        ...
