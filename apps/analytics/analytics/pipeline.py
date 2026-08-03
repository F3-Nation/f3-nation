"""The single approved region-roster pipeline."""

from __future__ import annotations

import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .duckdb import connect
from .lease import GcsLease, LeaseActiveError, LeaseHandle
from .logging import JsonLogger
from .publication import BigQueryPublisher, GcsPublisher, PointerConflictError, PublicationStatus, publish
from .run_id import RunId
from .settings import Settings
from .source import attach_postgres, materialize


def run(
    settings: Settings,
    storage_client: Any,
    bigquery_client: Any,
    connection_factory: Callable[[Settings], Any] = connect,
    logger: JsonLogger | None = None,
    now: Callable[[], datetime] | None = None,
    run_id: str | None = None,
    execution_context: dict[str, str] | None = None,
) -> PublicationStatus:
    log = logger or JsonLogger()
    clock = now or (lambda: datetime.now(timezone.utc))
    run_id_value = run_id or RunId.create(clock()).value
    source_read_at = clock().isoformat()
    started = time.perf_counter()
    stage = "lease_acquire"

    def emit(event: str, context: dict[str, Any]) -> None:
        log.info(event, **context)

    log.info("analytics.etl.started", run_id=run_id_value, environment=settings.environment)
    lease = GcsLease(storage_client, settings)
    lease_handle: LeaseHandle | None = None
    connection: Any | None = None
    try:
        lease_handle = lease.acquire(settings, run_id_value, execution_context or {}, clock())
        log.info("analytics.etl.lease_acquired", run_id=run_id_value, environment=settings.environment)
        connection = connection_factory(settings)
        stage = "source_read"
        source_started = time.perf_counter()
        with tempfile.TemporaryDirectory(prefix="analytics-") as workspace:
            attach_postgres(connection, settings)
            parquet_path = Path(workspace) / "regions.parquet"
            row_count = materialize(connection, parquet_path, source_read_at)
            log.info(
                "analytics.etl.source_read_completed",
                run_id=run_id_value,
                row_count=row_count,
                duration_ms=round((time.perf_counter() - source_started) * 1000, 3),
            )
            stage = "publication"
            result = publish(
                GcsPublisher(storage_client, settings),
                BigQueryPublisher(bigquery_client, settings),
                run_id_value,
                parquet_path,
                row_count,
                source_read_at,
                clock().isoformat(),
                emit=emit,
            )
            log.info(
                "analytics.etl.succeeded",
                run_id=run_id_value,
                row_count=row_count,
                duration_ms=round((time.perf_counter() - started) * 1000, 3),
            )
            return result
    except LeaseActiveError as error:
        log.error("analytics.etl.lease_active", **error.metadata)
        log.error(
            "analytics.etl.failed",
            error,
            run_id=run_id_value,
            stage=stage,
            duration_ms=round((time.perf_counter() - started) * 1000, 3),
        )
        raise
    except PointerConflictError as error:
        log.error("analytics.etl.pointer_conflict", **error.metadata)
        log.error(
            "analytics.etl.failed",
            error,
            run_id=run_id_value,
            stage="pointer_update",
            duration_ms=round((time.perf_counter() - started) * 1000, 3),
        )
        raise
    except BaseException as error:
        log.error(
            "analytics.etl.failed",
            error,
            run_id=run_id_value,
            stage=stage,
            duration_ms=round((time.perf_counter() - started) * 1000, 3),
        )
        raise
    finally:
        if connection is not None:
            try:
                connection.close()
            except BaseException as error:
                log.error("analytics.etl.cleanup_failed", error, run_id=run_id_value, cleanup="connection_close")
        if lease_handle is not None:
            try:
                lease.release(lease_handle, clock())
                log.info("analytics.etl.lease_released", run_id=run_id_value, environment=settings.environment)
            except BaseException as error:
                log.error("analytics.etl.cleanup_failed", error, run_id=run_id_value, cleanup="lease_release")
