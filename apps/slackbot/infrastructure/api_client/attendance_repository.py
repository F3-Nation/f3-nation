from __future__ import annotations

from application.attendance import HC_TYPE_ID, Q_TYPE_ID, AttendanceData
from infrastructure.api_client.client import F3ApiClient, get_f3_api_client


def _parse_attendance(raw: dict) -> AttendanceData:
    types_raw = raw.get("attendanceTypes", raw.get("attendance_types", raw.get("attendance_type_ids", [])))
    user_raw = raw.get("user") or {}
    if types_raw and isinstance(types_raw[0], dict):
        type_ids = [int(t.get("id", t.get("attendanceTypeId", 0))) for t in types_raw]
    else:
        type_ids = [int(t) for t in types_raw if t is not None]
    return AttendanceData(
        id=int(raw["id"]),
        event_instance_id=int(raw.get("eventInstanceId", raw.get("event_instance_id", 0))),
        user_id=int(raw.get("userId", raw.get("user_id", 0))),
        f3_name=raw.get("f3Name", raw.get("f3_name", user_raw.get("f3Name", user_raw.get("f3_name")))),
        is_planned=raw.get("isPlanned", raw.get("is_planned", True)),
        attendance_type_ids=type_ids,
        meta=raw.get("meta"),
    )


class ApiAttendanceRepository:
    def __init__(self, client: F3ApiClient) -> None:
        self._client = client

    def get_planned_for_event_instance(self, event_instance_id: int) -> list[AttendanceData]:
        result = self._client.get(
            f"/v1/attendance/event-instance/{event_instance_id}",
            params={"isPlanned": True},
        )
        raw_list = result.get("attendance") or result.get("attendances") or result.get("results") or []
        return [_parse_attendance(raw) for raw in raw_list]

    def _find_planned(self, event_instance_id: int, user_id: int) -> AttendanceData | None:
        return next((a for a in self.get_planned_for_event_instance(event_instance_id) if a.user_id == user_id), None)

    def _update_types(self, attendance: AttendanceData, type_ids: list[int]) -> AttendanceData:
        result = self._client.patch(
            f"/v1/attendance/{attendance.id}/types",
            json={"attendanceTypeIds": type_ids},
        )
        if result and result.get("success") and not (result.get("attendance") or result.get("result")):
            return AttendanceData(
                id=attendance.id,
                event_instance_id=attendance.event_instance_id,
                user_id=attendance.user_id,
                is_planned=attendance.is_planned,
                attendance_type_ids=type_ids,
                meta=attendance.meta,
            )
        raw = result.get("attendance") or result.get("result") or {
            **attendance.model_dump(),
            "attendance_type_ids": type_ids,
        }
        return _parse_attendance(raw)

    def _create_planned(self, event_instance_id: int, user_id: int, type_ids: list[int]) -> AttendanceData:
        result = self._client.post(
            "/v1/attendance",
            json={"eventInstanceId": event_instance_id, "userId": user_id, "attendanceTypeIds": type_ids},
        )
        raw = result.get("attendance") or result.get("result")
        if raw:
            return _parse_attendance(raw)
        return AttendanceData(
            id=int(result["attendanceId"]),
            event_instance_id=event_instance_id,
            user_id=user_id,
            is_planned=True,
            attendance_type_ids=type_ids,
        )

    def add_hc(self, event_instance_id: int, user_id: int) -> AttendanceData:
        existing = self._find_planned(event_instance_id, user_id)
        if existing is None:
            return self._create_planned(event_instance_id, user_id, [HC_TYPE_ID])
        type_ids = sorted({*existing.attendance_type_ids, HC_TYPE_ID})
        return self._update_types(existing, type_ids)

    def remove_hc(self, event_instance_id: int, user_id: int) -> AttendanceData | None:
        existing = self._find_planned(event_instance_id, user_id)
        if existing is None:
            return None
        type_ids = [type_id for type_id in existing.attendance_type_ids if type_id != HC_TYPE_ID]
        if not type_ids:
            self._client.delete(f"/v1/attendance/event-instance/{event_instance_id}/user/{user_id}")
            return None
        return self._update_types(existing, type_ids)

    def take_q(self, event_instance_id: int, user_id: int) -> AttendanceData:
        result = self._client.post(
            "/v1/attendance/take-q",
            json={"eventInstanceId": event_instance_id, "userId": user_id},
        )
        raw = result.get("attendance") or result.get("result")
        if raw:
            return _parse_attendance(raw)
        return AttendanceData(
            id=int(result["attendanceId"]),
            event_instance_id=event_instance_id,
            user_id=user_id,
            is_planned=True,
            attendance_type_ids=[Q_TYPE_ID, HC_TYPE_ID],
        )

    def remove_q(self, event_instance_id: int, user_id: int) -> AttendanceData | None:
        result = self._client.delete(
            "/v1/attendance/remove-q",
            json={"eventInstanceId": event_instance_id, "userId": user_id},
        )
        if not result:
            return None
        if result.get("success") and not (result.get("attendance") or result.get("result")):
            return None
        return _parse_attendance(result.get("attendance") or result.get("result") or result)

    def assign_qs(self, event_instance_id: int, q_user_id: int | None, co_q_user_ids: list[int]) -> None:
        payload = {"eventInstanceId": event_instance_id, "coQUserIds": co_q_user_ids}
        if q_user_id is not None:
            payload["qUserId"] = q_user_id

        self._client.put(
            "/v1/attendance/assign-q",
            json=payload,
        )


_repo: ApiAttendanceRepository | None = None


def get_api_attendance_repository() -> ApiAttendanceRepository:
    global _repo
    if _repo is None:
        _repo = ApiAttendanceRepository(get_f3_api_client())
    return _repo
