"""Sequential materialization pipeline with one final release commit."""

from __future__ import annotations

import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from google.cloud.storage import Client as StorageClient  # type: ignore[import-untyped]

from .duckdb import connect
from .logging import JsonLogger
from .materializations import select_materializations
from .publication import (
    CatalogConflictError,
    GcsPublisher,
    PublicationStatus,
    build_release_manifest,
    publish,
)
from .run_id import RunId
from .settings import Settings
from .source import attach_postgres, materialize


class BatchRunError(RuntimeError):
    """Primary dataset failures and cleanup failures retained by registry name."""

    def __init__(
        self,
        failures: dict[str, BaseException],
        cleanup_failures: dict[str, dict[str, BaseException]] | None = None,
    ) -> None:
        super().__init__(f"analytics materializations failed: {', '.join(failures)}")
        self.failures = failures
        self.cleanup_failures = cleanup_failures or {}


def run(
    settings: Settings,
    storage_client: StorageClient,
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
    results: dict[str, PublicationStatus] = {}
    failures: dict[str, BaseException] = {}
    cleanup_failures: dict[str, dict[str, BaseException]] = {}
    started = time.perf_counter()
    if {item.name for item in definitions} != {item.name for item in select_materializations(None)}:
        raise ValueError("publication requires the exact approved materialization set")
    batch_source_order = clock().isoformat()

    def emit(event: str, context: dict[str, Any]) -> None:
        log.info(event, **context)

    log.info("analytics.etl.started", run_id=run_id_value, environment=settings.environment)
    for definition in definitions:
        connection: Any | None = None
        try:
            connection = connection_factory(settings)
            attach_postgres(connection, settings)
            with tempfile.TemporaryDirectory(prefix="analytics-") as workspace:
                source_started = time.perf_counter()
                root = Path(workspace) / definition.name
                source_timestamp = datetime.fromisoformat(batch_source_order)
                refreshed_at = source_timestamp.isoformat()
                as_of_date = source_timestamp.astimezone(timezone.utc).date().isoformat()
                artifacts = materialize(connection, root, definition, refreshed_at, as_of_date)
                log.info(
                    "analytics.etl.source_read_completed",
                    run_id=run_id_value,
                    materialization=definition.name,
                    row_count=artifacts.row_count,
                    duration_ms=round((time.perf_counter() - source_started) * 1000, 3),
                )
                dataset_published_at = clock().isoformat()
                results[definition.name] = publish(
                    GcsPublisher(storage_client, settings),
                    run_id_value,
                    artifacts,
                    refreshed_at,
                    dataset_published_at,
                    definition,
                    emit=emit,
                )
        except Exception as error:
            failures[definition.name] = error
            log.error("analytics.etl.dataset_failed", error, run_id=run_id_value, materialization=definition.name)
        finally:
            if connection is not None:
                try:
                    connection.close()
                except Exception as error:
                    cleanup_failures.setdefault(definition.name, {})["connection_close"] = error
                    log.error(
                        "analytics.etl.connection_close_failed",
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
        raise BatchRunError(failures, cleanup_failures)
    try:
        publisher = GcsPublisher(storage_client, settings)
        # Dataset uploads are staged. Capture publication time only at the
        # complete release/catalog commit boundary.
        batch_published_at = clock().isoformat()
        release = build_release_manifest(run_id_value, results, batch_published_at, batch_source_order)
        release_object = publisher.upload_release_manifest(run_id_value, release)
        catalog = publisher.commit_catalog(run_id_value, release_object, batch_source_order, emit=emit)
        results = {
            name: PublicationStatus(
                status.manifest,
                status.parquet_files,
                status.manifest_object,
                release_object,
                str(getattr(catalog, "metageneration", "")),
            )
            for name, status in results.items()
        }
        log.info(
            "analytics.etl.release_committed",
            run_id=run_id_value,
            materialization="batch",
            dataset_count=len(results),
            release_uri=release_object.uri,
            batch_source_order=batch_source_order,
            catalog_metageneration=str(getattr(catalog, "metageneration", "")),
            published_at=batch_published_at,
        )
    except CatalogConflictError as error:
        failures["batch"] = error
        log.error("analytics.etl.catalog_conflict", error, run_id=run_id_value, materialization="batch")
        raise BatchRunError(failures, cleanup_failures) from error
    except Exception as error:
        failures["batch"] = error
        log.error("analytics.etl.release_failed", error, run_id=run_id_value, materialization="batch")
        raise BatchRunError(failures, cleanup_failures) from error
    if cleanup_failures:
        log.info(
            "analytics.etl.succeeded_with_cleanup_failures",
            run_id=run_id_value,
            materialization="batch",
            dataset_count=len(results),
            cleanup_failure_count=sum(len(items) for items in cleanup_failures.values()),
            duration_ms=round((time.perf_counter() - started) * 1000, 3),
        )
        return results
    log.info(
        "analytics.etl.succeeded",
        run_id=run_id_value,
        materialization="batch",
        dataset_count=len(results),
        duration_ms=round((time.perf_counter() - started) * 1000, 3),
    )
    return results
