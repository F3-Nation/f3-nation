"""Read-only PostgreSQL attachment and SQL-resource materialization."""

from __future__ import annotations

from dataclasses import dataclass
from importlib.resources import files
from pathlib import Path
from typing import Any
from urllib.parse import quote

from .materializations import MATERIALIZATIONS_BY_NAME, Materialization
from .settings import Settings


@dataclass(frozen=True, slots=True)
class MaterializationArtifacts:
    root: Path
    sorted_parquet_files: tuple[Path, ...]
    row_count: int

    @property
    def parquet_files(self) -> tuple[Path, ...]:
        return self.sorted_parquet_files


ArtifactSet = MaterializationArtifacts
MaterializationArtifactSet = MaterializationArtifacts


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
    root: Path,
    materialization: Materialization,
    refreshed_at: str,
    as_of_date: str,
) -> MaterializationArtifacts:
    query = load_sql(materialization)
    root.mkdir(parents=True, exist_ok=True)
    output_path = root / materialization.output_filename
    identifiers = (*materialization.partition_by, *materialization.sort_by)
    if any(not identifier.isidentifier() for identifier in identifiers):
        raise ValueError("materialization contains an unsafe identifier")
    order = ", ".join(f'"{identifier}"' for identifier in materialization.sort_by)
    ordered_query = f"SELECT * FROM ({query}) AS materialized"
    if order:
        ordered_query += f" ORDER BY {order}"
    options = "FORMAT PARQUET, COMPRESSION ZSTID"
    if materialization.partition_by:
        partitions = ", ".join(f'"{identifier}"' for identifier in materialization.partition_by)
        options += f", PARTITION_BY ({partitions}), WRITE_PARTITION_COLUMNS"
    destination = root if materialization.partition_by else output_path
    connection.execute(
        f"COPY ({ordered_query}) TO {_sql_literal(str(destination))} ({options})",
        [refreshed_at, as_of_date],
    )
    generated = tuple(sorted(root.rglob("*.parquet"))) if materialization.partition_by else (output_path,)
    if not generated or any(not path.is_file() for path in generated):
        raise RuntimeError("materialization did not produce parquet files")
    row_count = sum(
        int(connection.execute("SELECT count(*) FROM read_parquet(?)", [str(path)]).fetchone()[0]) for path in generated
    )
    return MaterializationArtifacts(root, generated, row_count)
