from pydantic import BaseModel


class AoData(BaseModel):
    id: int
    name: str
    parent_id: int | None = None
    org_type: str = "ao"
    description: str | None = None
    is_active: bool = True
    default_location_id: int | None = None
    logo_url: str | None = None
    meta: dict | None = None
    phone: str | None = None
