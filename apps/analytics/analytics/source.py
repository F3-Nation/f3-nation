"""Read-only PostgreSQL attachment and the bounded region roster query."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import quote

from .settings import Settings

REGION_QUERY = """
WITH region_base AS (
    SELECT r.id AS region_id, COALESCE(r.name, CAST(r.id AS VARCHAR)) AS region_name,
           area.id AS area_id, COALESCE(area.name, CAST(area.id AS VARCHAR)) AS area_name,
           r.logo_url AS logo_url, r.is_active
    FROM pg.public.orgs r
    LEFT JOIN pg.public.orgs area ON area.id = r.parent_id AND area.org_type = 'area'
    WHERE r.org_type = 'region'
),
event_source AS (
    SELECT ei.*,
            json_type(CAST(ei.meta AS JSON), '$.exclude_from_pax_vault') AS exclude_flag_type
    FROM pg.public.event_instances ei
    WHERE ei.is_active = true AND ei.pax_count IS NOT NULL
),
event_flags AS (
    SELECT event_source.*,
           CASE
             WHEN exclude_flag_type IS NOT NULL AND exclude_flag_type NOT IN ('BOOLEAN', 'NULL')
               THEN error('exclude_from_pax_vault must be boolean')
             WHEN exclude_flag_type = 'BOOLEAN'
               THEN COALESCE(json_extract(CAST(meta AS JSON), '$.exclude_from_pax_vault')::BOOLEAN, false)
             ELSE false
           END AS exclude_from_pax_vault
    FROM event_source
),
eligible_events AS (
    SELECT ei.id AS event_id, ei.org_id, direct.id AS direct_id,
           CASE WHEN direct.org_type = 'region' THEN direct.id
                WHEN direct.org_type = 'ao' AND parent.org_type = 'region' THEN parent.id END AS region_id,
           CASE WHEN direct.org_type = 'ao' AND parent.org_type = 'region' THEN direct.id END AS ao_id,
           CASE WHEN direct.org_type = 'ao' AND parent.org_type = 'region' THEN
                COALESCE(direct.name, CAST(direct.id AS VARCHAR)) END AS ao_name
    FROM event_flags ei
    JOIN pg.public.orgs direct ON direct.id = ei.org_id
    LEFT JOIN pg.public.orgs parent ON parent.id = direct.parent_id
    WHERE ei.is_active = true AND ei.pax_count IS NOT NULL
      AND ei.exclude_from_pax_vault = false
),
region_events AS (
    SELECT e.* FROM eligible_events e JOIN region_base r ON r.region_id = e.region_id
),
region_values AS (
    SELECT r.region_id, r.region_name, r.area_id, r.area_name, r.logo_url, r.is_active,
      COALESCE((SELECT list(struct_pack(ao_org_id := x.ao_id, ao_name := x.ao_name) ORDER BY x.ao_name, x.ao_id)
                FROM (SELECT DISTINCT ao_id, ao_name FROM region_events
                      WHERE region_id = r.region_id AND ao_id IS NOT NULL) x),
               []::STRUCT(ao_org_id INTEGER, ao_name VARCHAR)[]) AS aos,
      COALESCE((SELECT list(struct_pack(type_id := x.id, type_name := x.display_name)
                            ORDER BY x.display_name, x.id)
                FROM (SELECT DISTINCT et.id, COALESCE(et.name, CAST(et.id AS VARCHAR)) AS display_name
                      FROM region_events re
                      JOIN pg.public.event_instances_x_event_types x ON x.event_instance_id = re.event_id
                      JOIN pg.public.event_types et ON et.id = x.event_type_id WHERE re.region_id = r.region_id) x),
               []::STRUCT(type_id INTEGER, type_name VARCHAR)[]) AS types,
      COALESCE((SELECT list(struct_pack(tag_id := x.id, tag_name := x.display_name)
                            ORDER BY x.display_name, x.id)
                FROM (SELECT DISTINCT t.id, COALESCE(t.name, CAST(t.id AS VARCHAR)) AS display_name
                      FROM region_events re
                      JOIN pg.public.event_tags_x_event_instances x ON x.event_instance_id = re.event_id
                      JOIN pg.public.event_tags t ON t.id = x.event_tag_id WHERE re.region_id = r.region_id) x),
               []::STRUCT(tag_id INTEGER, tag_name VARCHAR)[]) AS tags
    FROM region_base r
)
SELECT region_id, region_name, area_id, area_name, logo_url, is_active, aos, types, tags,
       ?::TIMESTAMPTZ AS refreshed_at
FROM region_values
ORDER BY region_name, region_id
"""


def _sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def postgres_attach_sql(settings: Settings) -> str:
    """Build a DuckDB ATTACH statement without exposing credentials in logs."""
    user = quote(settings.postgres_user, safe="")
    password = quote(settings.postgres_password, safe="")
    database = quote(settings.postgres_database, safe="")
    socket = quote(settings.postgres_socket_dir, safe="")
    literal = f"postgresql://{user}:{password}@/{database}?host={socket}"
    return f"ATTACH {_sql_literal(literal)} AS pg (TYPE postgres, READ_ONLY)"


def attach_postgres(connection: Any, settings: Settings) -> None:
    connection.execute(postgres_attach_sql(settings))


def materialize(connection: Any, output_path: Path, refreshed_at: str) -> int:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    connection.execute(
        f"COPY ({REGION_QUERY}) TO ? (FORMAT PARQUET, COMPRESSION SNAPPY)",
        [str(output_path), refreshed_at],
    )
    return int(connection.execute("SELECT count(*) FROM read_parquet(?)", [str(output_path)]).fetchone()[0])
