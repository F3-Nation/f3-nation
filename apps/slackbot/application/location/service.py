from application.location import LocationData
from application.location.repository import LocationRepository


class LocationService:
    """
    Business logic for locations.

    Data access is delegated to a ``LocationRepository`` injected by the
    caller (composition root), keeping the application layer independent of
    infrastructure details.
    """

    def __init__(self, repository: LocationRepository) -> None:
        self._repository: LocationRepository = repository

    def get_org_locations(self, org_id: int | str) -> list[LocationData]:
        """Return active locations for *org_id*."""
        locations = self._repository.get_by_org(int(org_id))
        return [loc for loc in locations if loc.is_active]

    def get_location_by_id(self, location_id: int) -> LocationData | None:
        """Return a single location, or *None* if not found."""
        return self._repository.get_by_id(location_id)

    def create_location(
        self,
        name: str,
        org_id: int | str,
        description: str | None = None,
        latitude: float | None = None,
        longitude: float | None = None,
        address_street: str | None = None,
        address_street2: str | None = None,
        address_city: str | None = None,
        address_state: str | None = None,
        address_zip: str | None = None,
        address_country: str | None = None,
    ) -> LocationData:
        """Create a new location and return the created record."""
        return self._repository.create(
            name=name,
            org_id=int(org_id),
            description=description,
            latitude=latitude,
            longitude=longitude,
            address_street=address_street,
            address_street2=address_street2,
            address_city=address_city,
            address_state=address_state,
            address_zip=address_zip,
            address_country=address_country,
        )

    def update_location(
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
        self._repository.update(
            location_id=location_id,
            name=name,
            org_id=int(org_id),
            is_active=is_active,
            description=description,
            latitude=latitude,
            longitude=longitude,
            address_street=address_street,
            address_street2=address_street2,
            address_city=address_city,
            address_state=address_state,
            address_zip=address_zip,
            address_country=address_country,
        )

    def delete_location(self, location_id: int) -> None:
        """Soft-delete a location."""
        self._repository.delete(location_id)
