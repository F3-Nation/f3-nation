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

_MATERIALIZATION_PHASES = frozenset(
    {"load_sql", "prepare", "copy_query_to_parquet", "parquet_discovery", "parquet_readback"}
)
_TINY_FILE_SIZE = 4 << 10
_SMALL_FILE_SIZE = 1 << 20
_MEDIUM_FILE_SIZE = 100 << 20


def _sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _mark_materialization_phase(error: BaseException, phase: str) -> None:
    try:
        vars(error)["materialization_phase"] = phase
    except Exception:
        pass


def materialization_failure_phase(error: BaseException) -> str:
    phase = getattr(error, "materialization_phase", None)
    return phase if phase in _MATERIALIZATION_PHASES else "unknown"


def _has_parquet_footer(path: Path) -> bool:
    try:
        with path.open("rb") as output:
            if output.seek(0, 2) < 4:
                return False
            output.seek(-4, 2)
            return output.read(4) == b"PAR1"
    except OSError:
        return False


def artifact_observability(root: Path | None, materialization: Materialization) -> dict[str, bool | str]:
    """Return bounded artifact state without exposing filesystem details."""
    if root is None:
        return {"output_exists": False, "output_size_bucket": "unknown", "output_footer_par1": False}
    files: tuple[Path, ...] = ()
    try:
        files = (
            tuple(path for path in root.rglob("*.parquet") if path.is_file())
            if materialization.partition_by
            else (
                (root / materialization.output_filename,) if (root / materialization.output_filename).is_file() else ()
            )
        )
        total_size = sum(path.stat().st_size for path in files)
    except OSError:
        return {"output_exists": bool(files), "output_size_bucket": "unknown", "output_footer_par1": False}
    if not files:
        bucket = "none"
    elif total_size == 0:
        bucket = "zero"
    elif total_size <= _TINY_FILE_SIZE:
        bucket = "tiny"
    elif total_size < _SMALL_FILE_SIZE:
        bucket = "small"
    elif total_size < _MEDIUM_FILE_SIZE:
        bucket = "medium"
    else:
        bucket = "large"
    footer_par1 = False
    if files:
        footer_par1 = all(_has_parquet_footer(path) for path in files)
    return {"output_exists": bool(files), "output_size_bucket": bucket, "output_footer_par1": footer_par1}


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
    try:
        query = load_sql(materialization)
    except Exception as error:
        _mark_materialization_phase(error, "load_sql")
        raise
    try:
        root.mkdir(parents=True, exist_ok=True)
    except Exception as error:
        _mark_materialization_phase(error, "prepare")
        raise
    output_path = root / materialization.output_filename
    identifiers = (*materialization.partition_by, *materialization.sort_by)
    if any(not identifier.isidentifier() for identifier in identifiers):
        raise ValueError("materialization contains an unsafe identifier")
    order = ", ".join(f'"{identifier}"' for identifier in materialization.sort_by)
    ordered_query = f"SELECT * FROM ({query}) AS materialized"
    if order:
        ordered_query += f" ORDER BY {order}"
    options = "FORMAT PARQUET, COMPRESSION ZSTD"
    if materialization.partition_by:
        partitions = ", ".join(f'"{identifier}"' for identifier in materialization.partition_by)
        options += f", PARTITION_BY ({partitions}), WRITE_PARTITION_COLUMNS"
    destination = root if materialization.partition_by else output_path
    try:
        connection.execute(
            f"COPY ({ordered_query}) TO {_sql_literal(str(destination))} ({options})",
            [refreshed_at, as_of_date],
        )
    except Exception as error:
        _mark_materialization_phase(error, "copy_query_to_parquet")
        raise
    try:
        generated = tuple(sorted(root.rglob("*.parquet"))) if materialization.partition_by else (output_path,)
    except Exception as error:
        _mark_materialization_phase(error, "parquet_discovery")
        raise
    if not generated or any(not path.is_file() for path in generated):
        missing_output = RuntimeError("materialization did not produce parquet files")
        _mark_materialization_phase(missing_output, "parquet_discovery")
        raise missing_output
    try:
        row_count = sum(
            int(connection.execute("SELECT count(*) FROM read_parquet(?)", [str(path)]).fetchone()[0])
            for path in generated
        )
    except Exception as error:
        _mark_materialization_phase(error, "parquet_readback")
        raise
    return MaterializationArtifacts(root, generated, row_count)
