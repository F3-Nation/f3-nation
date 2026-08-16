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
`gs://f3-analytics-nonprod/parquets/pv_regions` and
`f3data.paxVaultDuckStaging.pv_regions`; `production` uses
`gs://analytics/parquets/pv_regions` and `f3data.paxVaultDuck.pv_regions`.
`local` and `test` are explicit nonprod aliases only. Cloud Run uses the
matching Cloud SQL Unix socket; an approved local run may instead use the
documented proxy at `localhost` on a developer-chosen port.

Each publication acquires a 90-minute generation-conditional GCS lease before
reading PostgreSQL. Active leases reject the run; expired leases may be taken
over. Leases are released by a generation-conditional state update, never by
deletion.

If BigQuery succeeds but the pointer generation conflicts, the safe recovery is
to rerun the complete ETL after concurrent publishers quiesce. There is no
pointer-only retry API; the rerun creates a new immutable run and realigns the
external table and current pointer.

## Local testing (safe and offline by default)

The normal local path does not need cloud credentials, a database, Cloud SQL,
Google ADC, or a DuckDB extension. It uses synthetic DuckDB fixtures and
mocked GCS/BigQuery clients. Prerequisites are Python 3.12+, `uv`, and a
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

## Optional live end-to-end run

This is a publication test, not a harmless sandbox run. A local CLI `run`
reads the approved nonprod database and publishes to the approved nonprod GCS
prefix and BigQuery external table. Run it only with explicit approval from
the responsible security/platform and analytics operators. It requires real
read-only PostgreSQL credentials, a running Cloud SQL Auth Proxy, a real signed
DuckDB 1.4.3 `postgres_scanner` extension at the configured version/platform
path, and Google Application Default Credentials (ADC) with the narrowly
scoped nonprod permissions. An empty extension placeholder is not valid. Never
use production targets or put credentials in logs or source control.

Read [`docs/LOCAL_DEV_SETUP.md`](../../docs/LOCAL_DEV_SETUP.md) first. Start the
documented proxy in a separate terminal:

```bash
PROXY_PORT=5433  # choose a free local port, then use the same value below
cloud-sql-proxy f3data:us-central1:f3data-nonprod --port "$PROXY_PORT"
```

Keep the proxy running for the entire local run. Set
`ANALYTICS_POSTGRES_HOST=localhost` and
`ANALYTICS_POSTGRES_PORT="$PROXY_PORT"` in the local env file; the port must
match the `--port` value exactly. Cloud Run continues to use its Unix socket,
with no deployment change. Sign in for
both ordinary gcloud access and ADC, then request the approved least-privilege
database, storage, BigQuery, and Cloud SQL access from the platform/security
owners:

```bash
gcloud auth login
gcloud auth application-default login
```

### Platform-owner IAM template (do not run without approval)

This is a review template, not an approved grant. Platform/security owners
must first check custom-role support, IAM condition compatibility, organization
policy inheritance, and table/permission behavior. They must also use Policy
Troubleshooter before approval. Do not substitute broader predefined roles or
real account identifiers for the placeholders without that review.

The template creates separate custom roles for the narrowly described
permissions and binds them only to the requested resources. It uses no actual
account email. The Storage role grants object get/create/update only; no list
permission is granted:

```bash
MEMBER="user:YOUR_EMAIL"
ANALYTICS_PROJECT_ID="f3data"
CLOUD_SQL_PROJECT_ID="f3data"
BUCKET="f3-analytics-nonprod"

gcloud iam roles create analyticsNonprodStorageObjects \
  --project="$ANALYTICS_PROJECT_ID" \
  --title="Analytics nonprod storage objects" \
  --permissions="storage.objects.get,storage.objects.create,storage.objects.update" \
  --stage="GA"
gcloud iam roles create analyticsNonprodBigQueryTable \
  --project="$ANALYTICS_PROJECT_ID" \
  --title="Analytics nonprod BigQuery table" \
  --permissions="bigquery.tables.create,bigquery.tables.get,bigquery.tables.update,bigquery.tables.updateData" \
  --stage="GA"
gcloud iam roles create analyticsNonprodBigQueryJobs \
  --project="$ANALYTICS_PROJECT_ID" \
  --title="Analytics nonprod BigQuery jobs" \
  --permissions="bigquery.jobs.create" \
  --stage="GA"
gcloud iam roles create analyticsNonprodCloudSqlConnect \
  --project="$CLOUD_SQL_PROJECT_ID" \
  --title="Analytics nonprod Cloud SQL connect" \
  --permissions="cloudsql.instances.connect,cloudsql.instances.get" \
  --stage="GA"

gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="$MEMBER" \
  --role="projects/$ANALYTICS_PROJECT_ID/roles/analyticsNonprodStorageObjects" \
  --condition="title=analytics-prefix,expression=(resource.type == 'storage.googleapis.com/Object' && resource.name.startsWith('projects/_/buckets/$BUCKET/objects/parquets/pv_regions/')),description=approved nonprod parquet prefix only"
gcloud projects add-iam-policy-binding "$ANALYTICS_PROJECT_ID" \
  --member="$MEMBER" \
  --role="projects/$ANALYTICS_PROJECT_ID/roles/analyticsNonprodBigQueryTable" \
  --condition="title=analytics-table,expression=resource.service == 'bigquery.googleapis.com' && resource.type == 'bigquery.googleapis.com/Table' && resource.name == 'projects/f3data/datasets/paxVaultDuckStaging/tables/pv_regions',description=approved nonprod table only"
gcloud projects add-iam-policy-binding "$ANALYTICS_PROJECT_ID" \
  --member="$MEMBER" \
  --role="projects/$ANALYTICS_PROJECT_ID/roles/analyticsNonprodBigQueryJobs"
gcloud projects add-iam-policy-binding "$CLOUD_SQL_PROJECT_ID" \
  --member="$MEMBER" \
  --role="projects/$CLOUD_SQL_PROJECT_ID/roles/analyticsNonprodCloudSqlConnect" \
  --condition="title=analytics-instance,expression=resource.type == 'sqladmin.googleapis.com/Instance' && resource.name == 'projects/f3data/instances/f3data-nonprod',description=approved nonprod instance only"
```

### Obtain and verify the local DuckDB extension

Use DuckDB **1.4.3** and the architecture of the runtime that will execute the
local CLI. Use an isolated extension directory; never copy an extension across
operating systems or architectures. The Docker image's extension artifact is
Linux amd64 only and is not suitable for a Mac/ARM local runtime.

The commands below are Bash-specific; run them in Bash, not Fish. DuckDB 1.4.3
does not reliably expose usable `extension_path` metadata in
`duckdb_extensions()`, so discovery deliberately searches the isolated
directory instead.

The following is a one-time preparation step, not an ETL runtime operation:

```bash
EXT_DIR="$(cd "$HOME" && pwd)/.cache/f3-analytics/duckdb-1.4.3-$(uname -s)-$(uname -m)"
mkdir -p "$EXT_DIR"
export EXT_DIR
uv --directory apps/analytics run python -c '
import os
import duckdb

if duckdb.__version__ != "1.4.3":
    raise SystemExit(f"expected DuckDB 1.4.3, got {duckdb.__version__}")
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

if duckdb.__version__ != "1.4.3":
    raise SystemExit(f"expected DuckDB 1.4.3, got {duckdb.__version__}")
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

if duckdb.__version__ != "1.4.3":
    raise SystemExit(f"expected DuckDB 1.4.3, got {duckdb.__version__}")
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
`localhost` and the chosen proxy port. Then source the completed file and explicitly re-assert the
discovered paths after sourcing so the file cannot silently replace working
exports:

```bash
cp apps/analytics/.env.example /tmp/analytics.env
# Edit /tmp/analytics.env; set the two absolute DuckDB paths from above,
# set the approved nonprod values, and do not commit this file.
unset ANALYTICS_POSTGRES_SOCKET_DIR
set -a; . /tmp/analytics.env; set +a
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
