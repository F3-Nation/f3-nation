"""Sequential materialization pipeline with one final release commit."""

from __future__ import annotations

import hashlib
import json
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from google.cloud.storage import Client as StorageClient  # type: ignore[import-untyped]

from .duckdb import connect
from .logging import JsonLogger
from .materializations import MATERIALIZATIONS_BY_NAME, PRODUCTS, Materialization, select_materializations
from .publication import (
    GcsPublisher,
    PointerConflictError,
    PublicationStatus,
    build_release_manifest,
    publish,
)
from .run_id import RunId
from .settings import Settings
from .source import artifact_observability, attach_postgres, materialization_failure_phase, materialize


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


def _candidate_count_golden(connection: Any, artifacts: Any, definition: Materialization) -> dict[str, Any]:
    if MATERIALIZATIONS_BY_NAME.get(definition.name) is not definition:
        raise ValueError("candidate golden requires an allowlisted materialization")
    parquet_paths = [str(path) for path in artifacts.sorted_parquet_files]
    count = connection.execute(
        "SELECT COUNT(*) AS row_count FROM read_parquet(?)",
        [parquet_paths],
    ).fetchone()[0]
    if int(count) != artifacts.row_count:
        raise ValueError("candidate Parquet row count does not match materialization artifacts")
    query = f"SELECT COUNT(*) AS row_count FROM {definition.name}"
    artifact = json.dumps(
        [[{"$bigint": str(int(count))}]], ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return {
        "name": "candidate_transport_check",
        "query": query,
        "canonicalization": "rows-json-v1",
        "sha256": hashlib.sha256(artifact).hexdigest(),
        "artifact": artifact,
    }


def _pointer_conflict_outcome(error: PointerConflictError) -> str:
    detail = str(error).lower()
    if error.committed:
        return "committed_superseded" if "supersed" in detail else "committed"
    if "ambiguous" in detail:
        return "ambiguous"
    return "not_committed"


def run(
    settings: Settings,
    storage_client: StorageClient,
    connection_factory: Callable[[Settings], Any] = connect,
    logger: JsonLogger | None = None,
    now: Callable[[], datetime] | None = None,
    run_id: str | None = None,
    execution_context: dict[str, str] | None = None,
    materializations: tuple[str, ...] | list[str] | None = None,
    product: str = "pax-vault",
) -> dict[str, PublicationStatus]:
    log = logger or JsonLogger()
    clock = now or (lambda: datetime.now(timezone.utc))
    if product not in PRODUCTS:
        raise ValueError(f"unknown analytics product: {product}")
    definitions = select_materializations(materializations, product=product)
    run_id_value = run_id or RunId.create(clock()).value
    results: dict[str, PublicationStatus] = {}
    failures: dict[str, BaseException] = {}
    cleanup_failures: dict[str, dict[str, BaseException]] = {}
    started = time.perf_counter()
    approved_definitions = select_materializations(None, product=product)
    if tuple(item.name for item in definitions) != tuple(item.name for item in approved_definitions):
        raise ValueError("publication requires the exact approved materialization set for the product")
    batch_source_order = clock().astimezone(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")

    def emit(event: str, context: dict[str, Any]) -> None:
        log.info(event, **context)

    log.info("analytics.etl.started", run_id=run_id_value, environment=settings.environment)
    for definition in definitions:
        connection: Any | None = None
        root: Path | None = None
        artifact_state: dict[str, bool | str] | None = None
        try:
            connection = connection_factory(settings)
            attach_postgres(connection, settings)
            with tempfile.TemporaryDirectory(prefix="analytics-") as workspace:
                source_started = time.perf_counter()
                root = Path(workspace) / definition.name
                source_timestamp = clock()
                refreshed_at = source_timestamp.isoformat()
                as_of_date = source_timestamp.astimezone(timezone.utc).date().isoformat()
                try:
                    artifacts = materialize(connection, root, definition, refreshed_at, as_of_date)
                    log.info(
                        "analytics.etl.source_read_completed",
                        run_id=run_id_value,
                        materialization=definition.name,
                        row_count=artifacts.row_count,
                        duration_ms=round((time.perf_counter() - source_started) * 1000, 3),
                    )
                    assert connection is not None
                    golden = _candidate_count_golden(connection, artifacts, definition)
                    dataset_published_at = clock().isoformat()
                    results[definition.name] = publish(
                        GcsPublisher(storage_client, settings, product=product),
                        run_id_value,
                        artifacts,
                        refreshed_at,
                        dataset_published_at,
                        definition,
                        emit=emit,
                        goldens=(golden,),
                        source_order=batch_source_order,
                    )
                except Exception:
                    artifact_state = artifact_observability(root, definition)
                    raise
        except Exception as error:
            failures[definition.name] = error
            log.error(
                "analytics.etl.dataset_failed",
                error,
                run_id=run_id_value,
                materialization=definition.name,
                phase=materialization_failure_phase(error),
                **(artifact_state or artifact_observability(root, definition)),
            )
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
        publisher = GcsPublisher(storage_client, settings, product=product)
        # Dataset uploads are staged. Capture publication time only at the
        # complete release/pointer commit boundary.
        batch_published_at = clock().isoformat()
        release = build_release_manifest(
            run_id_value,
            results,
            batch_published_at,
            batch_source_order,
            product=product,
            producer_revision=settings.producer_revision,
        )
        release_object = publisher.upload_release_manifest(run_id_value, release)
        release_bytes = json.dumps(
            release, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
        ).encode("utf-8")
        pointer = publisher.commit_pointer(
            run_id_value,
            release_object,
            hashlib.sha256(release_bytes).hexdigest(),
            batch_source_order,
            settings.producer_revision,
            batch_published_at,
        )
        results = {
            name: PublicationStatus(
                status.manifest,
                status.parquet_files,
                status.manifest_object,
                release_object,
                None,
                pointer,
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
            pointer_release_sequence=pointer["releaseSequence"],
            published_at=batch_published_at,
        )
    except PointerConflictError as error:
        failures["batch"] = error
        outcome = _pointer_conflict_outcome(error)
        event = {
            "committed": "analytics.etl.pointer_commit_committed",
            "committed_superseded": "analytics.etl.pointer_commit_superseded",
            "ambiguous": "analytics.etl.pointer_commit_ambiguous",
            "not_committed": "analytics.etl.pointer_conflict",
        }[outcome]
        log.error(
            event,
            error,
            run_id=run_id_value,
            materialization="batch",
            pointer_outcome=outcome,
            pointer_committed=error.committed,
        )
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
