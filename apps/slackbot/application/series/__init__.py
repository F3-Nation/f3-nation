from __future__ import annotations

from pydantic import BaseModel


class SeriesData(BaseModel):
    id: int
    name: str = ""
    description: str | None = None
    is_active: bool = True
    is_private: bool = False
    highlight: bool = False
    location_id: int | None = None
    org_id: int = 0  # AO org ID
    region_id: int | None = None
    start_date: str | None = None  # "YYYY-MM-DD"
    end_date: str | None = None  # "YYYY-MM-DD"
    start_time: str | None = None  # "HHMM" format
    end_time: str | None = None  # "HHMM" format
    day_of_week: str | None = None  # lowercase: "monday" … "sunday"
    recurrence_pattern: str | None = None  # "weekly" | "monthly"
    recurrence_interval: int | None = None
    index_within_interval: int | None = None
    meta: dict | None = None
    event_type_ids: list[int] = []
    # NOTE: the F3 Nation API does not return event_tag_ids for events.
    # This field will always be empty when fetched from the API; it is included
    # here for forward-compatibility and test doubles.
    event_tag_ids: list[int] = []
