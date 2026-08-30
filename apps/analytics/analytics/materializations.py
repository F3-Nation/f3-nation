"""The deliberately small, allowlisted publication registry."""

from __future__ import annotations

from dataclasses import dataclass
from importlib.resources import files
from types import MappingProxyType


@dataclass(frozen=True, slots=True)
class Materialization:
    name: str
    schema_version: str
    output_filename: str
    nonprod_prefix: str
    production_prefix: str
    sql_reference: str
    partition_by: tuple[str, ...] = ()
    sort_by: tuple[str, ...] = ()

    @property
    def query_reference(self) -> str:
        return self.sql_reference

    def target(self, environment: str) -> tuple[str, str]:
        if environment in ("local", "test"):
            environment = "nonprod"
        if environment == "nonprod":
            return self.nonprod_prefix, ""
        if environment == "production":
            return self.production_prefix, ""
        raise ValueError("unsupported analytics environment")


_NAMES = ("pv_regions", "pv_pax", "pv_kotter", "pv_upcoming", "pv_areas", "pv_aos", "pv_sectors", "pv_events")


def _definition(name: str) -> Materialization:
    return Materialization(
        name,
        f"{name}.v1",
        f"{name}.parquet",
        f"gs://f3-analytics-nonprod/parquets/{name}",
        f"gs://analytics/parquets/{name}",
        f"sql/{name}.sql",
        partition_by=("region_org_id",) if name == "pv_events" else (),
        sort_by=("event_date", "event_id") if name == "pv_events" else (),
    )


MATERIALIZATIONS = tuple(_definition(name) for name in _NAMES)
MATERIALIZATIONS_BY_NAME = MappingProxyType({item.name: item for item in MATERIALIZATIONS})


def _resource_exists(materialization: Materialization) -> bool:
    return files("analytics").joinpath(materialization.sql_reference).is_file()


AVAILABLE_MATERIALIZATIONS = tuple(item for item in MATERIALIZATIONS if _resource_exists(item))
# Descriptive aliases make the registry convenient for callers without exposing
# a mutable selection mechanism.
MATERIALIZATION_REGISTRY = MATERIALIZATIONS_BY_NAME
MaterializationDefinition = Materialization


def select_materializations(names: tuple[str, ...] | list[str] | None) -> tuple[Materialization, ...]:
    if names is None or not names:
        return AVAILABLE_MATERIALIZATIONS
    unknown = [name for name in names if name not in MATERIALIZATIONS_BY_NAME]
    if unknown:
        raise ValueError(f"unknown materialization: {unknown[0]}")
    if len(set(names)) != len(names):
        raise ValueError("duplicate materialization selector")
    selected = tuple(MATERIALIZATIONS_BY_NAME[name] for name in names)
    unavailable = next((item.name for item in selected if not _resource_exists(item)), None)
    if unavailable:
        raise ValueError(f"materialization is registered but unavailable; SQL resource is missing: {unavailable}")
    return selected
