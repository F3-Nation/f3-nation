"""Bounded, read-only diagnostics for the analytics source and materializations."""

from __future__ import annotations

import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .duckdb import connect
from .logging import JsonLogger
from .materializations import MATERIALIZATIONS_BY_NAME
from .settings import Settings
from .source import _sql_literal, attach_postgres, load_sql

_LIMIT = 100


def _probe_sql(query: str) -> str:
    return f"SELECT * FROM ({query}) AS diagnostic_sample LIMIT {_LIMIT}"


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
    started_at = datetime.now(timezone.utc)

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
                connection.close()

    probe(
        "postgres_scan",
        lambda db: {"row_count": int(db.execute("SELECT count(*) FROM pg.public.orgs").fetchone()[0])},
    )
    probe(
        "territory_count",
        lambda db: {
            "row_count": int(
                db.execute(
                    "SELECT count(*) FROM pg.public.orgs WHERE CAST(org_type AS VARCHAR) = 'territory'"
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
    for name in ("pv_sectors", "pv_areas"):
        definition = MATERIALIZATIONS_BY_NAME[name]
        query = _probe_sql(load_sql(definition))
        params = (started_at.isoformat(), started_at.date().isoformat())

        def query_probe(db: Any, query: str = query, params: tuple[str, str] = params) -> dict[str, Any]:
            return {"row_count": len(db.execute(query, params).fetchall())}

        probe(f"{name}_query", query_probe)

        def materialization_copy(
            db: Any, query: str = query, params: tuple[str, str] = params, name: str = name
        ) -> dict[str, Any]:
            with tempfile.TemporaryDirectory(prefix="analytics-diagnostic-") as directory:
                destination = Path(directory) / f"{name}.parquet"
                db.execute(
                    f"COPY ({query}) TO {_sql_literal(str(destination))} (FORMAT PARQUET, COMPRESSION ZSTD)",
                    params,
                )
                count = db.execute("SELECT count(*) FROM read_parquet(?)", [str(destination)]).fetchone()[0]
                return {"row_count": int(count)}

        probe(f"{name}_copy", materialization_copy)
    return results
