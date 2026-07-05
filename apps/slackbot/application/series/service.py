from __future__ import annotations

from application.series import SeriesData
from application.series.repository import SeriesRepository


class SeriesService:
    """
    Business logic for event series (workout recurring events).

    Cascade behaviour (instance creation/update/deletion) is handled by the
    F3 Nation API, so callers only interact with the series-level record.
    """

    def __init__(self, repository: SeriesRepository) -> None:
        self._repository: SeriesRepository = repository

    def get_region_series(
        self,
        region_id: int | str,
        ao_id: int | str | None = None,
    ) -> list[SeriesData]:
        """Return active series for a region, optionally scoped to one AO."""
        return self._repository.get_by_region(
            region_id=int(region_id),
            ao_id=int(ao_id) if ao_id is not None else None,
        )

    def get_by_id(self, series_id: int | str) -> SeriesData | None:
        """Return a single series, or *None* if not found."""
        return self._repository.get_by_id(int(series_id))

    def create_series(
        self,
        region_id: int | str,
        ao_id: int | str,
        name: str,
        start_date: str,
        start_time: str | None,
        end_time: str | None,
        day_of_week: str,
        description: str | None = None,
        location_id: int | str | None = None,
        end_date: str | None = None,
        recurrence_pattern: str | None = None,
        recurrence_interval: int | None = None,
        index_within_interval: int | None = None,
        event_type_ids: list[int] | None = None,
        event_tag_ids: list[int] | None = None,
        is_active: bool = True,
        is_private: bool = False,
        highlight: bool = False,
        meta: dict | None = None,
    ) -> SeriesData:
        """Create a new series (and trigger API-side instance generation)."""
        return self._repository.create(
            region_id=int(region_id),
            ao_id=int(ao_id),
            name=name,
            start_date=start_date,
            start_time=start_time,
            end_time=end_time,
            day_of_week=day_of_week,
            description=description,
            location_id=int(location_id) if location_id is not None else None,
            end_date=end_date,
            recurrence_pattern=recurrence_pattern,
            recurrence_interval=recurrence_interval,
            index_within_interval=index_within_interval,
            event_type_ids=event_type_ids or [],
            event_tag_ids=event_tag_ids or [],
            is_active=is_active,
            is_private=is_private,
            highlight=highlight,
            meta=meta,
        )

    def update_series(
        self,
        series_id: int | str,
        region_id: int | str,
        ao_id: int | str,
        name: str,
        start_date: str,
        start_time: str | None,
        end_time: str | None,
        description: str | None = None,
        location_id: int | str | None = None,
        end_date: str | None = None,
        event_type_ids: list[int] | None = None,
        event_tag_ids: list[int] | None = None,
        is_active: bool = True,
        is_private: bool = False,
        highlight: bool = False,
        meta: dict | None = None,
    ) -> SeriesData:
        """Update an existing series (and trigger API-side future-instance update)."""
        return self._repository.update(
            series_id=int(series_id),
            region_id=int(region_id),
            ao_id=int(ao_id),
            name=name,
            start_date=start_date,
            start_time=start_time,
            end_time=end_time,
            description=description,
            location_id=int(location_id) if location_id is not None else None,
            end_date=end_date,
            event_type_ids=event_type_ids or [],
            event_tag_ids=event_tag_ids or [],
            is_active=is_active,
            is_private=is_private,
            highlight=highlight,
            meta=meta,
        )

    def delete_series(self, series_id: int | str) -> None:
        """Soft-delete a series (and cascade-delete future instances via the API)."""
        self._repository.delete(int(series_id))
