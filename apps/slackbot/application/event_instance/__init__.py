from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import BaseModel


class EventInstanceData(BaseModel):
    id: int
    name: str | None = None
    description: str | None = None
    org_id: int  # AO org
    location_id: int | None = None
    event_type_ids: list[int] = []
    event_tag_ids: list[int] = []
    start_date: date | None = None
    start_time: str | None = None  # "HHMM" format
    end_time: str | None = None  # "HHMM" format
    is_active: bool = True
    is_private: bool = False
    meta: dict | None = None
    highlight: bool = False
    preblast_rich: Any | None = None
    preblast: str | None = None
    series_exception: str | None = None  # "closed" | "different-time" | "miscellaneous" | None
