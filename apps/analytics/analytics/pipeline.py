"""Sequential, independently leased materialization pipeline."""

from __future__ import annotations

import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .duckdb import connect
from .lease import GcsLease, LeaseActiveError, LeaseConflictError, LeaseHandle
from .logging import JsonLogger
from .materializations import select_materializations
from .publication import (
    GcsPublisher,
    PointerConflictError,
    PublicationStatus,
    publish,
)
from .run_id import RunId
from .settings import Settings
from .source import attach_postgres, materialize


class BatchRunError(RuntimeError):
    """Every ordinary dataset failure, retained by its registry name."""

    def __init__(self, failures: dict[str, BaseException]) -> None:
        super().__init__(f"analytics materializations failed: {', '.join(failures)}")
        self.failures = failures


def run(
    settings: Settings,
    storage_client: Any,
    connection_factory: Callable[[Settings], Any] = connect,
    logger: JsonLogger | None = None,
    now: Callable[[], datetime] | None = None,
    run_id: str | None = None,
    execution_context: dict[str, str] | None = None,
    materializations: tuple[str, ...] | list[str] | None = None,
) -> dict[str, PublicationStatus]:
    log = logger or JsonLogger()
    clock = now or (lambda: datetime.now(timezone.utc))
    definitions = select_materializations(materializations)
    run_id_value = run_id or RunId.create(clock()).value
    refreshed_at = clock().isoformat()
    as_of_date = clock().astimezone(timezone.utc).date().isoformat()
    results: dict[str, PublicationStatus] = {}
    failures: dict[str, BaseException] = {}
    started = time.perf_counter()

    def emit(event: str, context: dict[str, Any]) -> None:
        log.info(event, **context)

    log.info("analytics.etl.started", run_id=run_id_value, environment=settings.environment)
    for definition in definitions:
        lease: GcsLease | None = None
        lease_handle: LeaseHandle | None = None
        connection: Any | None = None
        try:
            lease = GcsLease(storage_client, settings, definition)
            lease_handle = lease.acquire(settings, run_id_value, execution_context or {}, clock())
            log.info("analytics.etl.lease_acquired", run_id=run_id_value, materialization=definition.name)
            connection = connection_factory(settings)
            attach_postgres(connection, settings)
            with tempfile.TemporaryDirectory(prefix="analytics-") as workspace:
                source_started = time.perf_counter()
                parquet_path = Path(workspace) / definition.output_filename
                row_count = materialize(connection, parquet_path, definition, refreshed_at, as_of_date)
                log.info(
                    "analytics.etl.source_read_completed",
                    run_id=run_id_value,
                    materialization=definition.name,
                    row_count=row_count,
                    duration_ms=round((time.perf_counter() - source_started) * 1000, 3),
                )
                results[definition.name] = publish(
                    GcsPublisher(storage_client, settings, definition),
                    run_id_value,
                    parquet_path,
                    row_count,
                    refreshed_at,
                    clock().isoformat(),
                    definition,
                    emit=emit,
                )
        except (LeaseActiveError, LeaseConflictError, PointerConflictError) as error:
            metadata = dict(getattr(error, "metadata", {}))
            metadata["materialization"] = definition.name
            metadata["attempt_run_id"] = run_id_value
            failures[definition.name] = error
            event = (
                "analytics.etl.pointer_conflict"
                if isinstance(error, PointerConflictError)
                else "analytics.etl.lease_error"
            )
            log.error(event, error, **metadata)
        except Exception as error:
            failures[definition.name] = error
            log.error("analytics.etl.dataset_failed", error, run_id=run_id_value, materialization=definition.name)
        finally:
            if lease_handle is not None:
                try:
                    assert lease is not None
                    lease.release(lease_handle, clock())
                    log.info("analytics.etl.lease_released", run_id=run_id_value, materialization=definition.name)
                except Exception as error:
                    failures.setdefault(definition.name, error)
                    log.error(
                        "analytics.etl.cleanup_failed",
                        error,
                        run_id=run_id_value,
                        materialization=definition.name,
                        cleanup="lease_release",
                    )
            if connection is not None:
                try:
                    connection.close()
                except Exception as error:
                    failures.setdefault(definition.name, error)
                    log.error(
                        "analytics.etl.cleanup_failed",
                        error,
                        run_id=run_id_value,
                        materialization=definition.name,
                        cleanup="connection_close",
                    )
    if failures:
        log.error(
            "analytics.etl.failed",
            run_id=run_id_value,
            materialization="batch",
            dataset_count=len(failures),
            duration_ms=round((time.perf_counter() - started) * 1000, 3),
        )
        raise BatchRunError(failures)
    log.info(
        "analytics.etl.succeeded",
        run_id=run_id_value,
        materialization="batch",
        dataset_count=len(results),
        duration_ms=round((time.perf_counter() - started) * 1000, 3),
    )
    return results
