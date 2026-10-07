# Analytics ETL GCP provisioning

This is a human-reviewed provisioning checklist, not live-state validation.
Platform, security, database, analytics, and consumer owners must approve the
actual grants and production release. No IAM commands have been executed, and
this document does not assert that any role, binding, service account, bucket,
schedule, or API configuration is present. See the
[`analytics-parquet-etl` spec](../specs/analytics-parquet-etl.md),
[`pax-vault-parquet-etl` spec](../specs/pax-vault-parquet-etl.md), and
[operations guide](ANALYTICS_ETL_OPERATIONS.md) for contracts and gates. Use
[`GCP_APP_SETUP.md`](GCP_APP_SETUP.md) for shared Cloud Run and WIF setup; do
not recreate the shared WIF pool/provider.

## Product and environment targets

Both jobs use project `f3data`, region `us-central1`, and Artifact Registry
repository `cloud-run-builds`.

| Environment | Job                     | Cloud SQL/database              | Bucket                      |
| ----------- | ----------------------- | ------------------------------- | --------------------------- |
| Nonprod     | `analytics-etl-nonprod` | `f3data-nonprod` / `f3_staging` | `gs://f3-analytics-nonprod` |
| Production  | `analytics-etl`         | `f3data` / `f3_prod`            | `gs://f3-analytics`         |

The bucket has independent roots and pointers:

| Product     | Exact datasets                                                                                                        | Release prefix                              | Mutable pointer                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------- |
| `pax-vault` | `pv_regions`, `pv_pax`, `pv_kotter`, `pv_upcoming`, `pv_sectors`, `pv_territories`, `pv_areas`, `pv_aos`, `pv_events` | `<bucket>/pax-vault/releases/<release-id>/` | `<bucket>/pax-vault/current.json` |
| `analytics` | `event_info`, `future_event_info`, `attendance_info`, `missing_backblasts`                                            | `<bucket>/analytics/releases/<release-id>/` | `<bucket>/analytics/current.json` |

Pax Vault uses `pv-release.v2`; Analytics uses `analytics-release.v1`. Each
pointer selects only its product release. Runtime `run` defaults to both
products sequentially, with independent run IDs and pointer CAS; `--product`
selects one product. Each selected publication must include its exact full
dataset set. There is no shared catalog, shared product root, or ongoing
dual-publishing of a legacy pointer. Keep the old serving path/data
until external consumer owners approve cutover; do not keep publishing both
after cutover.

The current jobs are designed with one task, parallelism one, zero task retries,
and a 60-minute timeout. Nonprod is manual; production is scheduled daily.
Deployment builds once and promotes an immutable image digest. Application
deployment does not create IAM grants or schedules. `ANALYTICS_PRODUCER_REVISION`
is a validated safe slug recorded in the release and pointer; production
requires it. The pointer operator CLI currently reads the validated bucket
from `ANALYTICS_CATALOG_BUCKET` despite the legacy variable name.

## 1. Prerequisites and review

Use Bash from the repository root with authenticated `gcloud`/`gh` as approved.
Never create service-account keys. Confirm the existing project, Cloud SQL
instances, Artifact Registry, shared WIF pool/provider, and bucket settings
before any change; this document makes no existence claim. Do not use a naive
bucket lifecycle age rule capable of deleting `current.json`, a selected
release, or retained previous data.

Required release approvals include:

- External consumer compatibility for every serving and rollback-eligible
  consumer version, followed by consumer-owner cutover approval.
- Security review of product data, private/event/email sensitivity, consumer
  access, invocation boundaries, secrets, and object replacement permissions.
- Source query plans, read volume, sequential source-boundary behavior, load,
  runtime, and freshness/SLO review for all 13 datasets.
- Human approval of IAM, bucket encryption/retention, rollback, and the
  generation-aware cleanup design.

Production release is **BLOCKED**. The focused Phase 2 review passed for
controlled nonprod testing only; it is not production review or signoff. No
production IAM/deployment action or live production validation is claimed.
Synthetic tests do not satisfy production gates.

### API, Artifact Registry, and WIF preflight

Review required APIs in `f3data` (`artifactregistry`, `cloudscheduler`, `iam`,
`iamcredentials`, `logging`, `run`, `secretmanager`, `serviceusage`, `sqladmin`,
`sts`, `storage`) and the WIF support APIs in `f3-github`. Enable a missing API
only after the project owner approves. Check—not recreate—the shared
`github-actions` WIF pool and `github` provider. Check the `cloud-run-builds`
Artifact Registry repository in `us-central1`; create it only if platform
owners approve and it is confirmed absent. Never delete/recreate the repository.
The image is named `analytics-etl` and is built/promoted by the tagged workflow.

GitHub environments are `analytics-nonprod` and `analytics-production`; WIF
environment variables are `WIF_PROVIDER` and `WIF_SA`. Do not store
service-account keys. Follow the shared setup guide for provider/repository
conditions. Deployment identities are not runtime or Scheduler identities. The
Analytics tagged workflow defaults to staging only (`deploy_prod=false`).
Enabling production deployment later requires a separate reviewed workflow
change; do not bypass this default. Do not assume a production environment
reviewer is currently configured. Verify environment protection at deployment
time and tie its approval to recorded evidence for the unattended-invocation
gate below.

### Cloud SQL, database roles, and secrets

Cloud Run must use `/cloudsql/f3data:us-central1:f3data-nonprod` for nonprod and
`/cloudsql/f3data:us-central1:f3data` for production. A database owner creates
or verifies one dedicated read-only database login/role per environment. It
must have no INSERT, UPDATE, DELETE, DDL, ownership, or administrative
privileges. Review required Cloud SQL connector/client access for the runtime
identity and verify write denial in nonprod; do not claim the grants exist
without checking actual IAM and database state.

Secret names are `analytics-etl-nonprod-database-user`,
`analytics-etl-nonprod-database-password`, `analytics-etl-database-user`, and
`analytics-etl-database-password`. A human operator provisions/rotates versions
and grants accessor only to the corresponding runtime identity. Use an
interactive non-echoing input path for values. Never place values in workflows,
command arguments, shell history, logs, or source control. Validate nonprod
after rotation before any production change.

## 2. Deployment identities and runtime identities

GitHub deployment identities are separate from runtime identities. The GitHub
environments `analytics-nonprod` and `analytics-production` provide WIF settings.
The production environment is intended to require human approval; verify its
current protection/reviewer configuration at deployment time rather than
assuming it is enabled. Runtime identities
are separate for each environment (the established names are
`analytics-etl-nonprod@f3data.iam.gserviceaccount.com` and
`analytics-etl@f3data.iam.gserviceaccount.com`). The Scheduler identity is
invoker-only for the production job. Do not grant runtime data permissions to
the deployer or scheduler.

Use the existing shared WIF configuration and approved least-privilege deploy
roles. Restrict deployment access to the intended repository, named jobs,
runtime service accounts, and image repository where supported. Do not grant
Owner/Editor or runtime bucket/database access to deployment identities.

Before a production image deployment, inventory enabled Cloud Scheduler jobs
and every other unattended invocation path capable of starting the updated
production `analytics-etl` job. Verify that no enabled path can run it. If one
exists, either obtain human approval to suspend it and confirm suspension, or
complete all production release gates before deploying while accepting that an
immediate run may occur. Attach this evidence and disposition to the GitHub
production reviewer approval. This documentation does not assert that a
reviewer, Scheduler suspension, or invocation-path inventory currently exists.

The owner-reviewed bootstrap order is: confirm APIs/repository and target
resources; create missing nonprod/production runtime identities and separately
approved deploy/Scheduler identities; provision dedicated read-only database
roles and matching secret versions; approve exact product-root and pointer IAM;
configure the GitHub environment WIF values/protection; deploy the immutable
digest; then separately approve nonprod execution and production schedule. Each
step is an operator action with its own review. Do not treat a command template
or this sequence as evidence that any step has run.

## 3. Required IAM boundaries (not verified)

The following are permission requirements for security/platform owners to
validate against the actual GCS API behavior and bucket configuration. They are
not instructions to execute blanket project/bucket grants.

| Principal                 | Required access                                                                                                                                                                                                                                                                                                  | Explicitly excluded                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Runtime producer          | Read-only database role; accessor on only matching environment secrets; `storage.objects.get` and `storage.objects.create` on approved immutable product release prefixes; pointer read/create/content-replacement on only each approved product's `current.json` when the runtime is authorized to publish both | Database write/DDL/admin; release delete or overwrite; unrelated bucket/product access; broad bucket admin |
| Product consumer          | `storage.objects.get` on that product's fixed pointer and approved release prefix                                                                                                                                                                                                                                | Write, pointer mutation, other product access unless approved, end-user direct access                      |
| Pointer rollback operator | Separately approved pointer read and exact-key content-replacement permissions; read retained release chain                                                                                                                                                                                                      | Release mutation/deletion; broad bucket update/delete                                                      |
| Scheduler                 | `roles/run.invoker` on production `analytics-etl` only                                                                                                                                                                                                                                                           | Storage, database, secrets, deploy, Scheduler administration                                               |
| GitHub deployer           | Reviewed build/deploy and service-account-use permissions                                                                                                                                                                                                                                                        | Runtime data, database, Scheduler administration, Owner/Editor                                             |

`storage.objects.update` is a metadata permission and is **not sufficient** to
replace pointer content. GCS replacement of an existing object commonly requires
`storage.objects.create` and may require `storage.objects.delete` in addition to
`storage.objects.get`, subject to the actual API/bucket semantics. Security must
test and determine the minimum effective permissions before granting anything.
If delete is required for CAS replacement, an exact-object condition constrains
the object name only: IAM cannot require the client to use an
`if_generation_match` precondition. A delete grant on the exact pointer still
allows deletion of that object outside the publisher's CAS flow. Security owners
must explicitly assess and accept that risk, audit the permission, and never
grant delete on release prefixes or across a whole bucket. Release objects
remain immutable; only the product's `current.json` is replaced. Record the
reviewed permission test and effective binding; this guide does not claim
either has been verified.

The exact conditional resource names to evaluate are:

```text
projects/_/buckets/f3-analytics-nonprod/objects/pax-vault/current.json
projects/_/buckets/f3-analytics-nonprod/objects/analytics/current.json
projects/_/buckets/f3-analytics/objects/pax-vault/current.json
projects/_/buckets/f3-analytics/objects/analytics/current.json
projects/_/buckets/<environment-bucket>/objects/pax-vault/releases/
projects/_/buckets/<environment-bucket>/objects/analytics/releases/
```

The runtime CLI default runs both products, so its approved identity needs only
the reviewed operations for both roots and both exact pointer keys. If policy
uses separate product identities, configure an explicit product-specific
execution boundary before assigning narrower grants. Never grant
`storage.objects.update` or `storage.objects.delete` over an entire bucket as a
shortcut.

Consumers resolve paths from pointers/manifests and generally need object reads,
not bucket listing. Verify any additional client-required permissions rather
than granting broad predefined storage roles. Operators must review whether
their rollback tooling has precisely the required pointer replacement access.

Database owners create/verify distinct nonprod/production login roles with no
INSERT, UPDATE, DELETE, DDL, ownership, administrative privilege, or unrelated
database access. Cloud Run uses approved Cloud SQL Unix sockets. Security owns
secret versioning, network path, encryption/key ownership, and audit retention.
Never place credential values in this document, workflow files, logs, or source
control.

## 4. Retention and garbage collection

Provisioning requirements:

- Current and retained previous valid releases: at least one day.
- Ordinary completed releases: at least 14 days.
- Abandoned/incomplete prefixes: minimum age of 14 days before cleanup is
  considered.
- Never delete the current release or any retained rollback-eligible release.

Do **not** set a naive object-age lifecycle deletion rule over either product
root or bucket: age alone cannot identify the live pointer or rollback chain.
Automated garbage collection is not implemented. Any future cleanup must be a
separately privileged, generation-aware process with explicit human approval,
and must resolve/preserve both product pointers and retained previous releases.
The publisher does not delete releases.

## 5. Scheduler

Nonprod has no schedule. Production's approved daily schedule is provisioned
separately from application deployment. A human supplies the reviewed cron,
IANA timezone, and invoker identity; do not invent defaults. The existing
`scripts/provision-analytics-scheduler.sh` is an operator tool, not part of the
ETL job. Before enabling it, validate the OAuth `jobs:run` target, zero retry
policy, identity, timezone, and a completed execution. Record the approver,
change, and validation evidence. Never provision IAM or schedules as a side
effect of deploying an application image.

## 6. Staging, cutover, and recovery gates

Before production approval, the owner-run staging exercise must cover both
products and verify exact dataset membership, independent bucket-root paths,
generation-pinned reads/checksums, create-only immutable writes, canonical
manifest chains, golden replay, pointer CAS first-create/update races, and
retained-previous rollback. The checked-in synthetic integration test uses real
DuckDB Parquet and a fake generation-aware GCS client; it is not real GCS/IAM or
external-consumer evidence.

Use this human-reviewed order for each environment/product:

1. Before any production deployment, inventory enabled Cloud Scheduler jobs
   and every other unattended invocation path capable of starting the updated
   production `analytics-etl` job. Verify no enabled path can trigger it. If one
   exists, either obtain human approval to suspend it and confirm suspension, or
   complete all production release gates before deploying while accepting an
   immediate run. Tie production environment reviewer approval to this recorded
   evidence and disposition; do not assume a reviewer is currently configured.
2. The Analytics tagged workflow defaults to staging-only (`deploy_prod=false`).
   Enabling production deployment later requires a separate reviewed workflow
   change; do not bypass that default.
3. Consumer owners document the serving release and verify read support for the
   proposed contract/schema before the pointer is exposed.
4. Security approves product-specific consumer reads and producer access to
   only approved release roots and exact pointer keys. Validate allowed and
   denied operations against the target bucket; do not rely on role names alone.
5. Run one complete staging release and independently validate every manifest,
   generation, checksum, schema, object count, candidate golden, pointer CAS,
   and race/recovery outcome.
6. Consumer owners validate staging/activation against the pointer chain and
   give explicit cutover approval. Keep the previous serving path/data intact
   through this step.
7. Switch the consumer to the product pointer. Do not dual-publish a legacy
   pointer after the switch. Remove obsolete legacy consumer access only after
   separate human approval and successful observation of the new serving path.

If the consumer cannot read the new contract, do not advance production
`current.json`; retain the old serving path until remediation and re-review.
After cutover, pointer rollback is a separate operator action to the validated
retained previous release, not a reason to restore concurrent legacy publishing.

The old serving path remains available until external consumer owners validate
and sign off on the product pointer chains and cutover. After approval, cut over
to the selected product pointer without ongoing dual-publishing. Rollback is a
validated CAS to the pointer's retained previous release only; sequence
increments and source high-water order does not decrease. Preserve release
content. Record product, previous/current release IDs, pointer generations,
sequence, approval, and outcome.

## 7. Current status and ownership

Production publication remains **BLOCKED** until external consumer
compatibility, security/IAM, source-load, unattended-invocation, staged
race/rollback, retention, and cutover gates are explicitly approved. The focused
Phase 2 review passed for controlled nonprod testing only; it is not production
review or signoff. No production IAM/deployment action or live production
validation is claimed.

CI/CD owns tests, image build/digest promotion, and Cloud Run deployment under
the GitHub environment gate. Platform/security/database/analytics/consumer
owners own actual IAM, database roles, secrets, bucket controls, source/load and
security reviews, and release approval. Operators own approved nonprod runs,
separately approved Scheduler provisioning, evidence, and recovery. Provisioning
review must verify actual resource state; documentation and green synthetic
tests are not that verification.
