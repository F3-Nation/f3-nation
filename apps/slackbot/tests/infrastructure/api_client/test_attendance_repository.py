import os
import sys
import unittest
from unittest.mock import MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

from infrastructure.api_client.attendance_repository import ApiAttendanceRepository


class ApiAttendanceRepositoryTest(unittest.TestCase):
    def setUp(self):
        self.client = MagicMock()
        self.repo = ApiAttendanceRepository(self.client)

    def test_get_planned_for_event_instance_calls_endpoint(self):
        self.client.get.return_value = {
            "attendance": [
                {
                    "id": 1,
                    "eventInstanceId": 10,
                    "userId": 20,
                    "user": {"id": 20, "f3Name": "Dredd"},
                    "isPlanned": True,
                    "attendanceTypes": [{"id": 2}],
                }
            ]
        }
        result = self.repo.get_planned_for_event_instance(10)
        self.client.get.assert_called_once_with("/v1/attendance/event-instance/10", params={"isPlanned": True})
        self.assertEqual(result[0].attendance_type_ids, [2])
        self.assertEqual(result[0].f3_name, "Dredd")

    def test_add_hc_preserves_existing_q_and_co_q(self):
        self.client.get.return_value = {
            "attendances": [
                {
                    "id": 1,
                    "eventInstanceId": 10,
                    "userId": 20,
                    "isPlanned": True,
                    "attendanceTypes": [{"id": 2}, {"id": 3}],
                }
            ]
        }
        self.client.patch.return_value = {
            "attendance": {
                "id": 1,
                "eventInstanceId": 10,
                "userId": 20,
                "isPlanned": True,
                "attendanceTypes": [{"id": 1}, {"id": 2}, {"id": 3}],
            }
        }
        self.repo.add_hc(10, 20)
        self.client.post.assert_not_called()
        self.client.patch.assert_called_once_with("/v1/attendance/1/types", json={"attendanceTypeIds": [1, 2, 3]})

    def test_add_hc_handles_success_only_patch_response(self):
        self.client.get.return_value = {
            "attendances": [
                {
                    "id": 1,
                    "eventInstanceId": 10,
                    "userId": 20,
                    "isPlanned": True,
                    "attendanceTypes": [{"id": 2}],
                }
            ]
        }
        self.client.patch.return_value = {"success": True}
        result = self.repo.add_hc(10, 20)
        self.assertEqual(result.attendance_type_ids, [1, 2])
        self.assertEqual(result.id, 1)

    def test_add_hc_creates_when_no_existing_attendance(self):
        self.client.get.return_value = {"attendances": []}
        self.client.post.return_value = {
            "attendance": {"id": 2, "eventInstanceId": 10, "userId": 20, "attendanceTypes": [{"id": 1}]}
        }
        self.repo.add_hc(10, 20)
        self.client.post.assert_called_once_with(
            "/v1/attendance",
            json={"eventInstanceId": 10, "userId": 20, "attendanceTypeIds": [1]},
        )

    def test_remove_hc_preserves_q_and_co_q(self):
        self.client.get.return_value = {
            "attendances": [
                {
                    "id": 1,
                    "eventInstanceId": 10,
                    "userId": 20,
                    "isPlanned": True,
                    "attendanceTypes": [{"id": 1}, {"id": 2}, {"id": 3}],
                }
            ]
        }
        self.client.patch.return_value = {
            "attendance": {
                "id": 1,
                "eventInstanceId": 10,
                "userId": 20,
                "isPlanned": True,
                "attendanceTypes": [{"id": 2}, {"id": 3}],
            }
        }
        self.repo.remove_hc(10, 20)
        self.client.patch.assert_called_once_with("/v1/attendance/1/types", json={"attendanceTypeIds": [2, 3]})

    def test_remove_hc_deletes_attendance_when_no_types_remain(self):
        self.client.get.return_value = {
            "attendance": [
                {
                    "id": 1,
                    "eventInstanceId": 10,
                    "userId": 20,
                    "isPlanned": True,
                    "attendanceTypes": [{"id": 1}],
                }
            ]
        }
        result = self.repo.remove_hc(10, 20)
        self.assertIsNone(result)
        self.client.patch.assert_not_called()
        self.client.delete.assert_called_once_with("/v1/attendance/event-instance/10/user/20")

    def test_q_endpoint_payloads(self):
        self.client.post.return_value = {"success": True, "attendanceId": 1}
        self.repo.take_q(10, 20)
        self.client.post.assert_called_with("/v1/attendance/take-q", json={"eventInstanceId": 10, "userId": 20})
        self.repo.assign_qs(10, 20, [30, 40])
        self.client.put.assert_called_with(
            "/v1/attendance/assign-q",
            json={"eventInstanceId": 10, "qUserId": 20, "coQUserIds": [30, 40]},
        )

    def test_assign_qs_omits_null_q_user_id(self):
        self.repo.assign_qs(10, None, [30])
        self.client.put.assert_called_once_with(
            "/v1/attendance/assign-q",
            json={"eventInstanceId": 10, "coQUserIds": [30]},
        )

    def test_remove_q_returns_none_for_success_only_response(self):
        self.client.delete.return_value = {"success": True}
        result = self.repo.remove_q(10, 20)
        self.assertIsNone(result)
        self.client.delete.assert_called_once_with(
            "/v1/attendance/remove-q",
            json={"eventInstanceId": 10, "userId": 20},
        )


if __name__ == "__main__":
    unittest.main()
