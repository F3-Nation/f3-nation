"""Command-line preflight and bounded production-shaped run entry points."""

from __future__ import annotations

import argparse
import os
from datetime import datetime, timezone
from typing import Mapping, cast

from google.cloud import storage  # type: ignore[import-untyped]
from google.cloud.storage import Client as StorageClient  # type: ignore[import-untyped]

from .duckdb import connect
from .logging import JsonLogger
from .materializations import PRODUCTS, select_materializations
from .publication import GcsPublisher
from .run_id import RunId
from .settings import PointerSettings, Settings


def cloud_run_context(environ: Mapping[str, str]) -> dict[str, str]:
    context: dict[str, str] = {}
    if environ.get("CLOUD_RUN_JOB"):
        context["job"] = environ["CLOUD_RUN_JOB"]
    if environ.get("CLOUD_RUN_EXECUTION"):
        context["execution"] = environ["CLOUD_RUN_EXECUTION"]
    return context


def _storage_client() -> StorageClient:
    """Construct through the module so tests and callers can patch Client."""
    return storage.Client()


def main() -> int:
    parser = argparse.ArgumentParser(description="F3 Nation analytics foundation")
    parser.add_argument("--materialization", action="append", dest="global_materializations", metavar="NAME")
    commands = parser.add_subparsers(dest="command", required=True)
    preflight = commands.add_parser("preflight", help="validate configuration")
    run_parser = commands.add_parser("run", help="publish approved materializations")
    export_parser = commands.add_parser("export-local", help="write approved materializations to local disk")
    run_parser.add_argument("--product", choices=PRODUCTS)
    export_parser.add_argument("--product", choices=PRODUCTS, default="pax-vault")
    commands.add_parser("diagnostics", help="run bounded read-only ETL diagnostics")
    full_query_parser = commands.add_parser(
        "diagnostics-full-query", help="run approved full-query read-only diagnostics"
    )
    full_query_parser.add_argument(
        "--scanner-mode",
        choices=("binary-copy", "text-copy", "single-thread"),
        default="binary-copy",
        help="diagnostic-only PostgreSQL scanner mode",
    )
    commands.add_parser("diagnostics-staged-events", help="run approved staged pv_events diagnostic")
    commands.add_parser("diagnostics-ctas-events", help="run approved CTAS pv_events diagnostic")
    rollback_parser = commands.add_parser("rollback-pointer", help="CAS-select the retained previous release")
    rollback_parser.add_argument("--product", choices=PRODUCTS, required=True)
    rollback_parser.add_argument("--expected-generation", required=True)
    rollback_parser.add_argument("--release-id", required=True)
    for command_parser in (preflight, run_parser, export_parser):
        command_parser.add_argument(
            "--materialization", action="append", dest="command_materializations", metavar="NAME"
        )
    export_parser.add_argument("--output-dir", dest="command_output_dir", metavar="DIR")
    args = parser.parse_args()
    materialization_names = (args.global_materializations or []) + (getattr(args, "command_materializations", []) or [])
    if args.command == "export-local" and not args.command_output_dir:
        parser.error("export-local requires --output-dir")
    if (
        args.command in ("diagnostics-full-query", "diagnostics-staged-events", "diagnostics-ctas-events")
        and materialization_names
    ):
        parser.error(f"{args.command} does not accept materialization selectors")
    logger = JsonLogger()
    run_id = RunId.create()
    try:
        selected_product = getattr(args, "product", None) or "pax-vault"
        if args.command == "run" and materialization_names and args.product is None:
            parser.error("--product is required when selecting materializations for run")
        selected = (
            ()
            if args.command
            in (
                "diagnostics-full-query",
                "diagnostics-staged-events",
                "diagnostics-ctas-events",
                "rollback-pointer",
                "run",
            )
            else select_materializations(
                tuple(materialization_names) if materialization_names else None,
                **({"product": selected_product} if args.command in ("run", "export-local") else {}),
            )
        )
        if args.command == "rollback-pointer":
            pointer_settings = PointerSettings.from_env()
            rollback_time = datetime.now(timezone.utc).isoformat()
            rollback_order = str(RunId.create())
            pointer = GcsPublisher(
                _storage_client(), cast(Settings, pointer_settings), product=args.product
            ).rollback_pointer(
                args.release_id,
                expected_generation=args.expected_generation,
                source_order=rollback_order,
                producer_revision=pointer_settings.producer_revision,
                created_at=rollback_time,
            )
            logger.info(
                "analytics.etl.pointer_rollback_succeeded",
                pointer_release_sequence=pointer["releaseSequence"],
                release_id=args.release_id,
            )
        elif args.command == "preflight":
            settings = Settings.from_env()
            connection = connect(settings)
            connection.close()
            logger.info("analytics.etl.preflight_succeeded", run_id=str(run_id), environment=settings.environment)
        elif args.command == "export-local":
            settings = Settings.from_env()
            from pathlib import Path

            from .local_export import export_local

            export_local(
                settings,
                Path(args.command_output_dir),
                materializations=tuple(item.name for item in selected),
                run_id=str(run_id),
                product=selected_product,
            )
        elif args.command == "diagnostics":
            from .diagnostics import run_diagnostics

            settings = Settings.from_env()
            diagnostic_results = run_diagnostics(settings, logger=logger)
            failed_count = sum(item["status"] == "failed" for item in diagnostic_results.values())
            logger.info(
                "analytics.etl.diagnostics_completed",
                run_id=str(run_id),
                environment=settings.environment,
                probe_count=len(diagnostic_results),
                failed_count=failed_count,
            )
            if failed_count:
                return 1
        elif args.command == "diagnostics-full-query":
            from .diagnostics import run_full_query_diagnostics

            settings = Settings.from_env()
            diagnostic_results = run_full_query_diagnostics(settings, logger=logger, scanner_mode=args.scanner_mode)
            failed_count = sum(item["status"] == "failed" for item in diagnostic_results.values())
            logger.info(
                "analytics.etl.diagnostics_full_query_completed",
                run_id=str(run_id),
                environment=settings.environment,
                dataset_count=len(diagnostic_results),
                failed_count=failed_count,
                scanner_mode=args.scanner_mode,
            )
            if failed_count:
                return 1
        elif args.command == "diagnostics-staged-events":
            from .diagnostics import run_staged_events_diagnostic

            settings = Settings.from_env()
            diagnostic_result = run_staged_events_diagnostic(settings, logger=logger)
            failed_count = int(diagnostic_result["status"] == "failed")
            logger.info(
                "analytics.etl.diagnostics_staged_events_completed",
                run_id=str(run_id),
                environment=settings.environment,
                dataset_count=1,
                failed_count=failed_count,
            )
            if failed_count:
                return 1
        elif args.command == "diagnostics-ctas-events":
            from .diagnostics import run_ctas_events_diagnostic

            settings = Settings.from_env()
            diagnostic_result = run_ctas_events_diagnostic(settings, logger=logger)
            failed_count = int(diagnostic_result["status"] == "failed")
            logger.info(
                "analytics.etl.diagnostics_ctas_events_completed",
                run_id=str(run_id),
                environment=settings.environment,
                dataset_count=1,
                failed_count=failed_count,
            )
            if failed_count:
                return 1
        else:
            from .pipeline import BatchRunError, run

            settings = Settings.from_env()
            products = (args.product,) if args.product else PRODUCTS
            failed = False
            for product in products:
                product_run_id = str(RunId.create())
                try:
                    product_materializations = select_materializations(
                        tuple(materialization_names) if materialization_names else None,
                        product=product,
                    )
                    run(
                        settings,
                        _storage_client(),
                        logger=logger,
                        run_id=product_run_id,
                        execution_context=cloud_run_context(os.environ),
                        materializations=tuple(item.name for item in product_materializations),
                        product=product,
                    )
                except BatchRunError as error:
                    failed = True
                    dataset_failures = [
                        {"materialization": name, "type": type(failure).__name__}
                        for name, failure in sorted(error.failures.items())
                    ]
                    cleanup_failures = [
                        {"materialization": name, "cleanup": cleanup, "type": type(failure).__name__}
                        for name, cleanups in sorted(error.cleanup_failures.items())
                        for cleanup, failure in sorted(cleanups.items())
                    ]
                    logger.error(
                        "analytics.etl.cli_batch_failed",
                        run_id=product_run_id,
                        product=product,
                        dataset_failure_count=len(dataset_failures),
                        dataset_failures=dataset_failures,
                        cleanup_failure_count=len(cleanup_failures),
                        cleanup_failures=cleanup_failures,
                    )
                except Exception as error:
                    failed = True
                    logger.error("analytics.etl.cli_product_failed", error, run_id=product_run_id, product=product)
            if failed:
                return 1
        return 0
    except Exception as error:  # CLI boundary: report failure and return a shell-friendly status.
        logger.error("analytics.etl.cli_failed", error, run_id=str(run_id))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
