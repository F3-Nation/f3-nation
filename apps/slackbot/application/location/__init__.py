from pydantic import BaseModel


class LocationData(BaseModel):
    id: int
    name: str
    description: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    address_street: str | None = None
    address_street2: str | None = None
    address_city: str | None = None
    address_state: str | None = None
    address_zip: str | None = None
    address_country: str | None = None
    is_active: bool = True
    org_id: int | None = None
