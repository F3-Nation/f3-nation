# Analytics DuckDB/Parquet ETL

The CLI publishes two independent products to the configured GCS bucket. Pax
Vault contains exactly nine datasets (`pv_regions`, `pv_pax`, `pv_kotter`,
`pv_upcoming`, `pv_sectors`, `pv_territories`, `pv_areas`, `pv_aos`,
`pv_events`) beneath `pax-vault/releases/<release-id>/` and uses only
`pax-vault/current.json`. Analytics contains exactly four datasets
(`event_info`, `future_event_info`, `attendance_info`, `missing_backblasts`)
beneath `analytics/releases/<release-id>/` and uses only
`analytics/current.json`. Each product has its own release IDs, contract,
immutable manifests, pointer, sequence, and retention. A `release.json` and all
dataset objects are validated before the one product pointer is replaced by
GCS object-generation CAS; there is no shared catalog or cross-product root.

`analytics-etl run` without `--product` runs Pax Vault and Analytics separately,
with separate run IDs and pointers. Choose one explicitly with
`--product=pax-vault` or `--product=analytics`. A publication run must include
the exact complete dataset set for the selected product; materialization
subsets are not publishable. `export-local` retains its explicit
`--product` selection and is not a publication path.

DuckDB's PostgreSQL extension is loaded from an explicit prebundled path; the
runtime never runs `INSTALL`. Source reads are sequential per dataset and are
not a shared database snapshot.

The ETL disables DuckDB PostgreSQL filter pushdown as a read-only correctness
workaround for the extension's `Unsupported table filter type` compatibility
issue. This can increase source read volume, so measure it in nonprod before
enabling production workloads.

Runtime targets are deliberately limited to two environments. Approved GCS
prefixes are selected from the immutable materialization registry; they are
never accepted as environment or CLI output targets.
`local` and `test` are explicit nonprod aliases only. Cloud Run uses the
matching Cloud SQL Unix socket; local connectivity requires separate operator
approval.
`ANALYTICS_PRODUCER_REVISION` is a validated safe slug recorded in release and
pointer metadata; production configuration requires it.

The product pointer is the only mutable publication object. Consumers resolve
one pointer, then read its pinned release manifest, dataset manifests, Parquet,
and candidate count goldens by generation. A stale source-order candidate is
rejected; rollback is limited to the validated retained previous release and
advances pointer sequence without lowering source high-water order. See
[`docs/ANALYTICS_ETL_OPERATIONS.md`](../../docs/ANALYTICS_ETL_OPERATIONS.md) for
the operator procedure and retention/IAM requirements.

Publication in production is **blocked**. The focused Phase 2 review passed for
controlled nonprod testing only; it is not a production review or signoff. No
production IAM/deployment action or live production validation is claimed.
External consumer compatibility/security signoff, source-plan/load review,
production IAM, staging race/rollback validation, unattended-invocation review,
and consumer cutover remain release gates. Keep the prior serving path and data
until consumer owners sign off; after cutover, do not continue dual-publishing
pointers. A synthetic DuckDB/fake-GCS integration test is not live SQL, IAM, or
GCS evidence.

## Local testing (safe and offline by default)

The normal local path does not need cloud credentials, a database, Cloud SQL,
Google ADC, or a DuckDB extension. It uses synthetic DuckDB fixtures and
mocked GCS client. Prerequisites are Python 3.13+, `uv`, and a
checkout of this repository. From the repository root, install dependencies and
run the unit tests and lint:

```bash
uv --directory apps/analytics sync --group dev
uv --directory apps/analytics run pytest
uv --directory apps/analytics run ruff check .
```

These commands are offline-safe: they do not publish data and the test suite
does not make live cloud or database calls. Do not create or populate an
`.env` file just to run them.

### Approved full-query diagnostic

`diagnostics-full-query` is a deliberately high-load diagnostic for the two
approved datasets `pv_kotter` and `pv_events` only. It loads each production
SQL resource once into a temporary DuckDB table, copies only that table to a
short-lived local Parquet file, and reads the file back using a fresh
read-only PostgreSQL-attached connection per dataset. It never creates a GCS
client, publishes, commits a product pointer, or runs the ETL pipeline:

```bash
ANALYTICS_ENVIRONMENT=local \
  uv --directory apps/analytics run analytics-etl diagnostics-full-query
```

The default scanner mode preserves DuckDB's binary PostgreSQL copy behavior.
For this diagnostic only, the explicitly approved text-copy mode can be
selected with `--scanner-mode=text-copy`; it sets
`pg_use_binary_copy = false` on each fresh diagnostic connection before the
read-only PostgreSQL attachment. The setting is not used by regular ETL or
the bounded `diagnostics` command.

The explicitly approved `--scanner-mode=single-thread` mode additionally
creates each diagnostic DuckDB connection with one execution thread and sets
the PostgreSQL connection limit to one before configuration locking. The
binary-copy default and text-copy mode do not change these settings.

Run this command only with explicit operator approval because it executes the
full production-shaped queries. Approval has been granted for the current
investigation; it is not standing approval for routine use. Selectors are not
accepted, and a failure in one dataset does not prevent the other dataset from
running. Logs contain only fixed phases, dataset names, counts, and exception
types—never SQL, rows, paths, exception messages, credentials, or PII.

### Approved staged `pv_events` diagnostic

`diagnostics-staged-events` is a separate, explicitly approved, high-load
non-publishing diagnostic. It extracts the projected `pv_events` source tables
through one read-only, forced-rollback Psycopg session in bounded chunks,
stages them into fixed local DuckDB tables, and executes the production
`pv_events` SQL locally exactly once. It does not attach PostgreSQL to DuckDB,
create a GCS client, publish, or persist an output artifact:

```bash
ANALYTICS_ENVIRONMENT=local \
  uv --directory apps/analytics run analytics-etl diagnostics-staged-events
```

This command can hold full projected analytics data, including PII, in memory
and DuckDB spill storage. Run it only with explicit security, platform, and
analytics-operator approval for the investigation; it is not routine ETL or a
safe production smoke test. It accepts no selectors and removes its private
temporary workspace during cleanup. Logs contain only fixed phases, table
names, counts, and exception types.

### Approved CTAS `pv_events` isolation diagnostic

`diagnostics-ctas-events` is the one-shot production-shaped isolation check.
It uses the stable DuckDB PostgreSQL attachment to stage each fixed `pv_events`
source projection with local CTAS statements, detaches PostgreSQL, and then
executes the exact production query against only the staged local schema:

```bash
ANALYTICS_ENVIRONMENT=local \
  uv --directory apps/analytics run analytics-etl diagnostics-ctas-events
```

It is fixed to `pv_events`, accepts no selectors, creates no Parquet or cloud
publication artifacts, and removes its private DuckDB spill workspace during
cleanup. This can hold full projected PII in memory or spill storage; run it
only under explicit security, platform, and analytics-operator approval. It
does not change the regular ETL or bounded diagnostics paths. A fixed
sub-60-minute watchdog uses DuckDB's supported connection interrupt mechanism
to cancel an active operation before the Cloud Run limit; cleanup still closes
the connection and removes the workspace. The reported row count is the final
local `pv_events` output count.

## Read-only ETL diagnostics

Run the bounded diagnostics command with the same validated settings used by
the ETL:

```bash
ANALYTICS_ENVIRONMENT=local uv --directory apps/analytics run analytics-etl diagnostics
```

In `local`, `test`, and `nonprod`, diagnostics retain the legacy DuckDB-scanner
checks for `orgs`, the territory predicate, a small local Parquet `COPY`, and
the `pv_sectors`/`pv_areas` hierarchy probes. Those legacy checks are not a
server-timeout guarantee. They run alongside the two bounded nested-shape
probes described below.

In `production`, the legacy checks are explicitly skipped. Only `pv_kotter`
and `pv_events` run, using a fresh DuckDB connection and a separate short-lived
Psycopg session for each probe; production diagnostics never attach the DuckDB
PostgreSQL scanner, use `postgres_query`, or copy directly from `pg.public`.
The Kotter and events probes use diagnostic SQL constants, not production SQL
resources, and each runs through exactly these phases:
`source_read` -> `query_aggregation` -> `local_parquet` (COPY/readback). The
Kotter and events source phases use a dedicated short-lived Psycopg 3 session,
set the connection read-only before opening a transaction, set a transaction-
local statement timeout, and force rollback on exit. Each uses one
parameterized SELECT whose stable event-ID sample and final output are ordered
and bounded to 100 rows. These are bounded nested-shape probes, not proof that
the production materialization paths execute successfully.

Fetched rows are staged into fresh DuckDB temporary tables with fixed schemas.
The Kotter aggregation builds bounded per-user lists of event STRUCTs; the
events aggregation builds bounded per-event attendance, event-type, and
event-tag STRUCT lists with typed empty-list defaults. The Parquet readback
checks every nested events column, and temporary files are removed inside the
local-parquet phase. Each successful phase emits a fixed-context
`diagnostic_phase_succeeded` event; failures emit `diagnostic_phase_failed`
with only the probe, phase, sample limit, and exception type.

Diagnostics never create a GCS client, publisher, release, or pointer object,
and never call the ETL pipeline or materialization code. Probe failures are
isolated by fresh connections, so one failed phase does not prevent later
probes. Logs contain only fixed probe/phase context, counts, the source sample
limit, and exception type—never raw SQL, rows or IDs, credentials, DSNs,
exception messages, or PII.

## Local-only export

`export-local` is the non-publication procedure for an approved local database
connection. It requires `ANALYTICS_ENVIRONMENT=local`, a validated local
PostgreSQL configuration, and an existing absolute output directory that is
not a symlink. Each invocation creates a unique persistent run directory below
that directory; `--materialization` may be repeated and is registry-validated.
It never creates a GCS client, publisher, or pointer publication.
The destination must have no group or other permissions (`chmod 700`); the CLI
rejects permissive directories.

```bash
umask 077
mkdir -p "$HOME/.local/share/f3-analytics/exports"
ANALYTICS_ENVIRONMENT=local \
  uv --directory apps/analytics run analytics-etl export-local \
  --output-dir "$HOME/.local/share/f3-analytics/exports" \
  --materialization pv_regions
```

This writes sensitive analytics data locally. Obtain explicit approval from the
responsible security/platform and analytics operators before connecting to any
real database or sharing the resulting files. This procedure is not approval
to run the publishing `run` command.

## Optional live end-to-end run

This is a publication test, not a harmless sandbox run. A local CLI `run`
reads the approved nonprod database and publishes separate releases/pointers
under the approved nonprod product roots. Without `--product` it runs both
products in sequence, each with its own release ID and CAS. Add
`--product=pax-vault` or `--product=analytics` to run one product only. Run it
only with explicit approval from
the responsible security/platform and analytics operators. It requires real
read-only PostgreSQL credentials, approved database connectivity, a real signed
DuckDB 1.5.5 `postgres_scanner` extension at the configured version/platform
path, and Google Application Default Credentials (ADC) with the narrowly
scoped nonprod permissions. An empty extension placeholder is not valid. Never
use production targets or put credentials in logs or source control.

Read [`docs/LOCAL_DEV_SETUP.md`](../../docs/LOCAL_DEV_SETUP.md) first. Use the
operator-approved database connectivity. Cloud Run continues to use its Unix
socket. Sign in for
both ordinary gcloud access and ADC, then request the approved least-privilege
database, GCS, and Cloud SQL access from the platform/security
owners:

```bash
gcloud auth login
gcloud auth application-default login
```

### Obtain and verify the local DuckDB extension

Use DuckDB **1.5.5** and the architecture of the runtime that will execute the
local CLI. Use an isolated extension directory; never copy an extension across
operating systems or architectures. The Docker image's extension artifact is
Linux amd64 only and is not suitable for a Mac/ARM local runtime.

The commands below are Bash-specific; run them in Bash, not Fish. DuckDB 1.5.5
does not reliably expose usable `extension_path` metadata in
`duckdb_extensions()`, so discovery deliberately searches the isolated
directory instead.

The following is a one-time preparation step, not an ETL runtime operation:

```bash
EXT_DIR="$(cd "$HOME" && pwd)/.cache/f3-analytics/duckdb-1.5.5-$(uname -s)-$(uname -m)"
mkdir -p "$EXT_DIR"
export EXT_DIR
uv --directory apps/analytics run python -c '
import os
import duckdb

if duckdb.__version__ != "1.5.5":
    raise SystemExit(f"expected DuckDB 1.5.5, got {duckdb.__version__}")
connection = duckdb.connect()
extension_dir = os.environ["EXT_DIR"].replace(chr(39), chr(39) * 2)
connection.execute(f"SET extension_directory = {chr(39)}{extension_dir}{chr(39)}")
connection.execute("INSTALL postgres FROM core")
print(f"duckdb.__version__={duckdb.__version__}")
connection.close()
'
```

Discover the one extension file produced in that isolated directory and obtain
its absolute path. The discovery command prints only that path to stdout so it
is safe for command substitution:

```bash
EXT_PATH="$(uv --directory apps/analytics run python -c '
import os
from pathlib import Path
import duckdb

if duckdb.__version__ != "1.5.5":
    raise SystemExit(f"expected DuckDB 1.5.5, got {duckdb.__version__}")
extension_dir = Path(os.environ["EXT_DIR"]).resolve()
candidates = sorted(extension_dir.rglob("postgres*.duckdb_extension"))
if len(candidates) != 1:
    raise SystemExit(f"expected exactly one postgres extension, found {len(candidates)}")
print(candidates[0].resolve())
')"
export DUCKDB_EXTENSION_DIR="$EXT_DIR"
export DUCKDB_POSTGRES_EXTENSION_PATH="$EXT_PATH"
uv --directory apps/analytics run python -c '
import os
import duckdb

if duckdb.__version__ != "1.5.5":
    raise SystemExit(f"expected DuckDB 1.5.5, got {duckdb.__version__}")
connection = duckdb.connect()
extension_path = os.environ["DUCKDB_POSTGRES_EXTENSION_PATH"]
connection.load_extension(extension_path)
quote = chr(39)
extension_names = "(" + quote + "postgres" + quote + "," + quote + "postgres_scanner" + quote + ")"
rows = connection.execute("SELECT extension_name, loaded, installed, extension_version, installed_from FROM duckdb_extensions() WHERE extension_name IN " + extension_names).fetchall()
valid_rows = [row for row in rows if row[1] is True and row[2] is True and row[3] and row[4]]
if not valid_rows:
    raise SystemExit(f"postgres extension status was not verified: {rows}")
print(f"loaded={extension_path}")
for row in valid_rows:
    print(f"name={row[0]} loaded={row[1]} installed={row[2]} version={row[3]} installed_from={row[4]}")
connection.close()
'
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$DUCKDB_POSTGRES_EXTENSION_PATH"
else
  shasum -a 256 "$DUCKDB_POSTGRES_EXTENSION_PATH"
fi
```

Record the SHA-256 and the DuckDB version, architecture, and
`installed_from` value. DuckDB's current extension name is `postgres`, although
the existing project configuration and file/path may still use
`postgres_scanner`. The ETL runtime only loads the configured file; it never
runs `INSTALL`.

Copy the example only for an approved live run. After the extension step above,
replace the two blank DuckDB values in the copied file with the exact absolute
`EXT_DIR` and `EXT_PATH` values discovered above. Do not use Docker's `/opt`
paths. Leave `ANALYTICS_POSTGRES_SOCKET_DIR` unset; the local endpoint is only
the approved database endpoint. Then source the completed file and explicitly re-assert the
discovered paths after sourcing so the file cannot silently replace working
exports:

```bash
umask 077
ANALYTICS_ENV_FILE="$(mktemp "${TMPDIR:-/tmp}/analytics.env.XXXXXX")"
trap 'rm -f "$ANALYTICS_ENV_FILE"' EXIT
cp apps/analytics/.env.example "$ANALYTICS_ENV_FILE"
# Edit "$ANALYTICS_ENV_FILE"; set the two absolute DuckDB paths from above,
# set the approved nonprod values and a validated ANALYTICS_PRODUCER_REVISION
# where required, and do not commit this file.
unset ANALYTICS_POSTGRES_SOCKET_DIR
set -a; . "$ANALYTICS_ENV_FILE"; set +a
unset ANALYTICS_POSTGRES_SOCKET_DIR
export DUCKDB_EXTENSION_DIR="$EXT_DIR"
export DUCKDB_POSTGRES_EXTENSION_PATH="$EXT_PATH"
```

Run this safe diagnostics check before preflight. It prints only a validation
message and never prints configuration values or credentials:

```bash
uv --directory apps/analytics run python -c '
from analytics.settings import Settings, SettingsError

try:
    Settings.from_env()
except SettingsError as error:
    print(f"SettingsError: {error}")
'
```

Verify the targets remain exactly the approved nonprod values, then run:

```bash
ANALYTICS_ENVIRONMENT=local \
  uv --directory apps/analytics run analytics-etl preflight
ANALYTICS_ENVIRONMENT=local \
  uv --directory apps/analytics run analytics-etl run --product=pax-vault
```

The local CLI uses the current checkout and the caller's ADC; it is not the
deployed job. To execute the deployed nonprod Cloud Run Job instead, obtain
the same explicit human approval and run the deployed immutable image with its
nonprod runtime identity:

```bash
gcloud run jobs execute analytics-etl-nonprod \
  --project f3data --region us-central1 --wait
```

Record the approver, reason, image revision, start time, and outcome. The
Cloud Run execution is a separate operation from running the local CLI.

## Remaining external release gates

Before enabling production:

1. The Analytics tagged deployment is staging-only by default
   (`deploy_prod=false`). Enabling production deployment later requires a
   separate reviewed workflow change; do not bypass that default.
2. Before any production image deployment, inventory enabled Cloud Scheduler
   jobs and every other unattended invocation path that can trigger the updated
   `analytics-etl` job. Verify no enabled path can run it. If one exists, either
   obtain human approval to suspend it and confirm suspension, or complete all
   production release gates before deploying while accepting that it may run
   immediately. Tie production GitHub environment reviewer approval to recorded
   evidence of this check and its disposition. Do not assume a reviewer is
   currently configured; verify the environment policy.
3. Run `actionlint` for the deployment workflows.
4. Create the approved nonprod/production runtime identities, Scheduler invoker
   identity, read-only database roles, Secret Manager versions, and narrowly
   scoped GCS IAM bindings. See
   [`docs/ANALYTICS_ETL_OPERATIONS.md`](../../docs/ANALYTICS_ETL_OPERATIONS.md).
5. Deploy and manually execute `analytics-etl-nonprod`; verify Unix-socket
   access, database write denial, immutable release objects, last-object
   `release.json` validation, product-specific pointer generation CAS, and
   source-order behavior.
6. Verify failed-release, stale-run, rollback, and alert handling with the configured log
   alerts before approving production.
7. After human approval of the daily cron and timezone, provision the production
   Scheduler with `scripts/provision-analytics-scheduler.sh`, then confirm its
   OAuth dispatch and the completed Cloud Run execution separately.

## Docker

The Dockerfile expects the repository root as its build context:

```bash
docker build --platform=linux/amd64 -f apps/analytics/Dockerfile -t f3-analytics .
docker run --rm f3-analytics
```

The image resolves the exact DuckDB version from `uv.lock` and uses DuckDB's
signed extension repository to download/install the matching platform-specific
`postgres_scanner` extension only during the image build. That DuckDB 1.5.5 /
Linux x86_64 pairing is the image-build-tested target. The prebundled
`linux_amd64` extension SHA-256 is
`b1ced4cfc6311313e117c2afb3eac76508718778dde0716421503c7dbfb5605c`;
cross-platform deploy builds must select the corresponding build platform.
