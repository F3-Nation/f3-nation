"""Versioned, explicit Parquet schemas for approved analytics materializations."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from types import MappingProxyType
from typing import Protocol, Sequence


class ColumnLike(Protocol):
    @property
    def name(self) -> str: ...

    @property
    def duckdb_type(self) -> str: ...

    @property
    def nullable(self) -> bool: ...


def manifest_columns(columns: Sequence[ColumnLike]) -> list[dict[str, str | bool]]:
    """Return ordered manifest column records, preserving projection order."""
    return [{"name": column.name, "logicalType": column.duckdb_type, "nullable": column.nullable} for column in columns]


def schema_fingerprint(columns: Sequence[ColumnLike]) -> str:
    """Hash the canonical UTF-8 JSON form of the ordered manifest columns."""
    canonical = json.dumps(
        manifest_columns(columns),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


@dataclass(frozen=True, slots=True)
class ExpectedColumn:
    name: str
    duckdb_type: str
    nullable: bool = True


@dataclass(frozen=True, slots=True)
class ExpectedSchema:
    dataset: str
    schema_version: str
    columns: tuple[ExpectedColumn, ...]


def _columns(*columns: tuple[str, str]) -> tuple[ExpectedColumn, ...]:
    # SQL SELECT results and Parquet readback have no reliable NOT NULL contract;
    # nullable=True is the conservative physical nullability expectation.
    return tuple(ExpectedColumn(name, duckdb_type, True) for name, duckdb_type in columns)


_SCHEMAS = (
    ExpectedSchema(
        "pv_regions",
        "pv_regions.v1",
        _columns(
            ("region_id", "INTEGER"),
            ("region_name", "VARCHAR"),
            ("area_id", "INTEGER"),
            ("area_name", "VARCHAR"),
            ("logo_url", "VARCHAR"),
            ("is_active", "BOOLEAN"),
            ("aos", "STRUCT(ao_org_id INTEGER, ao_name VARCHAR)[]"),
            ("types", "STRUCT(type_id INTEGER, type_name VARCHAR)[]"),
            ("tags", "STRUCT(tag_id INTEGER, tag_name VARCHAR)[]"),
            ("refreshed_at", "TIMESTAMP WITH TIME ZONE"),
        ),
    ),
    ExpectedSchema(
        "pv_pax",
        "pv_pax.v2",
        _columns(
            ("refreshed_at", "TIMESTAMP WITH TIME ZONE"),
            ("user_id", "INTEGER"),
            ("f3_name", "VARCHAR"),
            ("home_region_id", "INTEGER"),
            ("home_region_name", "VARCHAR"),
            ("avatar_url", "VARCHAR"),
            ("email", "VARCHAR"),
            ("status", "VARCHAR"),
            ("start_date_override", "VARCHAR"),
            ("regions", "STRUCT(region_org_id INTEGER, region_name VARCHAR)[]"),
            ("aos", "STRUCT(ao_org_id INTEGER, ao_name VARCHAR)[]"),
            ("types", "STRUCT(type_id INTEGER, type_name VARCHAR)[]"),
            ("tags", "STRUCT(tag_id INTEGER, tag_name VARCHAR)[]"),
            (
                "roles",
                "STRUCT(role_id INTEGER, role_name VARCHAR, org_id INTEGER, org_name VARCHAR, org_type VARCHAR)[]",
            ),
        ),
    ),
    ExpectedSchema(
        "pv_kotter",
        "pv_kotter.v1",
        _columns(
            ("user_id", "INTEGER"),
            ("home_region_id", "INTEGER"),
            ("f3_name", "VARCHAR"),
            ("avatar_url", "VARCHAR"),
            ("kotter_status", "VARCHAR"),
            ("total_events", "INTEGER"),
            ("first_event_date", "VARCHAR"),
            ("days_since_last_event", "INTEGER"),
            ("last_event_date", "VARCHAR"),
            ("last_event_name", "VARCHAR"),
            ("last_event_ao_name", "VARCHAR"),
            ("last_event_ao_org_id", "INTEGER"),
            (
                "bestie_list",
                "STRUCT(user_id INTEGER, f3_name VARCHAR, avatar_url VARCHAR, co_attendance_count INTEGER)[]",
            ),
        ),
    ),
    ExpectedSchema(
        "pv_upcoming",
        "pv_upcoming.v1",
        _columns(
            ("refreshed_at", "TIMESTAMP WITH TIME ZONE"),
            ("start_date", "DATE"),
            ("start_time", "VARCHAR"),
            ("ao_name", "VARCHAR"),
            ("ao_org_id", "INTEGER"),
            ("region_org_id", "INTEGER"),
            ("location_name", "VARCHAR"),
            ("event_name", "VARCHAR"),
            ("event_type", "VARCHAR"),
            ("event_category", "VARCHAR"),
            ("q_list", "STRUCT(user_id INTEGER, f3_name VARCHAR, avatar_url VARCHAR)[]"),
        ),
    ),
    ExpectedSchema(
        "pv_sectors",
        "pv_sectors.v2",
        _columns(
            ("sector_id", "INTEGER"),
            ("sector_name", "VARCHAR"),
            ("logo_url", "VARCHAR"),
            ("is_active", "BOOLEAN"),
            (
                "territories",
                "STRUCT(territory_id INTEGER, territory_name VARCHAR, logo_url VARCHAR, is_active BOOLEAN)[]",
            ),
            ("areas", "STRUCT(area_id INTEGER, area_name VARCHAR, is_active BOOLEAN)[]"),
        ),
    ),
    ExpectedSchema(
        "pv_territories",
        "pv_territories.v1",
        _columns(
            ("territory_id", "INTEGER"),
            ("territory_name", "VARCHAR"),
            ("sector_id", "INTEGER"),
            ("sector_name", "VARCHAR"),
            ("logo_url", "VARCHAR"),
            ("is_active", "BOOLEAN"),
            ("areas", "STRUCT(area_id INTEGER, area_name VARCHAR, is_active BOOLEAN)[]"),
        ),
    ),
    ExpectedSchema(
        "pv_areas",
        "pv_areas.v2",
        _columns(
            ("area_id", "INTEGER"),
            ("area_name", "VARCHAR"),
            ("sector_id", "INTEGER"),
            ("sector_name", "VARCHAR"),
            ("territory_id", "INTEGER"),
            ("territory_name", "VARCHAR"),
            ("logo_url", "VARCHAR"),
            ("is_active", "BOOLEAN"),
            ("regions", "STRUCT(region_id INTEGER, region_name VARCHAR, is_active BOOLEAN)[]"),
        ),
    ),
    ExpectedSchema(
        "pv_aos",
        "pv_aos.v1",
        _columns(
            ("refreshed_at", "TIMESTAMP WITH TIME ZONE"),
            ("ao_id", "INTEGER"),
            ("ao_name", "VARCHAR"),
            ("region_id", "INTEGER"),
            ("region_name", "VARCHAR"),
            ("logo_url", "VARCHAR"),
            ("is_active", "BOOLEAN"),
            ("types", "STRUCT(type_id INTEGER, type_name VARCHAR)[]"),
            ("tags", "STRUCT(tag_id INTEGER, tag_name VARCHAR)[]"),
        ),
    ),
    ExpectedSchema(
        "pv_events",
        "pv_events.v2",
        _columns(
            ("refreshed_at", "TIMESTAMP WITH TIME ZONE"),
            ("event_id", "INTEGER"),
            ("event_date", "DATE"),
            ("event_name", "VARCHAR"),
            ("pax_count", "INTEGER"),
            ("fng_count", "INTEGER"),
            ("description", "VARCHAR"),
            ("preblast", "VARCHAR"),
            ("preblast_rich", "JSON"),
            ("backblast", "VARCHAR"),
            ("backblast_rich", "JSON"),
            ("meta", "JSON"),
            ("ao_org_id", "INTEGER"),
            ("ao_name", "VARCHAR"),
            ("region_org_id", "INTEGER"),
            ("region_name", "VARCHAR"),
            ("area_org_id", "INTEGER"),
            ("area_name", "VARCHAR"),
            ("territory_org_id", "INTEGER"),
            ("territory_name", "VARCHAR"),
            ("sector_org_id", "INTEGER"),
            ("sector_name", "VARCHAR"),
            ("first_f_ind", "INTEGER"),
            ("second_f_ind", "INTEGER"),
            ("third_f_ind", "INTEGER"),
            ("types", 'STRUCT(id INTEGER, "name" VARCHAR, description VARCHAR, event_category VARCHAR)[]'),
            ("tags", 'STRUCT(id INTEGER, "name" VARCHAR, description VARCHAR)[]'),
            (
                "attendance",
                "STRUCT(user_id INTEGER, f3_name VARCHAR, q_ind INTEGER, coq_ind INTEGER, avatar_url VARCHAR, "
                "attended BOOLEAN, ghost BOOLEAN, fartsack BOOLEAN)[]",
            ),
        ),
    ),
    ExpectedSchema(
        "event_info",
        "event_info.v1",
        _columns(
            ("id", "INTEGER"),
            ("org_id", "INTEGER"),
            ("location_id", "INTEGER"),
            ("series_id", "INTEGER"),
            ("highlight", "BOOLEAN"),
            ("start_date", "DATE"),
            ("end_date", "DATE"),
            ("start_time", "VARCHAR"),
            ("end_time", "VARCHAR"),
            ("name", "VARCHAR"),
            ("description", "VARCHAR"),
            ("pax_count", "INTEGER"),
            ("fng_count", "INTEGER"),
            ("preblast", "VARCHAR"),
            ("backblast", "VARCHAR"),
            ("meta", "JSON"),
            ("created", "TIMESTAMP"),
            ("updated", "TIMESTAMP"),
            ("series_name", "VARCHAR"),
            ("series_description", "VARCHAR"),
            ("ao_org_id", "INTEGER"),
            ("ao_name", "VARCHAR"),
            ("ao_description", "VARCHAR"),
            ("ao_logo_url", "VARCHAR"),
            ("ao_website", "VARCHAR"),
            ("ao_meta", "JSON"),
            ("region_org_id", "INTEGER"),
            ("region_name", "VARCHAR"),
            ("region_description", "VARCHAR"),
            ("region_logo_url", "VARCHAR"),
            ("region_website", "VARCHAR"),
            ("region_meta", "JSON"),
            ("area_org_id", "INTEGER"),
            ("area_name", "VARCHAR"),
            ("territory_org_id", "INTEGER"),
            ("territory_name", "VARCHAR"),
            ("sector_org_id", "INTEGER"),
            ("sector_name", "VARCHAR"),
            ("location_name", "VARCHAR"),
            ("location_description", "VARCHAR"),
            ("location_latitude", "DOUBLE"),
            ("location_longitude", "DOUBLE"),
            ("bootcamp_ind", "DOUBLE"),
            ("run_ind", "DOUBLE"),
            ("ruck_ind", "DOUBLE"),
            ("first_f_ind", "DOUBLE"),
            ("second_f_ind", "DOUBLE"),
            ("third_f_ind", "DOUBLE"),
            ("pre_workout_ind", "DOUBLE"),
            ("off_the_books_ind", "DOUBLE"),
            ("vq_ind", "DOUBLE"),
            ("convergence_ind", "DOUBLE"),
            ("all_types", "VARCHAR[]"),
            ("all_tags", "VARCHAR[]"),
        ),
    ),
    ExpectedSchema(
        "future_event_info",
        "future_event_info.v1",
        _columns(
            ("id", "INTEGER"),
            ("org_id", "INTEGER"),
            ("location_id", "INTEGER"),
            ("series_id", "INTEGER"),
            ("highlight", "BOOLEAN"),
            ("start_date", "DATE"),
            ("end_date", "DATE"),
            ("start_time", "VARCHAR"),
            ("end_time", "VARCHAR"),
            ("name", "VARCHAR"),
            ("description", "VARCHAR"),
            ("preblast", "VARCHAR"),
            ("meta", "JSON"),
            ("created", "TIMESTAMP"),
            ("updated", "TIMESTAMP"),
            ("series_name", "VARCHAR"),
            ("series_description", "VARCHAR"),
            ("ao_org_id", "INTEGER"),
            ("ao_name", "VARCHAR"),
            ("ao_description", "VARCHAR"),
            ("ao_logo_url", "VARCHAR"),
            ("ao_website", "VARCHAR"),
            ("ao_meta", "JSON"),
            ("region_org_id", "INTEGER"),
            ("region_name", "VARCHAR"),
            ("region_description", "VARCHAR"),
            ("region_logo_url", "VARCHAR"),
            ("region_website", "VARCHAR"),
            ("region_meta", "JSON"),
            ("area_org_id", "INTEGER"),
            ("area_name", "VARCHAR"),
            ("territory_org_id", "INTEGER"),
            ("territory_name", "VARCHAR"),
            ("sector_org_id", "INTEGER"),
            ("sector_name", "VARCHAR"),
            ("location_name", "VARCHAR"),
            ("location_description", "VARCHAR"),
            ("location_latitude", "DOUBLE"),
            ("location_longitude", "DOUBLE"),
            ("bootcamp_ind", "DOUBLE"),
            ("run_ind", "DOUBLE"),
            ("ruck_ind", "DOUBLE"),
            ("first_f_ind", "DOUBLE"),
            ("second_f_ind", "DOUBLE"),
            ("third_f_ind", "DOUBLE"),
            ("pre_workout_ind", "DOUBLE"),
            ("off_the_books_ind", "DOUBLE"),
            ("vq_ind", "DOUBLE"),
            ("convergence_ind", "DOUBLE"),
            ("all_types", "VARCHAR[]"),
            ("all_tags", "VARCHAR[]"),
            ("planned_q_user_id", "INTEGER"),
        ),
    ),
    ExpectedSchema(
        "attendance_info",
        "attendance_info.v1",
        _columns(
            ("id", "INTEGER"),
            ("user_id", "INTEGER"),
            ("event_instance_id", "INTEGER"),
            ("attendance_meta", "JSON"),
            ("created", "TIMESTAMP"),
            ("updated", "TIMESTAMP"),
            ("q_ind", "DOUBLE"),
            ("coq_ind", "DOUBLE"),
            ("f3_name", "VARCHAR"),
            ("home_region_id", "INTEGER"),
            ("home_region_name", "VARCHAR"),
            ("avatar_url", "VARCHAR"),
            ("user_statusa", "VARCHAR"),
            ("start_date", "DATE"),
        ),
    ),
    ExpectedSchema(
        "missing_backblasts",
        "missing_backblasts.v1",
        _columns(
            ("q_who", "VARCHAR"),
            ("region_name", "VARCHAR"),
            ("ao_name", "VARCHAR"),
            ("start_date", "DATE"),
            ("start_time", "VARCHAR"),
        ),
    ),
)

SCHEMAS_BY_NAME = MappingProxyType({schema.dataset: schema for schema in _SCHEMAS})
SCHEMA_REGISTRY = SCHEMAS_BY_NAME
