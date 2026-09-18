# Analytics region-roster ETL

The analytics job reads PostgreSQL through DuckDB's read-only PostgreSQL
attachment, writes Parquet, and publishes one immutable nine-dataset batch to
GCS. Objects and dataset manifests live under
`parquets/releases/<run-id>/<dataset>/`; `release.json` is written last as the
commit record. A fixed `parquets/catalog.json` has immutable empty content and
metadata-only, metageneration-CAS discovery fields. There are no per-dataset
leases or `current.json` pointers.
DuckDB's PostgreSQL extension is loaded from an explicit prebundled path; the
runtime never runs `INSTALL`.

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

Only the exact approved nine-dataset registry may publish or advance the
global catalog; subset runs are rejected before source access. If a dataset or
validation fails, no release or catalog metadata is committed. Reruns create a
new immutable run; lifecycle policy cleans unreachable staged objects.

Consumers read catalog metadata, retrieve the pinned release manifest
generation, then consume exactly its nine pinned dataset manifests and listed
object generations. Source order is the logical batch-start ordering value,
not a database-wide snapshot; it is monotonic and stale runs fail safely. A human
rollback may select the retained previous generation-pinned release through the
explicit catalog metadata-CAS operation, retaining the source high-water mark.
PAX Vault compatibility and rollout are external consumer-owner dependencies
and must be verified before catalog activation.

## Local testing (safe and offline by default)

The normal local path does not need cloud credentials, a database, Cloud SQL,
Google ADC, or a DuckDB extension. It uses synthetic DuckDB fixtures and
mocked GCS client. Prerequisites are Python 3.12+, `uv`, and a
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

Diagnostics never create a GCS client, publisher, release, or catalog object,
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
It never creates a GCS client, publisher, or catalog publication.
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
reads the approved nonprod database and publishes to the approved nonprod GCS
prefix. Run it only with explicit approval from
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
# set the approved nonprod values, and do not commit this file.
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
  uv --directory apps/analytics run analytics-etl run
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

1. Run `actionlint` for the deployment workflows.
2. Create the approved nonprod/production runtime identities, Scheduler invoker
   identity, read-only database roles, Secret Manager versions, and narrowly
   scoped GCS IAM bindings. See
   [`docs/ANALYTICS_ETL_OPERATIONS.md`](../../docs/ANALYTICS_ETL_OPERATIONS.md).
3. Deploy and manually execute `analytics-etl-nonprod`; verify Unix-socket
   access, database write denial, immutable release objects, last-object
   `release.json` commit, catalog metadata CAS, and source-order behavior.
4. Verify failed-release, stale-run, rollback, and alert handling with the configured log
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
`postgres_scanner` extension only during the image build. That DuckDB 1.5.5 /
Linux x86_64 pairing is the image-build-tested target. The prebundled
`linux_amd64` extension SHA-256 is
`b1ced4cfc6311313e117c2afb3eac76508718778dde0716421503c7dbfb5605c`;
cross-platform deploy builds must select the corresponding build platform.
