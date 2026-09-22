# Analytics ETL operations

## Deployment contract

Both jobs are in project `f3data`, region `us-central1`. `analytics-etl-nonprod`
uses `f3data-nonprod` and bucket `gs://f3-analytics-nonprod`; `analytics-etl`
uses `f3data` and bucket `gs://f3-analytics`. Published objects are under
`parquets/releases/<run-id>/<dataset>/`.
The compiled materialization registry in the deployed image selects the approved
dataset paths beneath these prefixes.
The image is built once and deployed by digest. Each job has one task and
parallelism, no task retries, and a 60-minute
timeout. Deployment does not create IAM grants or schedules.

GitHub environments `analytics-nonprod` and `analytics-production` hold the WIF
deployment settings; production approval is required by the environment policy.
The runtime identities are separate (`analytics-etl-nonprod@f3data...` and
`analytics-etl@f3data...`), and neither is the GitHub deployment identity.

## Local testing and live end-to-end runs

The default local test path is offline and safe. It needs Python 3.13, `uv`,
and the repository checkout, but no cloud credentials, Google ADC, database,
Cloud SQL socket, or DuckDB extension. From the repository root:

```bash
uv --directory apps/analytics sync --group dev
uv --directory apps/analytics run pytest
uv --directory apps/analytics run ruff check .
```

The tests use synthetic DuckDB fixtures and mocked GCS clients; they
do not access live cloud or database resources.

A live local CLI run is separate and optional. It is not a sandbox: it reads
the approved nonprod PostgreSQL database and publishes to
`gs://f3-analytics-nonprod/parquets/releases/<run-id>/` only after the complete
nine-dataset batch succeeds.
It requires explicit human approval,
real read-only database credentials, access to
`/cloudsql/f3data:us-central1:f3data-nonprod`, a real signed DuckDB 1.5.5
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
Publication rejects subset selections: only the complete nine-dataset
registry can create `release.json` or advance the global catalog.
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

| Identity              | Permission                                                                                                                         | Resource                                                                             | Explicitly not granted                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| GitHub WIF deployer   | Artifact Registry write/read; Cloud Run Job deploy; service-account use                                                            | `f3data` AR and the two named jobs                                                   | Runtime data, scheduler administration, broad project owner/editor                        |
| Nonprod runtime SA    | `roles/cloudsql.client`; `roles/secretmanager.secretAccessor`; create/get on release paths plus update on the exact catalog object | Nonprod secrets, `f3data-nonprod`, `parquets/releases/*` and `parquets/catalog.json` | Database writes/DDL/admin, object deletion, content overwrite, unrelated buckets/datasets |
| Production runtime SA | Same narrowly scoped roles as nonprod, restricted to production resources                                                          | Production secrets, `f3data`, `parquets/releases/*` and `parquets/catalog.json`      | Nonprod resources, database writes/DDL/admin, object deletion, content overwrite          |
| Scheduler SA          | `roles/run.invoker` only                                                                                                           | `analytics-etl`                                                                      | Secret, storage, deploy, and scheduler administration                                     |
| PAX Vault consumer    | GCS object read only                                                                                                               | Catalog plus approved release prefix                                                 | Write, catalog mutation, direct end-user access                                           |

Security/platform owners must approve the exact predefined service-account
bindings, database read-only role, secret versions, bucket conditions, and
GCS object/catalog scope before granting them. The runtime identities must not
receive `roles/editor`, bucket admin, or database
write/DDL privileges. Secret values never belong in workflow files.

The publisher custom role must separate release-object access from catalog
metadata update. Grant create/get on
`parquets/releases/*`, with no delete and no overwrite of existing content.
Grant `storage.objects.get`, `storage.objects.create`, and
`storage.objects.update` for the fixed catalog only through a conditional
binding whose resource name is exactly:

```text
projects/_/buckets/f3-analytics-nonprod/objects/parquets/catalog.json
projects/_/buckets/f3-analytics/objects/parquets/catalog.json
```

Do not grant `storage.objects.update` across `parquets/`; catalog updates are
metadata-only metageneration-CAS patches. The consumer receives read-only
access to the approved release prefix and catalog metadata, never mutation.

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

## Release, recovery, and validation

Every run stages a new immutable `parquets/releases/<run-id>/<dataset>/` tree.
Dataset objects and manifests are staged uploads, not a published release: they
are unreachable by consumers until `release.json` is written after all nine
datasets validate and the fixed catalog is successfully advanced by CAS. The
release/catalog commit timestamp (`published_at`) is captured at that final
commit boundary, not at batch start. A catalog CAS/IAM failure may leave an
immutable but unselected `release.json`; catalog metadata alone determines
consumer visibility. A failed or subset run has no current release and must be
rerun as a complete batch. Lifecycle policy cleans unreachable staged objects;
operators and the publisher never delete them.

PAX Vault reads `parquets/catalog.json` custom metadata, downloads the pinned
`release.json` generation, then reads exactly its nine pinned dataset manifests
and the object generations recorded there. Verify catalog schema, current/previous
URI and generation, logical batch-start source order (not a database snapshot),
high-water order, and metageneration. Catalog updates
are metadata-only CAS patches; object generation must remain stable.

For an approved rollback, use the explicit human catalog rollback operation to
select the retained generation-pinned previous release with the observed catalog
metageneration. It retains high-water source order, so stale in-flight runs
cannot undo it; only a genuinely newer source order may advance the catalog.
PAX Vault consumer compatibility and ownership must be confirmed before catalog
activation. Record the approver, release IDs, generations, metagenerations, and
outcome.

The command is operator-only and is not used by the normal runtime path. The
operator identity needs `storage.objects.get` and `storage.objects.update` on
the exact catalog object (plus get on the referenced release objects), granted
separately from the producer service account. It must not have delete or
release-object update permission. Obtain the catalog metadata first and copy
the retained previous URI, generation, and catalog metageneration exactly:

```bash
ANALYTICS_ENVIRONMENT=nonprod \
  ANALYTICS_CATALOG_BUCKET=f3-analytics-nonprod \
  uv --directory apps/analytics run analytics-etl rollback-catalog \
  --release-manifest-uri 'gs://f3-analytics-nonprod/parquets/releases/<run-id>/release.json' \
  --release-manifest-generation '<release-generation>' \
  --catalog-metageneration '<catalog-metageneration>'
```

Use the production bucket and approved production environment only after the
production human gate. A URI/generation mismatch or CAS conflict fails without
changing catalog metadata; do not retry with guessed values. After success,
re-read catalog metadata, verify the selected URI and generation, unchanged
high-water source order, incremented metageneration, and the complete pinned
nine-dataset chain before allowing PAX Vault to consume it.

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
