from __future__ import annotations

from application.attendance import AttendanceData
from application.attendance.repository import AttendanceRepository


class AttendanceService:
    def __init__(self, repository: AttendanceRepository) -> None:
        self._repository = repository

    def get_planned_for_event_instance(self, event_instance_id: int | str) -> list[AttendanceData]:
        return self._repository.get_planned_for_event_instance(int(event_instance_id))

    def add_hc(self, event_instance_id: int | str, user_id: int | str) -> AttendanceData:
        return self._repository.add_hc(int(event_instance_id), int(user_id))

    def remove_hc(self, event_instance_id: int | str, user_id: int | str) -> AttendanceData | None:
        return self._repository.remove_hc(int(event_instance_id), int(user_id))

    def take_q(self, event_instance_id: int | str, user_id: int | str) -> AttendanceData:
        return self._repository.take_q(int(event_instance_id), int(user_id))

    def remove_q(self, event_instance_id: int | str, user_id: int | str) -> AttendanceData | None:
        return self._repository.remove_q(int(event_instance_id), int(user_id))

    def assign_qs(
        self,
        event_instance_id: int | str,
        q_user_id: int | str | None,
        co_q_user_ids: list[int | str],
    ) -> None:
        self._repository.assign_qs(
            int(event_instance_id),
            int(q_user_id) if q_user_id is not None else None,
            [int(user_id) for user_id in co_q_user_ids],
        )
