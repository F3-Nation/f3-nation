"""Command-line preflight and bounded production-shaped run entry points."""

from __future__ import annotations

import argparse
import os

from .duckdb import connect
from .logging import JsonLogger
from .materializations import select_materializations
from .run_id import RunId
from .settings import Settings


def main() -> int:
    parser = argparse.ArgumentParser(description="F3 Nation analytics foundation")
    parser.add_argument("--materialization", action="append", dest="global_materializations", metavar="NAME")
    commands = parser.add_subparsers(dest="command", required=True)
    preflight = commands.add_parser("preflight", help="validate configuration")
    run_parser = commands.add_parser("run", help="publish approved materializations")
    export_parser = commands.add_parser("export-local", help="write approved materializations to local disk")
    for command_parser in (preflight, run_parser, export_parser):
        command_parser.add_argument(
            "--materialization", action="append", dest="command_materializations", metavar="NAME"
        )
    export_parser.add_argument("--output-dir", dest="command_output_dir", metavar="DIR")
    args = parser.parse_args()
    materialization_names = (args.global_materializations or []) + (args.command_materializations or [])
    if args.command == "export-local" and not args.command_output_dir:
        parser.error("export-local requires --output-dir")
    logger = JsonLogger()
    run_id = RunId.create()
    try:
        selected = select_materializations(tuple(materialization_names) if materialization_names else None)
        settings = Settings.from_env()
        if args.command == "preflight":
            connection = connect(settings)
            connection.close()
            logger.info("analytics.etl.preflight_succeeded", run_id=str(run_id), environment=settings.environment)
        elif args.command == "export-local":
            from pathlib import Path

            from .local_export import export_local

            export_local(
                settings,
                Path(args.command_output_dir),
                materializations=tuple(item.name for item in selected),
                run_id=str(run_id),
            )
        else:
            from google.cloud.storage import Client as StorageClient  # type: ignore[import-untyped]

            from .lease import cloud_run_context
            from .pipeline import BatchRunError, run

            try:
                run(
                    settings,
                    StorageClient(),
                    logger=logger,
                    run_id=str(run_id),
                    execution_context=cloud_run_context(os.environ),
                    materializations=tuple(item.name for item in selected),
                )
            except BatchRunError as error:
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
                    run_id=str(run_id),
                    dataset_failure_count=len(dataset_failures),
                    dataset_failures=dataset_failures,
                    cleanup_failure_count=len(cleanup_failures),
                    cleanup_failures=cleanup_failures,
                )
                return 1
        return 0
    except Exception as error:  # CLI boundary: report failure and return a shell-friendly status.
        logger.error("analytics.etl.cli_failed", error, run_id=str(run_id))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
