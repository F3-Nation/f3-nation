from __future__ import annotations

from f3_data_models.models import Attendance_Type

from application.attendance import AttendanceData
from infrastructure.api_client.client import F3ApiClient, get_f3_api_client

# Highest first: a record linked to several types reads as the first of these it has.
_TYPE_PRECEDENCE = (Attendance_Type.q, Attendance_Type.co_q, Attendance_Type.pax)


def _parse_attendance_type(raw: dict) -> Attendance_Type:
    named = raw.get("attendanceType")
    if named is not None:
        return Attendance_Type[named]
    # An API that predates the `attendanceType` field sends only the linked type ids.
    types_raw = raw.get("attendanceTypes") or []
    linked_ids = {int(t["id"]) if isinstance(t, dict) else int(t) for t in types_raw if t is not None}
    return next((t for t in _TYPE_PRECEDENCE if t.value in linked_ids), Attendance_Type.pax)


def _type_ids(*attendance_types: Attendance_Type) -> list[int]:
    """Type ids for the attendance write endpoints, which still take ids until they accept a named type."""
    return sorted({t.value for t in attendance_types})


def _parse_attendance(raw: dict) -> AttendanceData:
    user_raw = raw.get("user") or {}
    return AttendanceData(
        id=int(raw["id"]),
        event_instance_id=int(raw["eventInstanceId"]),
        user_id=int(raw["userId"]),
        f3_name=raw.get("f3Name", raw.get("f3_name", user_raw.get("f3Name", user_raw.get("f3_name")))),
        is_planned=raw.get("isPlanned", raw.get("is_planned", True)),
        attendance_type=_parse_attendance_type(raw),
        meta=raw.get("meta"),
    )


class ApiAttendanceRepository:
    def __init__(self, client: F3ApiClient) -> None:
        self._client = client

    def get_planned_for_event_instance(self, event_instance_id: int) -> list[AttendanceData]:
        result = self._client.get(
            f"/v1/attendance/event-instance/{event_instance_id}",
            params={"isPlanned": "true"},
        )
        raw_list = result.get("attendance") or result.get("attendances") or result.get("results") or []
        return [_parse_attendance(raw) for raw in raw_list]

    def _find_planned(self, event_instance_id: int, user_id: int) -> AttendanceData | None:
        return next((a for a in self.get_planned_for_event_instance(event_instance_id) if a.user_id == user_id), None)

    def _update_types(self, attendance: AttendanceData, type_ids: list[int]) -> AttendanceData:
        """Writes the record's type links. Adding or removing PAX never changes which type the record reads as."""
        result = self._client.patch(
            f"/v1/attendance/{attendance.id}/types",
            json={"attendanceTypeIds": type_ids},
        )
        raw = (result or {}).get("attendance") or (result or {}).get("result")
        return _parse_attendance(raw) if raw else attendance.model_copy()

    def _create_planned(self, event_instance_id: int, user_id: int) -> AttendanceData:
        result = self._client.post(
            "/v1/attendance",
            json={
                "eventInstanceId": event_instance_id,
                "userId": user_id,
                "attendanceTypeIds": _type_ids(Attendance_Type.pax),
            },
        )
        raw = result.get("attendance") or result.get("result")
        if raw:
            return _parse_attendance(raw)
        return AttendanceData(
            id=int(result["attendanceId"]),
            event_instance_id=event_instance_id,
            user_id=user_id,
            is_planned=True,
            attendance_type=Attendance_Type.pax,
        )

    def add_hc(self, event_instance_id: int, user_id: int) -> AttendanceData:
        existing = self._find_planned(event_instance_id, user_id)
        if existing is None:
            return self._create_planned(event_instance_id, user_id)
        return self._update_types(existing, _type_ids(Attendance_Type.pax, existing.attendance_type))

    def remove_hc(self, event_instance_id: int, user_id: int) -> AttendanceData | None:
        existing = self._find_planned(event_instance_id, user_id)
        if existing is None:
            return None
        if existing.attendance_type == Attendance_Type.pax:
            self._client.delete(f"/v1/attendance/event-instance/{event_instance_id}/user/{user_id}")
            return None
        return self._update_types(existing, _type_ids(existing.attendance_type))

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
            attendance_type=Attendance_Type.q,
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
