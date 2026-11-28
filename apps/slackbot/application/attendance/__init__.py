from __future__ import annotations

from f3_data_models.models import Attendance_Type
from pydantic import BaseModel


class AttendanceData(BaseModel):
    id: int
    event_instance_id: int
    user_id: int
    f3_name: str | None = None
    is_planned: bool = True
    attendance_type: Attendance_Type = Attendance_Type.pax
    meta: dict | None = None
