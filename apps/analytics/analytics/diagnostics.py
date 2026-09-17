"""Bounded, read-only diagnostics for the analytics source and materializations."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any, Callable

from .duckdb import connect
from .logging import JsonLogger
from .settings import Settings
from .source import _sql_literal, attach_postgres

_LIMIT = 100


_ORG_SAMPLE_SQL = (
    "SELECT id, name, org_type, parent_id, logo_url, is_active "
    "FROM public.orgs LIMIT 100"
)
_TERRITORY_SAMPLE_SQL = "SELECT id FROM public.orgs WHERE CAST(org_type AS VARCHAR) = 'territory' LIMIT 100"

_SECTORS_QUERY = """
WITH RECURSIVE sector_rows AS (
    SELECT sector.id AS sector_id, COALESCE(sector.name, CAST(sector.id AS VARCHAR)) AS sector_name,
           sector.logo_url, sector.is_active
    FROM diagnostic_orgs sector WHERE sector.org_type = 'sector'
), sector_descendants(sector_id, descendant_id, visited) AS (
    SELECT id, id, [id] FROM diagnostic_orgs WHERE org_type = 'sector'
    UNION ALL
    SELECT d.sector_id, child.id, list_append(d.visited, child.id)
    FROM sector_descendants d JOIN diagnostic_orgs child ON child.parent_id = d.descendant_id
    WHERE NOT list_contains(d.visited, child.id) AND len(d.visited) < 20
), sector_values AS (
    SELECT s.*,
           COALESCE((SELECT list(struct_pack(territory_id := t.id,
                                              territory_name := COALESCE(t.name, CAST(t.id AS VARCHAR)),
                                              logo_url := t.logo_url, is_active := t.is_active)
                                  ORDER BY COALESCE(t.name, CAST(t.id AS VARCHAR)), t.id)
                     FROM diagnostic_orgs t
                     WHERE t.org_type = 'territory' AND t.parent_id = s.sector_id),
                    []::STRUCT(
                        territory_id INTEGER, territory_name VARCHAR, logo_url VARCHAR, is_active BOOLEAN
                    )[]) AS territories,
           COALESCE((SELECT list(struct_pack(area_id := a.id,
                                              area_name := COALESCE(a.name, CAST(a.id AS VARCHAR)),
                                              is_active := a.is_active)
                                  ORDER BY COALESCE(a.name, CAST(a.id AS VARCHAR)), a.id)
                     FROM diagnostic_orgs a JOIN sector_descendants d ON d.descendant_id = a.id
                     WHERE a.org_type = 'area' AND d.sector_id = s.sector_id),
                    []::STRUCT(area_id INTEGER, area_name VARCHAR, is_active BOOLEAN)[]) AS areas
    FROM sector_rows s
)
SELECT sector_id, sector_name, logo_url, is_active, territories, areas
FROM sector_values ORDER BY sector_name, sector_id
"""

_AREAS_QUERY = """
WITH RECURSIVE area_ancestors(area_id, ancestor_id, ancestor_name, ancestor_type, visited) AS (
    SELECT id, id, COALESCE(name, CAST(id AS VARCHAR)), org_type, [id]
    FROM diagnostic_orgs WHERE org_type = 'area'
    UNION ALL
    SELECT a.area_id, parent.id, COALESCE(parent.name, CAST(parent.id AS VARCHAR)), parent.org_type,
           list_append(a.visited, parent.id)
    FROM area_ancestors a
    JOIN diagnostic_orgs child ON child.id = a.ancestor_id
    JOIN diagnostic_orgs parent ON parent.id = child.parent_id
    WHERE NOT list_contains(a.visited, parent.id) AND len(a.visited) < 20
), area_rows AS (
    SELECT area.id AS area_id, COALESCE(area.name, CAST(area.id AS VARCHAR)) AS area_name,
           MAX(a.ancestor_id) FILTER (WHERE a.ancestor_type = 'sector')::INTEGER AS sector_id,
           MAX(a.ancestor_name) FILTER (WHERE a.ancestor_type = 'sector') AS sector_name,
           MAX(a.ancestor_id) FILTER (WHERE a.ancestor_type = 'territory')::INTEGER AS territory_id,
           MAX(a.ancestor_name) FILTER (WHERE a.ancestor_type = 'territory') AS territory_name,
           area.logo_url, area.is_active
    FROM diagnostic_orgs area JOIN area_ancestors a ON a.area_id = area.id
    WHERE area.org_type = 'area'
    GROUP BY area.id, area.name, area.logo_url, area.is_active
), area_values AS (
    SELECT a.*,
           COALESCE((SELECT list(struct_pack(region_id := r.id,
                                              region_name := COALESCE(r.name, CAST(r.id AS VARCHAR)),
                                              is_active := r.is_active)
                                  ORDER BY COALESCE(r.name, CAST(r.id AS VARCHAR)), r.id)
                     FROM diagnostic_orgs r
                     WHERE r.org_type = 'region' AND r.parent_id = a.area_id),
                    []::STRUCT(region_id INTEGER, region_name VARCHAR, is_active BOOLEAN)[]) AS regions
    FROM area_rows a
)
SELECT area_id, area_name, sector_id, sector_name, territory_id, territory_name, logo_url, is_active, regions
FROM area_values ORDER BY area_name, area_id
"""


def run_diagnostics(
    settings: Settings,
    connection_factory: Callable[[Settings], Any] = connect,
    logger: JsonLogger | None = None,
) -> dict[str, dict[str, Any]]:
    """Run bounded probes without importing or calling any publication code.

    A separate attached connection is used for every probe. DuckDB can mark a
    connection unusable after an InternalException, so a failed probe must not
    affect the evidence collected by later probes.
    """
    log = logger or JsonLogger()
    results: dict[str, dict[str, Any]] = {}
    def probe(name: str, operation: Callable[[Any], dict[str, Any]]) -> None:
        connection: Any | None = None
        try:
            connection = connection_factory(settings)
            attach_postgres(connection, settings)
            result = operation(connection)
        except Exception as error:
            results[name] = {"status": "failed", "error_type": type(error).__name__}
            log.error("analytics.etl.diagnostic_failed", error, probe=name)
        else:
            results[name] = {"status": "succeeded", **result}
            log.info("analytics.etl.diagnostic_succeeded", probe=name, **result)
        finally:
            if connection is not None:
                try:
                    connection.close()
                except Exception as error:
                    log.error("analytics.etl.diagnostic_cleanup_failed", error, probe=name)

    probe(
        "postgres_scan",
        lambda db: {
            "row_count": int(
                db.execute(
                    "SELECT count(*) FROM postgres_query('pg', "
                    f"{_sql_literal(_ORG_SAMPLE_SQL)})"
                ).fetchone()[0]
            )
        },
    )
    probe(
        "territory_count",
        lambda db: {
            "row_count": int(
                db.execute(
                    "SELECT count(*) FROM postgres_query('pg', "
                    f"{_sql_literal(_TERRITORY_SAMPLE_SQL)})"
                ).fetchone()[0]
            )
        },
    )

    def local_copy(db: Any) -> dict[str, Any]:
        with tempfile.TemporaryDirectory(prefix="analytics-diagnostic-") as directory:
            destination = Path(directory) / "orgs.parquet"
            db.execute(
                f"COPY (SELECT * FROM pg.public.orgs LIMIT {_LIMIT}) TO {_sql_literal(str(destination))} "
                "(FORMAT PARQUET, COMPRESSION ZSTD)"
            )
            count = db.execute("SELECT count(*) FROM read_parquet(?)", [str(destination)]).fetchone()[0]
            return {"row_count": int(count)}

    probe("local_parquet_copy", local_copy)
    for name, query in (("pv_sectors", _SECTORS_QUERY), ("pv_areas", _AREAS_QUERY)):
        def materialization_probe(db: Any, query: str = query, name: str = name) -> dict[str, Any]:
            db.execute(
                "CREATE TEMP TABLE diagnostic_orgs AS SELECT * FROM postgres_query('pg', "
                f"{_sql_literal(_ORG_SAMPLE_SQL)})"
            )
            db.execute(f"CREATE TEMP TABLE diagnostic_{name} AS {query}")
            with tempfile.TemporaryDirectory(prefix="analytics-diagnostic-") as directory:
                destination = Path(directory) / f"{name}.parquet"
                db.execute(
                    f"COPY (SELECT * FROM diagnostic_{name}) TO {_sql_literal(str(destination))} "
                    "(FORMAT PARQUET, COMPRESSION ZSTD)"
                )
                count = db.execute("SELECT count(*) FROM read_parquet(?)", [str(destination)]).fetchone()[0]
                return {"row_count": int(count), "source_sample_limit": _LIMIT}

        probe(f"{name}_materialization", materialization_probe)
    return results
