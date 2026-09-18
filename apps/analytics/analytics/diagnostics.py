"""Bounded, read-only diagnostics for the analytics source and materializations."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any, Callable

import psycopg

from .duckdb import connect
from .logging import JsonLogger
from .settings import Settings
from .source import _sql_literal, attach_postgres

_LIMIT = 100

_KOTTER_SOURCE_SQL = """
WITH sampled_events AS (
    SELECT id
    FROM public.event_instances
    WHERE is_active = true AND pax_count IS NOT NULL
    ORDER BY id
    LIMIT %s
)
SELECT e.id AS event_id, e.name AS event_name, e.start_date::DATE AS event_date,
       e.org_id AS ao_id, o.name AS ao_name, a.user_id,
       u.f3_name, u.avatar_url
FROM public.event_instances e
JOIN sampled_events s ON s.id = e.id
JOIN public.orgs o ON o.id = e.org_id
JOIN public.attendance a ON a.event_instance_id = e.id AND a.is_planned = false
JOIN public.users u ON u.id = a.user_id
WHERE e.is_active = true AND e.pax_count IS NOT NULL AND u.email IS NOT NULL
ORDER BY e.id, a.user_id
LIMIT %s
"""
_KOTTER_SOURCE_SCHEMA = """
CREATE TEMP TABLE diagnostic_pv_kotter_source (
    event_id BIGINT, event_name VARCHAR, event_date DATE, ao_id BIGINT,
    ao_name VARCHAR, user_id BIGINT, f3_name VARCHAR, avatar_url VARCHAR
)
"""
_KOTTER_AGGREGATION_SQL = """
SELECT user_id,
       COALESCE(NULLIF(MAX(f3_name), ''), CAST(user_id AS VARCHAR)) AS f3_name,
       list(struct_pack(event_id := event_id, event_name := event_name,
                        event_date := event_date, ao_id := ao_id, ao_name := ao_name,
                        avatar_url := avatar_url)
            ORDER BY event_date DESC, event_id DESC)[:3] AS nested_values
FROM diagnostic_pv_kotter_source
GROUP BY user_id
ORDER BY user_id
LIMIT 100
"""
_EVENTS_SOURCE_SQL = """
WITH sampled_events AS (
    SELECT id
    FROM public.event_instances
    WHERE is_active = true AND pax_count IS NOT NULL
    ORDER BY id
    LIMIT %s
)
SELECT e.id AS event_id, e.name AS event_name, e.start_date::DATE AS event_date,
       e.pax_count, e.fng_count, a.user_id, u.f3_name, u.avatar_url,
       et.id AS event_type_id, et.name AS event_type_name,
       eg.id AS event_tag_id, eg.name AS event_tag_name
FROM public.event_instances e
JOIN sampled_events s ON s.id = e.id
LEFT JOIN public.attendance a ON a.event_instance_id = e.id
LEFT JOIN public.users u ON u.id = a.user_id
LEFT JOIN public.event_instances_x_event_types x ON x.event_instance_id = e.id
LEFT JOIN public.event_types et ON et.id = x.event_type_id
LEFT JOIN public.event_tags_x_event_instances tx ON tx.event_instance_id = e.id
LEFT JOIN public.event_tags eg ON eg.id = tx.event_tag_id
WHERE e.is_active = true AND e.pax_count IS NOT NULL
ORDER BY e.id, a.user_id, et.id, eg.id
LIMIT %s
"""
_EVENTS_SOURCE_SCHEMA = """
CREATE TEMP TABLE diagnostic_pv_events_source (
    event_id BIGINT, event_name VARCHAR, event_date DATE, pax_count INTEGER,
    fng_count INTEGER, user_id BIGINT, f3_name VARCHAR, avatar_url VARCHAR,
    event_type_id BIGINT, event_type_name VARCHAR, event_tag_id BIGINT, event_tag_name VARCHAR
)
"""
_EVENTS_AGGREGATION_SQL = """
SELECT event_id, MAX(event_date) AS event_date, MAX(event_name) AS event_name,
       COALESCE(list(struct_pack(user_id := user_id, f3_name := f3_name,
                                 avatar_url := avatar_url)
                     ORDER BY user_id) FILTER (WHERE user_id IS NOT NULL),
                []::STRUCT(user_id BIGINT, f3_name VARCHAR, avatar_url VARCHAR)[]) AS nested_values,
       COALESCE(list(struct_pack(event_type_id := event_type_id, name := event_type_name)
                     ORDER BY event_type_id) FILTER (WHERE event_type_id IS NOT NULL),
                []::STRUCT(event_type_id BIGINT, name VARCHAR)[]) AS event_types,
       COALESCE(list(struct_pack(event_tag_id := event_tag_id, name := event_tag_name)
                     ORDER BY event_tag_id) FILTER (WHERE event_tag_id IS NOT NULL),
                []::STRUCT(event_tag_id BIGINT, name VARCHAR)[]) AS event_tags
FROM diagnostic_pv_events_source
GROUP BY event_id
ORDER BY event_date, event_id
LIMIT 100
"""
_KOTTER_INSERT_SQL = "INSERT INTO diagnostic_pv_kotter_source VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
_EVENTS_INSERT_SQL = "INSERT INTO diagnostic_pv_events_source VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
_KOTTER_PARQUET_VALIDATION_SQL = "SELECT count(*), count(nested_values) FROM read_parquet(?)"
_EVENTS_PARQUET_VALIDATION_SQL = (
    "SELECT count(*), count(nested_values), count(event_types), count(event_tags) FROM read_parquet(?)"
)


_ORG_SAMPLE_SQL = "SELECT id, name, org_type, parent_id, logo_url, is_active FROM public.orgs LIMIT 100"
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

    def probe(
        name: str,
        operation: Callable[[Any], dict[str, Any]],
        *,
        attach: bool = True,
        legacy: bool = False,
    ) -> None:
        if legacy and getattr(settings, "environment", None) == "production":
            results[name] = {"status": "skipped", "reason": "production_isolated_diagnostics"}
            log.info("analytics.etl.diagnostic_skipped", probe=name, reason="production_isolated_diagnostics")
            return
        connection: Any | None = None
        try:
            connection = connection_factory(settings)
            if attach:
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
                db.execute(f"SELECT count(*) FROM postgres_query('pg', {_sql_literal(_ORG_SAMPLE_SQL)})").fetchone()[0]
            )
        },
        legacy=True,
    )
    probe(
        "territory_count",
        lambda db: {
            "row_count": int(
                db.execute(
                    f"SELECT count(*) FROM postgres_query('pg', {_sql_literal(_TERRITORY_SAMPLE_SQL)})"
                ).fetchone()[0]
            )
        },
        legacy=True,
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

    probe("local_parquet_copy", local_copy, legacy=True)
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

        probe(f"{name}_materialization", materialization_probe, legacy=True)

    def postgres_kwargs() -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "dbname": settings.postgres_database,
            "user": settings.postgres_user,
            "password": settings.postgres_password,
        }
        if settings.postgres_socket_dir:
            kwargs["host"] = settings.postgres_socket_dir
        else:
            kwargs["host"] = settings.postgres_host
            kwargs["port"] = settings.postgres_port
        return kwargs

    def bounded_source_rows(source_sql: str) -> list[tuple[Any, ...]]:
        connection = psycopg.connect(**postgres_kwargs())
        try:
            connection.read_only = True
            with connection.transaction(force_rollback=True):
                with connection.cursor() as cursor:
                    cursor.execute("SELECT set_config('statement_timeout', %s, true)", ("5s",))
                    cursor.execute(source_sql, (_LIMIT, _LIMIT))
                    return list(cursor.fetchall())
        finally:
            connection.close()

    def bounded_materialization_probe(
        db: Any,
        name: str,
        source_sql: str,
        source_schema: str,
        insert_sql: str,
        aggregation_sql: str,
        validation_sql: str,
        log: JsonLogger,
    ) -> dict[str, Any]:
        """Exercise nested shapes using a deliberately bounded source sample."""
        phases: list[str] = []

        def phase(name_: str, operation: Callable[[], int | None]) -> int | None:
            try:
                row_count = operation()
            except Exception as error:
                log.error(
                    "analytics.etl.diagnostic_phase_failed",
                    probe=name,
                    phase=name_,
                    source_sample_limit=_LIMIT,
                    error_type=type(error).__name__,
                )
                raise
            phases.append(name_)
            context: dict[str, Any] = {"probe": name, "phase": name_, "source_sample_limit": _LIMIT}
            if row_count is not None:
                context["row_count"] = row_count
            log.info("analytics.etl.diagnostic_phase_succeeded", **context)
            return row_count

        def source_read() -> int:
            rows = bounded_source_rows(source_sql)
            db.execute(source_schema)
            db.executemany(insert_sql, rows)
            return len(rows)

        phase("source_read", source_read)
        phase(
            "query_aggregation",
            lambda: (
                db.execute(f"CREATE TEMP TABLE diagnostic_{name} AS {aggregation_sql}"),
                int(db.execute(f"SELECT count(*) FROM diagnostic_{name}").fetchone()[0]),
            )[1],
        )

        def local_parquet() -> int:
            with tempfile.TemporaryDirectory(prefix="analytics-diagnostic-") as directory:
                destination = Path(directory) / f"{name}.parquet"
                db.execute(
                    f"COPY (SELECT * FROM diagnostic_{name}) TO {_sql_literal(str(destination))} "
                    "(FORMAT PARQUET, COMPRESSION ZSTD)"
                )
                counts = db.execute(validation_sql, [str(destination)]).fetchone()
                if any(count != counts[0] for count in counts[1:]):
                    raise ValueError("nested parquet validation failed")
                return int(counts[0])

        count = phase("local_parquet", local_parquet)
        return {"row_count": int(count or 0), "source_sample_limit": _LIMIT, "phases": phases}

    for name, source_sql, source_schema, insert_sql, aggregation_sql, validation_sql in (
        (
            "pv_kotter",
            _KOTTER_SOURCE_SQL,
            _KOTTER_SOURCE_SCHEMA,
            _KOTTER_INSERT_SQL,
            _KOTTER_AGGREGATION_SQL,
            _KOTTER_PARQUET_VALIDATION_SQL,
        ),
        (
            "pv_events",
            _EVENTS_SOURCE_SQL,
            _EVENTS_SOURCE_SCHEMA,
            _EVENTS_INSERT_SQL,
            _EVENTS_AGGREGATION_SQL,
            _EVENTS_PARQUET_VALIDATION_SQL,
        ),
    ):
        def operation(
            db: Any,
            name: str = name,
            source_sql: str = source_sql,
            source_schema: str = source_schema,
            insert_sql: str = insert_sql,
            aggregation_sql: str = aggregation_sql,
            validation_sql: str = validation_sql,
        ) -> dict[str, Any]:
            return bounded_materialization_probe(
                db, name, source_sql, source_schema, insert_sql, aggregation_sql, validation_sql, log
            )

        probe(name, operation, attach=False)
    return results
