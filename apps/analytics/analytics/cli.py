"""Command-line preflight and bounded production-shaped run entry points."""

from __future__ import annotations

import argparse
import os

from .duckdb import connect
from .lease import cloud_run_context
from .logging import JsonLogger
from .materializations import select_materializations
from .pipeline import run
from .run_id import RunId
from .settings import Settings


def main() -> int:
    parser = argparse.ArgumentParser(description="F3 Nation analytics foundation")
    parser.add_argument("command", choices=("preflight", "run"), help="validate or execute analytics")
    parser.add_argument("--materialization", action="append", dest="materializations", metavar="NAME")
    args = parser.parse_args()
    logger = JsonLogger()
    run_id = RunId.create()
    try:
        selected = select_materializations(tuple(args.materializations) if args.materializations else None)
        settings = Settings.from_env()
        if args.command == "preflight":
            connection = connect(settings)
            connection.close()
            logger.info("analytics.etl.preflight_succeeded", run_id=str(run_id), environment=settings.environment)
        else:
            from google.cloud import bigquery
            from google.cloud.storage import Client as StorageClient

            run(
                settings,
                StorageClient(),
                bigquery.Client(),
                logger=logger,
                run_id=str(run_id),
                execution_context=cloud_run_context(os.environ),
                materializations=tuple(item.name for item in selected),
            )
        return 0
    except Exception as error:  # CLI boundary: report failure and return a shell-friendly status.
        logger.error("analytics.etl.failed", error, run_id=str(run_id))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
