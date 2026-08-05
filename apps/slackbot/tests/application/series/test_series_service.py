import os
import sys
import unittest
from unittest.mock import MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

from application.series import SeriesData
from application.series.service import SeriesService


def _make_series(
    id: int = 1,
    name: str = "Test Series",
    org_id: int = 10,
    region_id: int = 5,
    start_date: str = "2025-01-06",
    day_of_week: str = "monday",
    event_type_ids: list = None,
) -> SeriesData:
    return SeriesData(
        id=id,
        name=name,
        org_id=org_id,
        region_id=region_id,
        start_date=start_date,
        day_of_week=day_of_week,
        start_time="0530",
        end_time="0615",
        event_type_ids=event_type_ids or [],
    )


class SeriesServiceTest(unittest.TestCase):
    def _mock_repo(self):
        return MagicMock()

    # ------------------------------------------------------------------
    # get_region_series
    # ------------------------------------------------------------------

    def test_get_region_series_no_ao_filter(self):
        repo = self._mock_repo()
        repo.get_by_region.return_value = [_make_series(id=1), _make_series(id=2)]

        service = SeriesService(repository=repo)
        result = service.get_region_series("5")

        repo.get_by_region.assert_called_once_with(region_id=5, ao_id=None)
        self.assertEqual(len(result), 2)

    def test_get_region_series_with_ao_filter(self):
        repo = self._mock_repo()
        repo.get_by_region.return_value = [_make_series(id=3)]

        service = SeriesService(repository=repo)
        result = service.get_region_series(5, ao_id="10")

        repo.get_by_region.assert_called_once_with(region_id=5, ao_id=10)
        self.assertEqual(result[0].id, 3)

    def test_get_region_series_coerces_str_ids(self):
        repo = self._mock_repo()
        repo.get_by_region.return_value = []
        service = SeriesService(repository=repo)
        service.get_region_series("42")
        repo.get_by_region.assert_called_once_with(region_id=42, ao_id=None)

    # ------------------------------------------------------------------
    # get_by_id
    # ------------------------------------------------------------------

    def test_get_by_id_returns_series(self):
        repo = self._mock_repo()
        repo.get_by_id.return_value = _make_series(id=7)

        service = SeriesService(repository=repo)
        result = service.get_by_id("7")

        repo.get_by_id.assert_called_once_with(7)
        self.assertIsNotNone(result)
        self.assertEqual(result.id, 7)

    def test_get_by_id_returns_none_when_not_found(self):
        repo = self._mock_repo()
        repo.get_by_id.return_value = None

        service = SeriesService(repository=repo)
        result = service.get_by_id(999)
        self.assertIsNone(result)

    # ------------------------------------------------------------------
    # create_series
    # ------------------------------------------------------------------

    def test_create_series_delegates_to_repo(self):
        repo = self._mock_repo()
        repo.create.return_value = _make_series(id=99)

        service = SeriesService(repository=repo)
        result = service.create_series(
            region_id="5",
            ao_id="10",
            name="New Series",
            start_date="2025-01-06",
            start_time="0530",
            end_time="0615",
            day_of_week="monday",
        )

        repo.create.assert_called_once()
        call_kwargs = repo.create.call_args.kwargs
        self.assertEqual(call_kwargs["region_id"], 5)
        self.assertEqual(call_kwargs["ao_id"], 10)
        self.assertEqual(call_kwargs["name"], "New Series")
        self.assertEqual(call_kwargs["day_of_week"], "monday")
        self.assertEqual(result.id, 99)

    def test_create_series_coerces_location_id(self):
        repo = self._mock_repo()
        repo.create.return_value = _make_series()

        service = SeriesService(repository=repo)
        service.create_series(
            region_id=5,
            ao_id=10,
            name="Test",
            start_date="2025-01-06",
            start_time="0530",
            end_time="0615",
            day_of_week="monday",
            location_id="42",
        )
        call_kwargs = repo.create.call_args.kwargs
        self.assertEqual(call_kwargs["location_id"], 42)

    def test_create_series_none_location_id_stays_none(self):
        repo = self._mock_repo()
        repo.create.return_value = _make_series()

        service = SeriesService(repository=repo)
        service.create_series(
            region_id=5,
            ao_id=10,
            name="Test",
            start_date="2025-01-06",
            start_time="0530",
            end_time="0615",
            day_of_week="monday",
            location_id=None,
        )
        call_kwargs = repo.create.call_args.kwargs
        self.assertIsNone(call_kwargs["location_id"])

    # ------------------------------------------------------------------
    # update_series
    # ------------------------------------------------------------------

    def test_update_series_delegates_to_repo(self):
        repo = self._mock_repo()
        repo.update.return_value = _make_series(id=1)

        service = SeriesService(repository=repo)
        service.update_series(
            series_id="1",
            region_id="5",
            ao_id="10",
            name="Updated",
            start_date="2025-01-06",
            start_time="0600",
            end_time="0645",
        )

        call_kwargs = repo.update.call_args.kwargs
        self.assertEqual(call_kwargs["series_id"], 1)
        self.assertEqual(call_kwargs["region_id"], 5)
        self.assertEqual(call_kwargs["ao_id"], 10)
        self.assertEqual(call_kwargs["name"], "Updated")

    # ------------------------------------------------------------------
    # delete_series
    # ------------------------------------------------------------------

    def test_delete_series_delegates_to_repo(self):
        repo = self._mock_repo()
        service = SeriesService(repository=repo)
        service.delete_series("7")
        repo.delete.assert_called_once_with(7)

    def test_delete_series_coerces_str_id(self):
        repo = self._mock_repo()
        service = SeriesService(repository=repo)
        service.delete_series("42")
        repo.delete.assert_called_once_with(42)


if __name__ == "__main__":
    unittest.main()
