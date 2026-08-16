# POC daily region roster/vocabulary Parquet ETL

> Human designer: TBD (human approval required before implementation)

## 1. Summary

The approved proof of concept is a daily, non-interactive Python Cloud Run Job that
reads the transactional PostgreSQL base tables through a read-only connection,
uses DuckDB to transform that data and generate Parquet, produces only the
region roster/vocabulary dataset, and publishes immutable, run-scoped Parquet
files to GCS. After the files are completely and successfully written, the job
advances a GCS manifest/current pointer for DuckDB-backed PAX Vault ingestion
and updates a BigQuery external table to point at the exact committed run
directory. This is a backend data-publication capability; it has no end-user
trigger or end-user data access action. Future datasets require separate
approved data contracts and are not delivered by this POC.

## 2. Context & links

- App(s) affected: analytics/data platform (new Python Cloud Run Job),
  PostgreSQL, GCS, BigQuery, and PAX Vault integration.
- Key code: To be determined during implementation; this spec is the source of
  truth for the first release and does not assert that implementation exists.
- Upstream: transactional PostgreSQL base tables, read-only access only.
- Transform engine: DuckDB with the PostgreSQL extension attached read-only;
  Parquet generation occurs before GCS publication.
- Outputs: immutable run-scoped Parquet in GCS, a GCS current manifest/pointer,
  and one BigQuery external table configured for the committed run directory.

## 3. User stories

- As a PAX Vault data consumer, I want a complete, consistently published
  region roster/vocabulary snapshot so that I can resolve region vocabulary
  without reading transactional tables.
- As a data platform operator, I want each publication to be versioned and
  recoverable so that a failed or partial run cannot become the current data.
- As a security owner, I want the ETL identity to have narrowly scoped,
  auditable permissions so that the job cannot mutate transactional data or
  unrelated storage.

## 4. Approved first-release behavior

1. A scheduler or equivalent platform trigger starts the Cloud Run Job once per
   day. The job is not callable by end users.
2. The job creates a unique run identifier, attaches the approved source tables
   in DuckDB through a PostgreSQL credential/role that cannot write, alter, or
   administer the database, and uses DuckDB to transform the approved data and
   generate Parquet. Reads use a consistent snapshot or an equivalent
   documented consistency boundary.
3. The job transforms only the region roster/vocabulary dataset. Exact source
   columns, joins, filters, null handling, vocabulary values, and output schema
   require the approval listed in Section 10.
4. The job writes Parquet only beneath a new run-scoped directory. Existing run
   directories are never overwritten or deleted by the publication operation.
5. The job validates the generated files and completeness metadata before
   publication. A failure leaves the prior current pointer and BigQuery table
   unchanged.
6. Publication commits a manifest containing at least the run identifier,
   committed run directory, file list, row count, byte count, schema/version,
   source-read timestamp, and publication timestamp. The current pointer is
   advanced only after all files and the manifest are durable.
7. Only after the GCS publication succeeds does the job update the BigQuery
   external table to the exact committed run directory, not a wildcard that
   could include another run. The update must be atomic from the consumer's
   perspective, or the prior table definition must remain in place on failure.
8. Retries are safe: a retry may create a distinct run directory, but it must
   not overwrite an existing committed run or advance the pointer to incomplete
   output.

## 5. Acceptance criteria (testable, non-contradictory)

- **AC-1** — GIVEN the daily trigger fires WHEN the job starts THEN one run
  identifier is recorded and the run is traceable through job logs and the
  resulting manifest.
- **AC-2** — GIVEN the job connects to PostgreSQL WHEN its database role is
  inspected and a write attempt is made THEN the role has only the approved
  read permissions and INSERT, UPDATE, DELETE, DDL, and administrative writes
  are denied.
- **AC-3** — GIVEN a source snapshot WHEN the transform completes THEN the
  DuckDB-generated output contains only the approved region roster/vocabulary
  dataset and its schema, source mapping, and vocabulary values match the
  human-approved data contract.
- **AC-4** — GIVEN a successful transform WHEN files are written THEN every
  output object is under a new run-scoped directory, is valid readable Parquet,
  and no object in an existing committed run directory is modified.
- **AC-5** — GIVEN missing, malformed, duplicate, or schema-invalid source data
  WHEN validation runs THEN the job fails before publication, records the
  validation reason, and leaves both the GCS current pointer and BigQuery
  external table unchanged.
- **AC-6** — GIVEN all generated files pass validation WHEN publication commits
  THEN the manifest lists the exact run directory and all files, and the GCS
  current pointer references that manifest only after the listed objects are
  durable.
- **AC-7** — GIVEN a committed GCS manifest WHEN BigQuery publication runs THEN
  the external table definition references exactly that manifest's committed
  run directory and no other run directory.
- **AC-8** — GIVEN a BigQuery update failure after GCS commit WHEN the job exits
  THEN the GCS manifest/current pointer remains internally consistent, the job
  is unsuccessful, the prior BigQuery definition is not silently replaced by a
  partial definition, and the discrepancy is observable for retry/recovery.
- **AC-9** — GIVEN a retry after a timeout or process failure WHEN the retry
  runs THEN it does not corrupt or overwrite an existing committed run, and at
  most one run is selected as current by the pointer update protocol.
- **AC-10** — GIVEN an authenticated application end user WHEN they attempt to
  trigger the job, read the source database, read the ETL bucket, mutate the
  manifest, or alter the BigQuery external table THEN no end-user route or
  permission permits the action.
- **AC-11** — GIVEN a successful publication WHEN an operator inspects the run
  THEN logs and metrics include run identifier, row/file/byte counts, source
  snapshot time, phase durations, publication outcome, and error classification
  without secrets or sensitive row data.
- **AC-12** — GIVEN a run exceeds the approved runtime or freshness objective
  WHEN monitoring evaluates it THEN an alert is emitted and the prior known-good
  publication remains consumable.

## 6. Roles & authorization (RBAC)

This feature has no oRPC procedure and no user-facing authorization tier. The
following are workload and platform permissions, to be granted only after the
IAM approver in Section 10 signs off.

| Action                                                                   | Allowed                                                                                                                            | Explicitly denied                                                                      |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Start the daily job                                                      | Scheduler service identity, via the approved Cloud Run Job invocation permission                                                   | End users, application identities, anonymous callers                                   |
| Read PostgreSQL base tables                                              | ETL Cloud Run service identity, through a dedicated read-only database role and secret access limited to the connection credential | Any ETL write/DDL/admin operation; end users; unrelated workloads                      |
| Write a new run directory and publication metadata in the ETL GCS bucket | ETL service identity, limited to the approved environment bucket/prefix                                                            | Deleting or overwriting committed runs; end users; unrelated workloads                 |
| Advance the GCS current pointer                                          | ETL service identity, limited to the approved pointer object/prefix                                                                | End users and identities without publication authority                                 |
| Update the BigQuery external table                                       | ETL service identity, limited to the named dataset/table and required metadata permission                                          | End users; arbitrary table creation, data mutation, or unrelated datasets              |
| Consume the published dataset                                            | PAX Vault's explicitly approved read identity, if needed by its contract                                                           | Direct end-user access unless separately approved; ETL identity is not a consumer role |
| Operate, approve, revoke, or audit permissions                           | Designated human platform/security owners                                                                                          | The ETL workload and end users                                                         |

Credential material must use the approved secret-management path, must not be
written to logs or Parquet, and must not be supplied by an end user.

## 7. Human-owned security, reliability, and scalability decisions

These decisions are intentionally owned by humans and must be resolved in the
PR associated with this spec rather than inferred by implementation agents.

### Security

- Security must approve the least-privilege database grants, GCP IAM roles,
  service-account impersonation boundaries, secret delivery, network path,
  encryption/key ownership, audit-log retention, and whether PAX Vault may
  read the bucket directly.
- Security must decide whether row-level restrictions or a sanitized database
  view are required in addition to a read-only role, and must review whether
  region vocabulary is sensitive data.
- No direct end-user action, upload, query parameter, or user-provided path may
  select source tables, output prefixes, or BigQuery targets.

### Reliability

- The owner must approve snapshot consistency semantics, retry/backoff limits,
  duplicate-run handling, pointer-update atomicity, BigQuery/GCS partial-failure
  recovery, alert escalation, and the rollback procedure to a prior manifest.
- A prior known-good committed run remains the fallback until a complete new
  run is validated and published. Garbage collection must never race with a
  consumer or delete the current run.

### Scalability

- The owner must approve partition/file sizing, memory and CPU limits, maximum
  source-row/file counts, PostgreSQL read load limits, concurrency (including
  one publication per environment), and whether the job may stream/chunk data.
- The first release must not silently expand into additional datasets or
  unbounded full-table extraction without a new approved spec. Future datasets
  may reuse the POC foundation only after their own data contracts are approved.

## 8. Data contract and publication protocol

- **Dataset boundary:** this POC contains region roster/vocabulary only. No
  transactional export, user profile, AO/event, analytics aggregate, or ad hoc
  table is included. Future datasets are separate feature increments.
- **Run identity:** generated by the job and immutable once used in an output
  path. The canonical path format and filename/partition format require review,
  but must be deterministic enough for exact manifest and external-table
  verification.
- **Manifest:** versioned JSON or equivalent agreed metadata object. It must
  identify the exact committed directory, complete object list, checksums or
  equivalent integrity values, schema version, counts, and timestamps.
- **Pointer:** one environment-scoped GCS current pointer to the committed
  manifest. Pointer updates must use a concurrency-safe conditional operation
  or equivalent single-writer protocol.
- **BigQuery:** one external table whose URI set is derived only from the
  committed manifest/run directory. The table update occurs after GCS commit.
- **Immutability:** committed Parquet and committed manifests are append-only;
  corrections create a new run. Overwrite and delete permissions for committed
  objects require explicit human approval and are not part of normal ETL.

## 9. Out of scope / non-goals

- Any dataset other than the region roster/vocabulary dataset.
- A generalized multi-dataset framework or implementation of future datasets;
  only the minimal reusable job foundation needed by this POC is in scope.
- End-user-triggered exports, downloads, queries, edits, or job controls.
- Writing to PostgreSQL or changing transactional schemas/data.
- A streaming or intraday pipeline; this is daily only.
- Loading Parquet into native BigQuery tables, dashboards, or general-purpose
  analytics modeling beyond the single external table.
- Backfilling historical runs, automated deletion/retention policy, or cross-
  environment replication until the unresolved approvals are completed.
- PAX Vault application behavior beyond consuming the committed pointer/run.

## 10. Unresolved approval items (must be resolved by named humans)

The following are deliberately not implementation assumptions:

- **Exact source-column mapping:** source tables, joins, filters, canonical
  column names/types, null/duplicate rules, and vocabulary enumeration — owner
  and approver: TBD.
- **Data sizing and SLO:** expected/maximum rows, bytes, file count, job
  runtime, freshness deadline, recovery objective, and availability objective —
  owner and approver: TBD.
- **Retention:** retention duration and deletion/archive policy for immutable
  run directories, manifests, logs, and failed runs — owner and approver: TBD.
- **Environment bucket naming:** exact project, bucket, region, and prefix
  naming for development, test, staging, and production — owner and approver:
  TBD.
- **IAM approver:** named human security/platform approver for database grants,
  service identities, GCS, BigQuery, Secret Manager, and PAX Vault access —
  TBD.

Implementation must not claim these values are decided or infer them from
defaults.

## 11. Critical-path test cases

1. Read-only database role rejects a write and the job can read the approved
   source snapshot.
2. Valid source snapshot produces valid Parquet only in a new run directory.
3. Validation failure leaves the previous pointer and BigQuery URI unchanged.
4. Successful publication advances the pointer and makes BigQuery reference
   exactly the committed run directory.
5. BigQuery failure after GCS commit is visible and does not create a partial
   BigQuery target; recovery can retry from the committed manifest.
6. Retry after interruption does not overwrite a committed run or produce two
   current pointers.
7. End-user/application identities cannot invoke the job or access its source,
   publication, or control-plane permissions.
8. Logs/metrics expose phase, freshness, counts, and failure reason without
   secrets or row-level sensitive data.

## 12. Observability

- Emit structured events through the repository's approved logging abstraction
  (not `console.*`) with fixed event names such as
  `analytics.etl.started`, `analytics.etl.source_read_completed`,
  `analytics.etl.validation_failed`, `analytics.etl.gcs_committed`,
  `analytics.etl.bigquery_updated`, and `analytics.etl.failed`.
- Include run identifier, environment, phase, duration, row/file/byte counts,
  source snapshot time, committed directory, and outcome where applicable.
  Never include credentials, tokens, raw connection strings, or row-level PII.
- Publish metrics for job success/failure, phase duration, source rows,
  output bytes/files, validation failures, publication lag, pointer age,
  BigQuery update failures, and retry count.
- Alert on missed daily execution, stale current pointer, SLO breach, repeated
  failures, validation drift, read-only permission failure, and GCS/BigQuery
  publication mismatch. Cloud Run, GCS, BigQuery, Secret Manager, and IAM
  audit logs must be retained according to the unresolved retention decision.

## 13. Approved Phase 3 deployment contract

- Both Cloud Run Jobs run in project `f3data`, region `us-central1`.
- Production job `analytics-etl` uses Cloud SQL instance `f3data`, publishes to
  `gs://analytics/parquets/pv_regions`, and updates
  `f3data.paxVaultDuck.pv_regions`.
- Nonprod job `analytics-etl-nonprod` uses Cloud SQL instance `f3data-nonprod`,
  publishes to `gs://f3-analytics-nonprod/parquets/pv_regions`, and updates
  `f3data.paxVaultDuckStaging.pv_regions`.
- Jobs use Cloud SQL Unix sockets. Production is triggered daily by Cloud
  Scheduler; nonprod is manual. Scheduler retries and task retries are zero.
  Jobs use one task/parallelism, a 60-minute timeout, and a 90-minute
  generation-protected GCS publication lease.
- Production and nonprod use separate runtime service identities. Cloud
  Scheduler uses a separate invoker-only identity; GitHub WIF remains the
  deployment identity.
