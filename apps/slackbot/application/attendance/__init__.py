from __future__ import annotations

from pydantic import BaseModel


HC_TYPE_ID = 1
Q_TYPE_ID = 2
CO_Q_TYPE_ID = 3


class AttendanceData(BaseModel):
    id: int
    event_instance_id: int
    user_id: int
    is_planned: bool = True
    attendance_type_ids: list[int] = []
    meta: dict | None = None
