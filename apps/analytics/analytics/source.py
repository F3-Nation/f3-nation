"""Read-only PostgreSQL attachment and SQL-resource materialization."""

from __future__ import annotations

from importlib.resources import files
from pathlib import Path
from typing import Any
from urllib.parse import quote

from .materializations import MATERIALIZATIONS_BY_NAME, Materialization
from .settings import Settings


def _sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def postgres_attach_sql(settings: Settings) -> str:
    """Build a DuckDB ATTACH statement without exposing credentials in logs."""
    user = quote(settings.postgres_user, safe="")
    password = quote(settings.postgres_password, safe="")
    database = quote(settings.postgres_database, safe="")
    if settings.postgres_host is not None:
        literal = f"postgresql://{user}:{password}@{settings.postgres_host}:{settings.postgres_port}/{database}"
    else:
        socket = quote(settings.postgres_socket_dir or "", safe="")
        literal = f"postgresql://{user}:{password}@/{database}?host={socket}"
    return f"ATTACH {_sql_literal(literal)} AS pg (TYPE postgres, READ_ONLY)"


def attach_postgres(connection: Any, settings: Settings) -> None:
    connection.execute(postgres_attach_sql(settings))


def load_sql(materialization: Materialization) -> str:
    """Load the SQL resource for an approved materialization."""
    if MATERIALIZATIONS_BY_NAME.get(materialization.name) is not materialization:
        raise ValueError("materialization is not in the approved registry")
    resource = materialization.sql_reference
    if resource != f"sql/{materialization.name}.sql":
        raise ValueError(f"invalid SQL resource for materialization: {materialization.name}")
    sql_resource = files("analytics").joinpath(resource)
    if not sql_resource.is_file():
        raise ValueError(f"materialization SQL resource is missing: {materialization.name}")
    return sql_resource.read_text(encoding="utf-8")


def materialize(
    connection: Any,
    output_path: Path,
    materialization: Materialization,
    refreshed_at: str,
    as_of_date: str,
) -> int:
    query = load_sql(materialization)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    connection.execute(
        f"COPY ({query}) TO ? (FORMAT PARQUET, COMPRESSION SNAPPY)",
        [str(output_path), refreshed_at, as_of_date],
    )
    return int(connection.execute("SELECT count(*) FROM read_parquet(?)", [str(output_path)]).fetchone()[0])
