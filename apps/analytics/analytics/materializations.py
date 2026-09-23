"""The deliberately small, allowlisted publication registry."""

from __future__ import annotations

from dataclasses import dataclass
from importlib.resources import files
from types import MappingProxyType

PAX_VAULT_PRODUCT = "pax-vault"
ANALYTICS_PRODUCT = "analytics"
PRODUCTS = (PAX_VAULT_PRODUCT, ANALYTICS_PRODUCT)


@dataclass(frozen=True, slots=True)
class Materialization:
    name: str
    schema_version: str
    output_filename: str
    nonprod_prefix: str
    production_prefix: str
    sql_reference: str
    product: str
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


PAX_VAULT_NAMES = (
    "pv_regions",
    "pv_pax",
    "pv_kotter",
    "pv_upcoming",
    "pv_sectors",
    "pv_territories",
    "pv_areas",
    "pv_aos",
    "pv_events",
)
ANALYTICS_NAMES = (
    "event_info",
    "future_event_info",
    "attendance_info",
    "missing_backblasts",
)
PRODUCT_NAMES = MappingProxyType(
    {
        PAX_VAULT_PRODUCT: PAX_VAULT_NAMES,
        ANALYTICS_PRODUCT: ANALYTICS_NAMES,
    }
)

_SCHEMA_VERSIONS = MappingProxyType(
    {
        "pv_pax": "pv_pax.v2",
        "pv_sectors": "pv_sectors.v2",
        "pv_areas": "pv_areas.v2",
        "pv_events": "pv_events.v2",
    }
)


def _definition(name: str, product: str) -> Materialization:
    return Materialization(
        name=name,
        schema_version=_SCHEMA_VERSIONS.get(name, f"{name}.v1"),
        output_filename=f"{name}.parquet",
        nonprod_prefix=f"gs://f3-analytics-nonprod/{product}/{name}",
        production_prefix=f"gs://f3-analytics/{product}/{name}",
        sql_reference=f"sql/{name}.sql",
        product=product,
        partition_by=(),
        sort_by=("region_org_id", "event_date") if name == "pv_events" else (),
    )


MATERIALIZATIONS_BY_PRODUCT = MappingProxyType(
    {product: tuple(_definition(name, product) for name in names) for product, names in PRODUCT_NAMES.items()}
)
MATERIALIZATIONS = MATERIALIZATIONS_BY_PRODUCT[PAX_VAULT_PRODUCT]
MATERIALIZATIONS_BY_NAME = MappingProxyType(
    {item.name: item for items in MATERIALIZATIONS_BY_PRODUCT.values() for item in items}
)


def _resource_exists(materialization: Materialization) -> bool:
    return files("analytics").joinpath(materialization.sql_reference).is_file()


AVAILABLE_MATERIALIZATIONS_BY_PRODUCT = MappingProxyType(
    {
        product: tuple(item for item in items if _resource_exists(item))
        for product, items in MATERIALIZATIONS_BY_PRODUCT.items()
    }
)
# Phase 1 retains the historical default selection: the existing pax-vault
# materializations only. Product-aware callers should use the per-product map.
AVAILABLE_MATERIALIZATIONS = AVAILABLE_MATERIALIZATIONS_BY_PRODUCT[PAX_VAULT_PRODUCT]
MATERIALIZATION_REGISTRY = MATERIALIZATIONS_BY_NAME
MATERIALIZATION_REGISTRY_BY_PRODUCT = MATERIALIZATIONS_BY_PRODUCT
MaterializationDefinition = Materialization


def select_materializations(
    names: tuple[str, ...] | list[str] | None,
    *,
    product: str = PAX_VAULT_PRODUCT,
) -> tuple[Materialization, ...]:
    if product not in PRODUCT_NAMES:
        raise ValueError(f"unknown analytics product: {product}")

    registered = MATERIALIZATIONS_BY_PRODUCT[product]
    if names is None or not names:
        selected = registered
    else:
        if len(set(names)) != len(names):
            raise ValueError("duplicate materialization selector")
        cross_product = next(
            (
                name
                for name in names
                if name in MATERIALIZATIONS_BY_NAME and MATERIALIZATIONS_BY_NAME[name].product != product
            ),
            None,
        )
        if cross_product:
            raise ValueError(f"materialization belongs to another product: {cross_product}")
        unknown = [name for name in names if name not in MATERIALIZATIONS_BY_NAME]
        if unknown:
            raise ValueError(f"unknown materialization: {unknown[0]}")
        selected = tuple(MATERIALIZATIONS_BY_NAME[name] for name in names)

    unavailable = next((item.name for item in selected if not _resource_exists(item)), None)
    if unavailable:
        raise ValueError(f"materialization is registered but unavailable; SQL resource is missing: {unavailable}")
    # Ensure all returned definitions are registered to this explicit product.
    if any(item.product != product for item in selected):
        foreign = next(item.name for item in selected if item.product != product)
        raise ValueError(f"materialization belongs to another product: {foreign}")
    return selected
