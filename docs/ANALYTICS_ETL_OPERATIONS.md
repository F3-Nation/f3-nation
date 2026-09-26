# Analytics ETL operations

## Product and deployment contract

Both Cloud Run Jobs are in project `f3data`, region `us-central1`:

| Environment | Job                     | Database                         | Bucket                      |
| ----------- | ----------------------- | -------------------------------- | --------------------------- |
| Nonprod     | `analytics-etl-nonprod` | `f3_staging` on `f3data-nonprod` | `gs://f3-analytics-nonprod` |
| Production  | `analytics-etl`         | `f3_prod` on `f3data`            | `gs://f3-analytics`         |

| Product     | Exact publication set                                                                                                 | Immutable layout                               | Sole mutable pointer              |
| ----------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------- |
| `pax-vault` | `pv_regions`, `pv_pax`, `pv_kotter`, `pv_upcoming`, `pv_sectors`, `pv_territories`, `pv_areas`, `pv_aos`, `pv_events` | `<bucket>/pax-vault/releases/<release-id>/...` | `<bucket>/pax-vault/current.json` |
| `analytics` | `event_info`, `future_event_info`, `attendance_info`, `missing_backblasts`                                            | `<bucket>/analytics/releases/<release-id>/...` | `<bucket>/analytics/current.json` |

Every release has per-dataset manifests/objects and a final `release.json`.
`current.json` is the only mutable selection object for that product. The roots,
contracts, source-order state, release sequences, and rollback state are
independent; there is no shared catalog and no `parquets/` release root. The
producer never dual-publishes a legacy pointer. Preserve the old serving path
and data until the consumer owner signs off on cutover; after cutover, do not
continue publishing to both paths.

The CLI `run` command with no `--product` runs both products sequentially as two
independent complete releases, each with its own run ID and pointer. Use
`--product=pax-vault` or `--product=analytics` to run only one product. A
publication run cannot select a subset of that product's approved set. Local
exports/diagnostics may have different selection rules; they do not publish.
Nonprod is manual. Production scheduling is daily. Jobs use one task,
parallelism one, no task retries, and a 60-minute timeout. Deployment does not
create IAM grants or schedules. `ANALYTICS_PRODUCER_REVISION` is a validated
safe slug recorded in release/pointer metadata; production requires it.

Dataset reads are sequential with independent read boundaries. They are not one
PostgreSQL snapshot. `sourceOrder` is an ordering value, not a shared-snapshot
claim. Candidate count goldens validate candidate Parquet transport/staging;
they are not independent SQL parity evidence.

## Local tests and approved live runs

The ordinary test path is offline and safe. From the repository root:

```bash
uv --directory apps/analytics sync --group dev
uv --directory apps/analytics run pytest
uv --directory apps/analytics run ruff check .
```

Tests use synthetic DuckDB data and fake GCS clients; they do not contact a
database or GCS. `tests/test_product_release_integration.py` exercises the full
synthetic data-to-pointer chain for both products. It is not production SQL,
IAM, Cloud Run, or real-GCS validation.

A live local `run` is a publication operation, not a sandbox. It requires
explicit security/platform and analytics-operator approval, real read-only
database credentials and approved connectivity, a valid DuckDB 1.5.5 signed
PostgreSQL extension at the configured absolute path, and ADC with reviewed
least-privilege permissions. Do not use production targets for local testing.
Follow [`apps/analytics/README.md`](../apps/analytics/README.md) for safe local
extension setup and export handling. Cloud Run uses the approved Cloud SQL Unix
socket; never commit credentials or place them in logs.

Before a manually approved deployed nonprod run, inspect the target and image,
record the approver/reason/revision/start time, and then execute:

```bash
gcloud run jobs execute analytics-etl-nonprod \
  --project f3data --region us-central1 --wait
```

This uses the deployed image and runtime identity, not the local checkout.
Nonprod has no standing scheduler.

## IAM and access requirements — human approval required

The following are requirements to review, not verified grants. No IAM changes
have been executed or asserted as configured here.

| Identity                  | Required access, limited by product/environment                                                                                                                                                                        | Must not receive                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Product runtime           | Read-only database and matching secrets; `storage.objects.get` and `storage.objects.create` on only its immutable release prefix; read/create/content-replacement permissions needed for only its exact `current.json` | Database write/DDL/admin; release delete/overwrite; other product root; broad bucket admin        |
| Consumer for one product  | `storage.objects.get` on that product's exact pointer and release prefix                                                                                                                                               | Pointer/release mutation, other product unless separately approved, end-user/direct source access |
| Scheduler identity        | `roles/run.invoker` on production job only                                                                                                                                                                             | Storage, secrets, database, deploy, scheduler administration                                      |
| GitHub deploy identity    | Reviewed deploy/build permissions and runtime service-account use                                                                                                                                                      | Runtime data access, database access, scheduler administration, Owner/Editor                      |
| Pointer rollback operator | Separately approved read and exact-pointer update/content replacement permissions                                                                                                                                      | Release-object mutation/deletion, broad bucket update/delete                                      |

GCS content replacement is not a metadata patch. `storage.objects.update` alone
does not authorize replacing `current.json`. Depending on effective GCS
semantics and bucket configuration, pointer replacement may require
`storage.objects.create` plus `storage.objects.delete` on the exact pointer
object. Security/platform owners must verify the minimum effective permissions
and conditional binding against the actual bucket before granting them. If
delete is required for pointer replacement, scope it to the one product pointer
only; never grant it on release prefixes. An exact-name IAM condition cannot
require the client-side `if_generation_match` CAS precondition, and the pointer
delete grant still permits unconditional deletion of that key. Security owners
must explicitly assess/accept that risk and verify/audit effective access. Do not
infer a deployed role or binding from this document. Release objects remain
create-only and immutable.

Consumers follow the pointer and manifests and do not need bucket listing for
the documented chain. Confirm whether the concrete client path needs any
additional permissions before approval; do not grant broad object viewer roles
by default. Keep nonprod and production runtime identities, secrets, databases,
and buckets separate.

## Retention and cleanup

- Keep the current and retained previous valid release for at least one day.
- Retain ordinary completed releases for at least 14 days.
- Keep abandoned/incomplete release prefixes for at least 14 days before they
  can be considered for cleanup.
- Never delete the current release or a rollback-eligible release.

Do **not** configure a naive bucket lifecycle age rule that can delete
`current.json`, a selected release, or a retained previous release. No automated
garbage collector is implemented. Any future GC is a separately privileged,
generation-aware operation requiring explicit human approval and preservation
of the live and rollback-eligible pointer chains. Publisher and rollback code
do not delete objects. Failed runs may leave unreachable immutable prefixes;
record them for later reviewed cleanup.

## Publication, CAS, and rollback

The publication order is: create-only Parquet and golden objects; validate
generation-pinned size, CRC32C, schema, counts and candidate golden; create-only
dataset manifests; create-only `release.json`; validate the exact product
release; then CAS the product's `current.json` using its observed object
generation (`if_generation_match=0` for first creation). The producer reads back
and confirms the pointer generation/content. Metageneration is metadata state;
it is not the pointer CAS token. A CAS conflict rereads the pointer and
recalculates sequence; a stale source order is rejected. A successful rollback
advances sequence and preserves the source high-water order. Release objects are
immutable; only the selected product's `current.json` is replaced by pointer CAS.

Rollback is an operator-only selection of the pointer's **retained previous**
release. The publisher downloads and validates the retained release and pinned
objects before CAS. Arbitrary release IDs, guessed generations, and caller
chosen source order are not rollback inputs. Obtain the current pointer object's
generation from an approved read before invoking:

```bash
ANALYTICS_ENVIRONMENT=nonprod \
ANALYTICS_CATALOG_BUCKET=f3-analytics-nonprod \
ANALYTICS_PRODUCER_REVISION=approved-operator-revision \
  uv --directory apps/analytics run analytics-etl rollback-pointer \
  --product pax-vault \
  --expected-generation '<current-pointer-object-generation>' \
  --release-id '<retained-previous-release-id>'
```

Use `--product analytics` and the production bucket/environment only after the
corresponding human gates. The existing validated pointer settings still name
the bucket variable `ANALYTICS_CATALOG_BUCKET`; set it to the approved
environment bucket. Record approval, product, release ID, observed/returned
pointer generations, outcome, and verification. Re-read the pointer after
rollback. Do not retry a conflict with guessed values. Rollback uses
`rollback-pointer` and the pointer's retained previous release only.

## Release gates and current status

Production release is **BLOCKED**. The focused Phase 2 review passed for
controlled nonprod testing only; it is not a production review or signoff. No
production IAM/deployment action or live production validation is claimed.
Before production deployment, owners must complete and record all of these
gates:

1. Verify that no enabled Cloud Scheduler job or other unattended invocation
   can trigger the updated production `analytics-etl` job. If an enabled path
   exists, either obtain human approval to suspend it and confirm suspension, or
   complete all production release gates before deployment so an immediate run
   is allowed. Tie production GitHub environment reviewer approval to this
   evidence and disposition; do not assume reviewers are currently configured.
2. The Analytics tagged deploy defaults to staging only (`deploy_prod=false`).
   Enabling production deployment later requires a separate reviewed workflow
   change; do not bypass the default.
3. External consumer compatibility against every serving and
   rollback-eligible consumer revision, including staged generation-race and
   pointer-replacement tests.
4. Security signoff for dataset sensitivity, consumer access, pointer
   replacement/delete semantics, rollback operator access, secrets, and
   end-user denial.
5. Source-query plan/read-volume/load review for all 13 datasets, sequential
   source semantics, runtime and freshness/SLO approval.
6. Human-reviewed nonprod and production IAM, plus staging validations of
   separate product roots/pointers, create-only releases, generation-pinned
   reads, CAS races, and retained-release rollback.
7. Consumer-owned cutover approval. Preserve the prior serving path/data until
   signoff; do not run ongoing dual-pointer publishing after cutover.
8. Retention and cleanup plan meeting the time minima above without an unsafe
   lifecycle deletion rule.

Green synthetic tests are not evidence that these gates have passed. Record
live validation and approvals separately before unblocking production.

## Production Scheduler and operational checks

Production uses the existing daily Scheduler design; nonprod remains manual.
Scheduler provisioning is a separately approved human operation, not part of
application deployment. The repository script requires the approved cron,
timezone, project, region, job and invoker service account; do not invent a
schedule or run it as part of ETL deployment. After approved deployment, review
the jobs and execution logs:

```bash
gcloud run jobs describe analytics-etl-nonprod --region us-central1 --project f3data
gcloud run jobs describe analytics-etl --region us-central1 --project f3data
gcloud logging read 'resource.type="cloud_run_job"' --project f3data --limit=20
```

Record job image digest/revision, source order, pointer generation/sequence,
release IDs, product outcomes, and any abandoned prefixes. These commands do
not prove live permissions, source correctness, or consumer compatibility.
