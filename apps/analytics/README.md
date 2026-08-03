# Analytics region-roster ETL

Phase 3 materializes only the approved region roster/vocabulary dataset. It
reads the six PostgreSQL base tables through DuckDB's read-only PostgreSQL
attachment, writes one local Snappy Parquet file, and publishes an immutable
run object plus manifest to GCS before updating the configured BigQuery
external table. The current pointer is advanced last with a GCS generation
precondition; this is intentionally not a cross-service atomic transaction.
DuckDB's PostgreSQL extension is loaded from an explicit prebundled path; the
runtime never runs `INSTALL`.

Runtime targets are deliberately limited to two environments. `nonprod` uses
`gs://analytics-nonprod/parquets/pv_regions` and
`f3data.paxVaultDuckStaging.pv_regions`; `production` uses
`gs://analytics/parquets/pv_regions` and `f3data.paxVaultDuck.pv_regions`.
`local` and `test` are explicit nonprod aliases only. PostgreSQL is reached
through the matching Cloud SQL Unix socket:
`/cloudsql/f3data:us-central1:f3data-nonprod` or
`/cloudsql/f3data:us-central1:f3data`.

Each publication acquires a 90-minute generation-conditional GCS lease before
reading PostgreSQL. Active leases reject the run; expired leases may be taken
over. Leases are released by a generation-conditional state update, never by
deletion.

If BigQuery succeeds but the pointer generation conflicts, the safe recovery is
to rerun the complete ETL after concurrent publishers quiesce. There is no
pointer-only retry API; the rerun creates a new immutable run and realigns the
external table and current pointer.

## Local setup

From the repository root:

```bash
uv sync --package f3-nation-analytics --group dev
cp apps/analytics/.env.example /tmp/analytics.env
```

Set every value in the copied file, including the read-only PostgreSQL
credential. `ANALYTICS_GCS_PREFIX` must be the approved `gs://` prefix and
`ANALYTICS_BIGQUERY_TABLE` must be the fully qualified `project.dataset.table`
identifier. Do not put credentials in logs or source control.

Local preflight requires a real, signed DuckDB 1.4.3 `postgres_scanner`
extension in the configured version/platform directory; an empty placeholder
is not valid. The Docker build below is the supported way to obtain that
prebundled artifact. With a real artifact in place:

```bash
set -a; . /tmp/analytics.env; set +a
ANALYTICS_ENVIRONMENT=local \
  uv run --package f3-nation-analytics analytics-etl preflight
```

With Google ADC configured and a reachable read-only database, run the POC
with:

```bash
uv run --package f3-nation-analytics analytics-etl run
```

Tests use DuckDB synthetic fixtures and mocked GCS/BigQuery clients; no live
cloud or database calls are made by the test suite.

Run checks with `uv run --package f3-nation-analytics pytest` and
`uv run --package f3-nation-analytics ruff check apps/analytics`.

## Remaining external release gates

Before enabling production:

1. Run `actionlint` for the deployment workflows.
2. Create the approved nonprod/production runtime identities, Scheduler invoker
   identity, read-only database roles, Secret Manager versions, and bucket/
   BigQuery IAM bindings. See
   [`docs/ANALYTICS_ETL_OPERATIONS.md`](../../docs/ANALYTICS_ETL_OPERATIONS.md).
3. Deploy and manually execute `analytics-etl-nonprod`; verify Unix-socket
   access, database write denial, immutable GCS objects and lease behavior,
   BigQuery replacement, and pointer/table agreement.
4. Verify failure, stale-pointer, and alert handling with the configured log
   alerts before approving production.
5. Provision the production Scheduler at `0 6 * * *` UTC with
   `scripts/provision-analytics-scheduler.sh`, then confirm its OAuth dispatch
   and the completed Cloud Run execution separately.

## Docker

The Dockerfile expects the repository root as its build context:

```bash
docker build --platform=linux/amd64 -f apps/analytics/Dockerfile -t f3-analytics .
docker run --rm f3-analytics
```

The image resolves the exact DuckDB version from `uv.lock` and uses DuckDB's
signed extension repository to download/install the matching platform-specific
`postgres_scanner` extension only during the image build. That DuckDB 1.4.3 /
Linux x86_64 pairing is the image-build-tested target; cross-platform deploy
builds must select the corresponding build platform.
