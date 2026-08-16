# Analytics ETL operations

## Deployment contract

Both jobs are in project `f3data`, region `us-central1`. `analytics-etl-nonprod`
uses `f3data-nonprod`, bucket `gs://f3-analytics-nonprod/parquets/pv_regions`, and
table `f3data.paxVaultDuckStaging.pv_regions`. `analytics-etl` uses `f3data`,
bucket `gs://analytics/parquets/pv_regions`, and
`f3data.paxVaultDuck.pv_regions`. The image is built once and deployed by
digest. Each job has one task and parallelism, no task retries, and a 60-minute
timeout. Deployment does not create IAM grants or schedules.

GitHub environments `analytics-nonprod` and `analytics-production` hold the WIF
deployment settings; production approval is required by the environment policy.
The runtime identities are separate (`analytics-etl-nonprod@f3data...` and
`analytics-etl@f3data...`), and neither is the GitHub deployment identity.

## Local testing and live end-to-end runs

The default local test path is offline and safe. It needs Python 3.12+, `uv`,
and the repository checkout, but no cloud credentials, Google ADC, database,
Cloud SQL socket, or DuckDB extension. From the repository root:

```bash
uv --directory apps/analytics sync --group dev
uv --directory apps/analytics run pytest
uv --directory apps/analytics run ruff check .
```

The tests use synthetic DuckDB fixtures and mocked GCS/BigQuery clients; they
do not access live cloud or database resources.

A live local CLI run is separate and optional. It is not a sandbox: it reads
the approved nonprod PostgreSQL database and publishes to
`gs://f3-analytics-nonprod/parquets/pv_regions` and
`f3data.paxVaultDuckStaging.pv_regions`. It requires explicit human approval,
real read-only database credentials, access to
`/cloudsql/f3data:us-central1:f3data-nonprod`, a real signed DuckDB 1.4.3
`postgres_scanner` extension in the configured absolute version/platform path,
and Google ADC with the narrowly scoped nonprod IAM grants. Do not use
production targets, database write credentials, unsigned or placeholder
extensions, or credentials in source control or logs.

For an approved local CLI run, configure every value from the example and
verify the target values before running both commands:

```bash
cp apps/analytics/.env.example /tmp/analytics.env
# Edit /tmp/analytics.env; do not commit it.
set -a; . /tmp/analytics.env; set +a
ANALYTICS_ENVIRONMENT=local \
  uv --directory apps/analytics run analytics-etl preflight
ANALYTICS_ENVIRONMENT=local \
  uv --directory apps/analytics run analytics-etl run
```

The local CLI runs the current checkout under the caller's ADC. It is not the
deployed nonprod Cloud Run Job and does not use the Cloud Run runtime identity.
To execute the deployed nonprod job, which publishes through its deployed
immutable image and nonprod runtime identity, obtain the same explicit human
approval and run:

```bash
gcloud run jobs execute analytics-etl-nonprod \
  --project f3data --region us-central1 --wait
```

Record the approver, reason, image revision, start time, and outcome. Nonprod
is manual only; this command does not create or enable a scheduler.

## Human-approved IAM matrix

The following is the minimum matrix to approve and grant, with resource-level
conditions where supported:

| Identity              | Permission                                                                                                                                  | Resource                                                                                                               | Explicitly not granted                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| GitHub WIF deployer   | Artifact Registry write/read; Cloud Run Job deploy; service-account use                                                                     | `f3data` AR and the two named jobs                                                                                     | Runtime data, scheduler administration, broad project owner/editor               |
| Nonprod runtime SA    | `roles/cloudsql.client`; `roles/secretmanager.secretAccessor`; object create/read plus pointer update; named BigQuery table metadata update | Nonprod secrets, `f3data-nonprod`, `f3-analytics-nonprod/parquets/pv_regions`, `f3data.paxVaultDuckStaging.pv_regions` | Database writes/DDL/admin, committed-object deletion, unrelated buckets/datasets |
| Production runtime SA | Same narrowly scoped roles as nonprod, restricted to production resources                                                                   | Production secrets, `f3data`, `analytics/parquets/pv_regions`, `f3data.paxVaultDuck.pv_regions`                        | Nonprod resources, database writes/DDL/admin, unrelated resources                |
| Scheduler SA          | `roles/run.invoker` only                                                                                                                    | `analytics-etl`                                                                                                        | Secret, storage, BigQuery, deploy, and scheduler administration                  |
| PAX Vault consumer    | GCS object read only                                                                                                                        | Approved published prefix                                                                                              | Write, pointer mutation, direct end-user access                                  |

Security/platform owners must approve the exact predefined service-account
bindings, database read-only role, secret versions, bucket conditions, and
BigQuery metadata scope before granting them. The runtime identities must not
receive `roles/editor`, project-wide BigQuery admin, bucket admin, or database
write/DDL privileges. Secret values never belong in workflow files.

## Scheduler policy and provisioning

Production is scheduled daily; nonprod is manual only. A human supplies the
cron and IANA timezone at provisioning time—there is deliberately no default.
The script is idempotent and creates or updates an OAuth POST target for the
Cloud Run Jobs v2 `jobs:run` endpoint, with zero retries:

```bash
bash scripts/provision-analytics-scheduler.sh \
  --project f3data --region us-central1 --job analytics-etl \
  --service-account analytics-scheduler@f3data.iam.gserviceaccount.com \
  --cron '0 6 * * *' --time-zone UTC
bash scripts/provision-analytics-scheduler.sh --project f3data --region us-central1 \
  --job analytics-etl --service-account analytics-scheduler@f3data.iam.gserviceaccount.com \
  --cron '0 6 * * *' --time-zone UTC --status
```

Use `--pause` or `--resume` for an existing schedule. Do not run provisioning
from an application deployment; review the target, IAM, cron, and timezone
separately. Nonprod has no standing scheduler: execute a one-off job manually
only after a human approves the run, and do not create or enable a nonprod
schedule:

```bash
gcloud run jobs execute analytics-etl-nonprod \
  --project f3data --region us-central1 --wait
```

The operator must record the approver, reason, image revision, start time, and
outcome. The one-off still uses the deployed nonprod runtime identity and the
same zero-retry job settings.

## Recovery and validation

Every run writes a new run-scoped directory. The generation-protected lease is
90 minutes. A holder may release only its current lease generation; after the
lease expires, a new run may take it over conditionally using the observed
generation. Never delete the current pointer or committed output to recover a
stale lease. On any partial failure, retain the last known-good pointer and
perform a full ETL rerun; a manifest alone is not a resumable publication.
A BigQuery mismatch means the GCS pointer and external table disagree: stop
consumers, compare the exact run directory and manifest, restore the last
known-good table definition, then perform a full ETL rerun and record the
incident. Never wildcard multiple runs or treat a manifest as a pointer-only
repair mechanism.

After a secret rotation, create a new Secret Manager version, verify the
runtime identity can access it, run nonprod manually, then approve production;
revoke the old version only after successful validation.

Useful checks:

```bash
gcloud run jobs describe analytics-etl-nonprod --region us-central1 --project f3data
gcloud run jobs describe analytics-etl --region us-central1 --project f3data
gcloud scheduler jobs describe analytics-etl-daily --location us-central1 --project f3data
gcloud logging read 'resource.type="cloud_run_job"' --project f3data --limit=20
```

Validate workflow YAML with the repository's CI/workflow linter (or a YAML
parser), and review the immutable image digest, Cloud SQL instance, secret
references, and environment approval before merging.
