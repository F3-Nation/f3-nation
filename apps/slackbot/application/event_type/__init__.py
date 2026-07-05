from pydantic import BaseModel


class EventTypeData(BaseModel):
    id: int
    name: str
    acronym: str | None = None
    event_category: str | None = None  # "first_f" | "second_f" | "third_f"
    specific_org_id: int | None = None
    is_active: bool = True
