import pytest

from analytics.materializations import (
    ANALYTICS_NAMES,
    ANALYTICS_PRODUCT,
    MATERIALIZATIONS,
    MATERIALIZATIONS_BY_NAME,
    MATERIALIZATIONS_BY_PRODUCT,
    PAX_VAULT_NAMES,
    PAX_VAULT_PRODUCT,
    select_materializations,
)


def test_registry_has_exact_ordered_product_sets():
    assert tuple(item.name for item in MATERIALIZATIONS) == PAX_VAULT_NAMES
    assert len(MATERIALIZATIONS_BY_NAME) == len(PAX_VAULT_NAMES) + len(ANALYTICS_NAMES)
    assert (
        tuple(item.name for item in MATERIALIZATIONS_BY_PRODUCT[PAX_VAULT_PRODUCT])
        == PAX_VAULT_NAMES
        == (
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
    )
    assert (
        tuple(item.name for item in MATERIALIZATIONS_BY_PRODUCT[ANALYTICS_PRODUCT])
        == ANALYTICS_NAMES
        == (
            "event_info",
            "future_event_info",
            "attendance_info",
            "missing_backblasts",
        )
    )


def test_schema_versions_are_registered_per_product():
    versions = {item.name: item.schema_version for group in MATERIALIZATIONS_BY_PRODUCT.values() for item in group}
    assert versions == {
        "pv_regions": "pv_regions.v1",
        "pv_pax": "pv_pax.v2",
        "pv_kotter": "pv_kotter.v1",
        "pv_upcoming": "pv_upcoming.v1",
        "pv_sectors": "pv_sectors.v2",
        "pv_territories": "pv_territories.v1",
        "pv_areas": "pv_areas.v2",
        "pv_aos": "pv_aos.v1",
        "pv_events": "pv_events.v2",
        "event_info": "event_info.v1",
        "future_event_info": "future_event_info.v1",
        "attendance_info": "attendance_info.v1",
        "missing_backblasts": "missing_backblasts.v1",
    }


def test_default_selection_remains_pax_vault_and_product_selection_is_isolated():
    assert tuple(item.name for item in select_materializations(None)) == PAX_VAULT_NAMES
    assert tuple(item.name for item in select_materializations(None, product=ANALYTICS_PRODUCT)) == ANALYTICS_NAMES
    analytics_event = select_materializations(["event_info"], product=ANALYTICS_PRODUCT)
    assert tuple(item.name for item in analytics_event) == ("event_info",)
    with pytest.raises(ValueError, match="another product"):
        select_materializations(["event_info"])
    with pytest.raises(ValueError, match="another product"):
        select_materializations(["pv_events"], product=ANALYTICS_PRODUCT)


def test_product_targets_and_sql_resources_are_registered():
    for product, items in MATERIALIZATIONS_BY_PRODUCT.items():
        for item in items:
            assert item.product == product
            assert item.nonprod_prefix == f"gs://f3-analytics-nonprod/{product}/{item.name}"
            assert item.production_prefix == f"gs://f3-analytics/{product}/{item.name}"
            assert select_materializations([item.name], product=product) == (item,)
