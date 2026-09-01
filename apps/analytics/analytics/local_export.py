"""Local-only Parquet export with no publication or cloud dependencies."""

from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path
from shutil import rmtree
from stat import S_IMODE
from typing import Any, Callable

from .duckdb import connect
from .logging import JsonLogger
from .materializations import select_materializations
from .run_id import RunId
from .settings import Settings, SettingsError
from .source import MaterializationArtifacts, attach_postgres, materialize


def _run_directory(output_dir: Path, run_id: str) -> Path:
    try:
        validated = RunId(run_id)
    except (TypeError, ValueError) as error:
        raise ValueError("invalid run identifier") from error
    candidate = output_dir / validated.value
    if candidate.exists() or candidate.is_symlink():
        raise ValueError("output run directory already exists")
    return candidate


def _validate_output_dir(value: Path) -> Path:
    if not value.is_absolute() or value.is_symlink() or not value.is_dir():
        raise ValueError("--output-dir must be an existing absolute, non-symlink directory")
    if S_IMODE(value.stat().st_mode) & 0o077:
        raise ValueError("--output-dir must be private; use chmod 700 on the directory")
    return value


def export_local(
    settings: Settings,
    output_dir: Path,
    materializations: tuple[str, ...] | list[str] | None = None,
    connection_factory: Callable[[Settings], Any] = connect,
    logger: JsonLogger | None = None,
    now: Callable[[], datetime] | None = None,
    run_id: str | None = None,
) -> dict[str, MaterializationArtifacts]:
    """Materialize approved datasets below one unique, persistent local run directory."""
    if settings.environment != "local":
        raise SettingsError("export-local requires ANALYTICS_ENVIRONMENT=local")
    root = _validate_output_dir(output_dir)
    definitions = select_materializations(materializations)
    clock = now or (lambda: datetime.now(timezone.utc))
    run_id_value = run_id or RunId.create(clock()).value
    final_root = _run_directory(root, run_id_value)
    staging_root = root / f".staging-{run_id_value}"
    try:
        staging_root.mkdir(mode=0o700)
    except FileExistsError as error:
        raise ValueError("output staging directory already exists") from error
    connection: Any | None = None
    primary_error: BaseException | None = None
    started = time.perf_counter()
    log = logger or JsonLogger()
    try:
        connection = connection_factory(settings)
        attach_postgres(connection, settings)
        refreshed_at = clock().isoformat()
        as_of_date = clock().astimezone(timezone.utc).date().isoformat()
        results: dict[str, MaterializationArtifacts] = {}
        for definition in definitions:
            artifacts = materialize(connection, staging_root / definition.name, definition, refreshed_at, as_of_date)
            results[definition.name] = artifacts
            log.info(
                "analytics.etl.local_export_materialized",
                run_id=run_id_value,
                materialization=definition.name,
                row_count=artifacts.row_count,
            )
        staging_root.replace(final_root)
        results = {
            name: MaterializationArtifacts(
                final_root / name,
                tuple(final_root / path.relative_to(staging_root) for path in artifacts.parquet_files),
                artifacts.row_count,
            )
            for name, artifacts in results.items()
        }
        log.info(
            "analytics.etl.local_export_succeeded",
            run_id=run_id_value,
            dataset_count=len(results),
            duration_ms=round((time.perf_counter() - started) * 1000, 3),
        )
        return results
    except BaseException as error:
        primary_error = error
        try:
            rmtree(staging_root)
        except Exception as cleanup_error:
            failed_root = root / f".failed-{run_id_value}"
            try:
                staging_root.replace(failed_root)
            except Exception as quarantine_error:
                log.error("analytics.etl.local_export_cleanup_failed", quarantine_error, run_id=run_id_value)
            else:
                log.error("analytics.etl.local_export_cleanup_failed", cleanup_error, run_id=run_id_value)
        raise
    finally:
        if connection is not None:
            try:
                connection.close()
            except Exception as close_error:
                log.error("analytics.etl.local_export_close_failed", close_error, run_id=run_id_value)
                if primary_error is None:
                    raise
