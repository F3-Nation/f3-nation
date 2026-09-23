# Daily analytics Parquet materializations

This document records the contract for the four user-approved analytics SQL
inputs: `event_info`, `future_event_info`, `attendance_info`, and
`missing_backblasts`. The inherited 2026-08-26 approval applied to the separate
nine-dataset Pax Vault scope, documented in
[`pax-vault-parquet-etl.md`](./pax-vault-parquet-etl.md), not to these analytics
datasets. Approval of the SQL inputs does not mean security/IAM, consumer
compatibility, source-load, or production release gates have passed.

## 1. Summary

The analytics Cloud Run Job is a non-interactive daily full-refresh publisher. It
reads PostgreSQL transaction data through a dedicated read-only connection, uses
DuckDB to produce Parquet, and publishes immutable run-scoped objects to GCS.
The default invocation materializes these four datasets sequentially (not
concurrently). Each dataset has its own read boundary: sequential reads are not
a shared PostgreSQL snapshot and must never be described as snapshot-consistent
or as coming from the same source snapshot. An ordinary failure for one dataset
is recorded and does not prevent later datasets from running; the batch exits
unsuccessfully and cannot commit a release if any dataset fails.

The four analytics materializations are exactly:

1. `event_info`
2. `future_event_info`
3. `attendance_info`
4. `missing_backblasts`

The batch is the publication unit. A dataset's failure or upload conflict may
leave unreachable staged objects, but cannot change the consumer-selected
release. The batch is an atomic publication set, not an atomic source read.

## 2. Environment targets and operation

Production targets are, for each `<name>` in the approved list:

- GCS: `gs://f3-analytics/analytics/releases/<run-id>/<name>`

Nonproduction targets are:

- GCS: `gs://f3-analytics-nonprod/analytics/releases/<run-id>/<name>`

The deployment target is project `f3data`, region `us-central1`. The intended
production source is Cloud SQL instance `f3data`; nonproduction uses
`f3data-nonprod`, reached through Cloud SQL Unix sockets. The operational design
is daily Scheduler invocation in production and manual invocation in
nonproduction, with zero Scheduler/task retries, one task and parallelism, and
a 60-minute timeout. These design values do not assert a live deployment. Retention targets are at least one day
for current and previous valid releases, 14 days for ordinary completed
releases, and a minimum age of 14 days before abandoned prefixes are eligible
for cleanup. Never delete current. These are operational requirements, not a
claim that automated garbage collection or a live lifecycle policy is in place;
the publisher does not remove unreachable staged releases.

The default is all four datasets in the order above. A subset may be used for
local export or diagnostics, but a publication run rejects any selection other
than the exact approved four-name set. Analytics has its independent
`analytics/releases/<releaseId>/...` root and `analytics/current.json` pointer.
Pax Vault independently publishes exactly nine `pv_*` datasets, including
`pv_territories`, under `pax-vault/releases/<releaseId>/...` and selects them
through `pax-vault/current.json`.

## 3. Source and common publication contract

- PostgreSQL base tables are the only source. The database role is read-only:
  no INSERT, UPDATE, DELETE, DDL, or administrative privileges.
- DuckDB attaches PostgreSQL read-only and uses one documented read boundary per
  dataset. Reads occur sequentially and do not provide a shared database
  snapshot. The batch source-order value is a logical batch-start ordering
  value, not a database-wide snapshot. The job supplies `refreshed_at` and
  `as_of_date` parameters where the query contract calls for them.
- Every dataset writes only beneath
  `analytics/releases/<run-id>/<dataset>/`. Parquet files and dataset manifests
  are immutable and create-if-absent; corrections create a new run.
- Before publication, generated files are checked for readable valid Parquet,
  expected schema, completeness, counts, and integrity metadata. Missing,
  malformed, duplicate, or schema-invalid data fails that dataset before it can
  contribute to the batch commit.
- A dataset manifest is the commit record and includes at least dataset name,
  run ID, exact committed directory, complete object list, checksums or
  equivalent integrity values, row/file/byte counts, schema version,
  logical batch-start source-order value, each dataset's read timestamp, and
  publication timestamp. These timestamps describe independent reads, not a
  database-wide snapshot.
- After all four datasets are durable and validated, the publisher writes
  `analytics/releases/<run-id>/release.json` once, create-if-absent. It is the
  immutable commit record containing exactly the four generation-pinned dataset
  manifest references, and is written last. A pointer CAS or IAM failure may
  leave this immutable release unselected.
- The only mutable selection object is `analytics/current.json`. It points to
  the immutable release and is updated with GCS object-generation CAS
  (`ifGenerationMatch`), not metadata/metageneration CAS. `releaseSequence` is
  a monotonically increasing logical publication counter: a publisher reads
  the current pointer, proposes its sequence + 1, and retries from a fresh
  pointer after CAS conflict. A validated rollback also advances the sequence;
  it never restores an older sequence or changes release contents.
- A human rollback may select only the retained, generation-pinned previous
  release through the same pointer CAS. Consumers read the pointer, then the
  pinned release manifest and exactly its four dataset manifests and objects.
  Analytics and Pax Vault pointer/release chains are entirely independent.

Analytics uses the independent `analytics-release.v1` release and pointer
contract; Pax Vault uses `pv-release.v2`. Dataset manifest `columns` is an
ordered array of `{name, logicalType, nullable}` records in exact SQL
projection order. Its schema fingerprint is SHA-256 over the canonical UTF-8
JSON bytes of that array: sort object keys recursively, omit insignificant
whitespace and BOM, and preserve array order. The registry's top-level
`nullable: true` is a conservative output policy, not proof that physical
Parquet fields contain nulls or are physically non-nullable. Nested physical
types and repetition/nullability remain physical validation and external
consumer-signoff gates. No concrete fingerprint hash vector is asserted.

The candidate count verification golden represents count `N` under
`rows-json-v1` as the positional bigint result `[[{"$bigint":"N"}]]`; its
manifest query names the allowlisted dataset, for example
`SELECT COUNT(*) AS row_count FROM event_info`. This is a candidate-Parquet
transport check, not independent fixture-parity evidence and not a claim of a
shared source snapshot or SQL parity.

## 4. Analytics output contracts

These four analytics datasets are distinct from Pax Vault's nine `pv_*`
datasets, whose inherited approved scope and detailed contracts are in
[`pax-vault-parquet-etl.md`](./pax-vault-parquet-etl.md). The column names and order below are the exact SQL projections, also
asserted by `tests/test_analytics_views.py`.

### `event_info` — one row per active event instance with non-null `pax_count`

Columns, in order: `id`, `org_id`, `location_id`, `series_id`, `highlight`,
`start_date`, `end_date`, `start_time`, `end_time`, `name`, `description`,
`pax_count`, `fng_count`, `preblast`, `backblast`, `meta`, `created`, `updated`,
`series_name`, `series_description`, `ao_org_id`, `ao_name`, `ao_description`,
`ao_logo_url`, `ao_website`, `ao_meta`, `region_org_id`, `region_name`,
`region_description`, `region_logo_url`, `region_website`, `region_meta`,
`area_org_id`, `area_name`, `territory_org_id`, `territory_name`,
`sector_org_id`, `sector_name`, `location_name`, `location_description`,
`location_latitude`, `location_longitude`, `bootcamp_ind`, `run_ind`,
`ruck_ind`, `first_f_ind`, `second_f_ind`, `third_f_ind`, `pre_workout_ind`,
`off_the_books_ind`, `vq_ind`, `convergence_ind`, `all_types`, `all_tags`.

Type/tag aggregations are ordered by name. The region is resolved from the event
AO or direct region; area is the region's area; territory is the area's parent
when it is a territory; sector uses `territory.parent_id`, falling back to
`area.parent_id` when there is no territory. Area and territory joins are
org-type constrained. Rows with inactive events or null `pax_count` are
excluded. No synthetic `refreshed_at` column is projected.

### `future_event_info` — active event instances on/after `as_of_date`, expanded by planned Q

Columns, in order: `id`, `org_id`, `location_id`, `series_id`, `highlight`,
`start_date`, `end_date`, `start_time`, `end_time`, `name`, `description`,
`preblast`, `meta`, `created`, `updated`, `series_name`, `series_description`,
`ao_org_id`, `ao_name`, `ao_description`, `ao_logo_url`, `ao_website`, `ao_meta`,
`region_org_id`, `region_name`, `region_description`, `region_logo_url`,
`region_website`, `region_meta`, `area_org_id`, `area_name`,
`territory_org_id`, `territory_name`, `sector_org_id`, `sector_name`,
`location_name`, `location_description`, `location_latitude`,
`location_longitude`, `bootcamp_ind`, `run_ind`, `ruck_ind`, `first_f_ind`,
`second_f_ind`, `third_f_ind`, `pre_workout_ind`, `off_the_books_ind`, `vq_ind`,
`convergence_ind`, `all_types`, `all_tags`, `planned_q_user_id`.

The date boundary is inclusive (`start_date >= as_of_date`). Sector resolution
uses `territory.parent_id`, falling back to `area.parent_id` when there is no
territory; the O3 join is explicitly constrained to `org_type = 'area'`.
`planned_q_user_id` comes from planned attendance whose attendance type ID is 2.
The left join preserves one null-Q row when no planned Q matches and can produce
multiple rows for an event when multiple planned-Q attendance rows match.

### `attendance_info` — one row per non-planned attendance record

Columns, in order: `id`, `user_id`, `event_instance_id`, `attendance_meta`,
`created`, `updated`, `q_ind`, `coq_ind`, `f3_name`, `home_region_id`,
`home_region_name`, `avatar_url`, `user_statusa`, `start_date`.

Only `is_planned = FALSE` attendance is emitted. User and event details are
left-joined; Q/Co-Q indicators are aggregated per attendance record. The output
alias `user_statusa` (including its spelling) is the SQL contract. `as_of_date`
and `refreshed_at` are bound query parameters but are not projected.

### `missing_backblasts` — eligible past/today event rows with null pax count

Columns, in order: `q_who`, `region_name`, `ao_name`, `start_date`,
`start_time`.

Retain the supplied `pax_count IS NULL` proxy filter, plus active events with
`start_date <= as_of_date`. The AO and its parent are ordinary inner joins on
`ei.org_id` and `ao.parent_id`; no `org_type` predicate validates either row as
an AO or region. `region_name` and `ao_name` are labels from those joined rows,
not inferred or type-checked labels. Q names include
attendance rows of type Q (without an `is_planned` restriction), sorted and
joined with `, `; when there is no Q the value is `No Q Listed`. Results are
ordered by descending start date.

The user-approved schema-registry concept requires per-dataset versioned column
types and nullability, deterministic checks, and compatibility against serving
and rollback-eligible consumers. The projection names/order and query semantics
above are verified by SQL and tests. The top-level registry policy uses
`nullable: true` conservatively; that is not proof physical Parquet contains
nulls or that fields are physically non-nullable. Nested struct/list physical
types and repetition/nullability need physical-file verification. Registry,
physical-schema, and external consumer-compatibility checks remain release
gates; no claim is made that they have passed.

## 5. Authorization and sensitive data

This is a backend publication capability with no oRPC procedure, end-user
trigger, download, query, or edit action. The intended deployment model uses
separate production and nonproduction runtime identities, an invoker-only
Scheduler identity, and GitHub WIF for deployment. These are design requirements,
not evidence that the identities or bindings are live. End users and application
identities are intended to be denied job invocation, PostgreSQL access, ETL
bucket reads, and mutation of committed objects, manifests, or pointer content;
this is not evidence that deployed IAM enforces those denials.

The analytics output schemas and sensitivity classification require explicit
security-owner review before production publication; this document does not
extend the separate approval for Pax Vault `pv_*` outputs to these four
analytics datasets. Access is limited to the approved ETL workload and
explicitly approved analytics consumer identities; it is not direct end-user
access. Security must approve least-privilege database grants, IAM and
impersonation boundaries, secret delivery, network path, encryption/key
ownership, audit retention, and consumer access. Credentials never enter logs
or Parquet, and logs/metrics contain no row-level sensitive data.

The intended publisher release-path grant is create/get, scoped to
`analytics/releases/`, with no delete or overwrite of immutable release
content. Replacing pointer content requires the GCS content-replacement
permission on the exact `analytics/current.json` object, in addition to the
applicable read/create permissions. A generic metadata-update permission is
not a substitute; do not grant content replacement across `analytics/`. A
human security owner must approve and verify the actual binding. This spec does
not claim live IAM has been configured or validated. Nonprod and production
buckets and runtime identities remain distinct.

## 6. Failure isolation, reliability, and observability

The batch owns publication lifecycle. Source/query, validation, upload, release,
and pointer-CAS errors are classified with dataset or batch context.
The runner continues after ordinary exceptions, records all failed names and
recovery metadata, then returns a nonzero/unsuccessful batch result. Process
cancellation is not treated as an ordinary dataset failure.

Structured events and metrics include batch/run ID, materialization name,
environment, phase, durations, counts, logical batch-start source order, committed
directory, outcome, pointer generation, publication lag, retry count, and
error class.
Use the approved logging abstraction rather than `console.*`; never emit
credentials, tokens, connection strings, PII, or raw rows. Alert on missed daily
execution, stale pointer source order, SLO/freshness breaches, repeated failures,
validation drift, and permission failures.

## 7. Human release gates and ownership

### Local-only export authorization

The repository may provide an explicitly named `analytics-etl export-local`
command for approved nonproduction local analysis only. It is not a
publication path, does not authorize access to any database or output, and does
not grant or imply human approval. A security owner and the responsible
analytics/platform operator must approve each use of a real nonproduction
database and its destination before execution. Production settings and
production data are prohibited.

The operator must use a private, access-controlled local destination with
restrictive permissions, sufficient capacity, and an agreed retention period.
Outputs must not be copied to shared locations or committed to source control.
After the approved analysis, the operator must securely remove the export and
any failed/intermediate files according to the approved retention and cleanup
procedure. The implementation must stage below the chosen destination and
atomically finalize one run directory only after every selected materialization
succeeds; failed runs must leave no final run directory.

- **Nonproduction query gate:** before release, a human must inspect PostgreSQL
  query plans and measured read volume for all four analytics datasets against approved
  nonproduction data. The human gate must establish that sequential execution,
  connection/query scope, runtime, and source load are acceptable. Tests or
  synthetic fixtures do not substitute for this gate.
- **Production gates:** production IAM, source-query load sizing, freshness/SLO,
  retention duration, rollback behavior, and compatibility/signoff remain
  human-owned release decisions. Security, platform, analytics, and consumer
  owners approve access, limits, rollout, rollback, retention, and garbage
  collection.

Cutover is clean: once analytics pointer publication is enabled, there is no
ongoing legacy catalog advancement. Keep prior live data and its established
serving path intact until consumer owners explicitly sign off on the new
pointer-based release. Operational/manual gates remain required; documentation
does not claim those gates or live validation have passed.

No implementation or documentation entry in this spec should be read as live
validation evidence. The spec's acceptance evidence is limited to the checks
performed and recorded by the responsible humans during release.

## 8. Acceptance criteria

1. The default daily run selects exactly the four analytics names in the stated
   sequential order and records a traceable batch/run ID.
2. Each dataset has an isolated release-scoped path and manifest; no dataset can
   publish to another's path. There are no per-dataset pointers; one analytics
   pointer selects the complete release.
3. Valid output satisfies its contract above and is immutable, readable Parquet
   under a new run directory.
4. Validation or ordinary dataset publication failure makes the batch
   unsuccessful and writes no release commit or pointer update. A later
   pointer CAS/IAM failure may leave an immutable `release.json`, but it remains
   unselected and invisible; the previous pointer remains selected. Later datasets
   may run, but no partial release is current; unreachable objects are
   lifecycle-cleaned.
5. Successful publication writes one immutable release manifest last and advances
   only `analytics/current.json` through GCS object-generation CAS and a
   monotonically increasing release sequence.
6. Retry and concurrent-publisher handling cannot overwrite committed objects or
   create a mixed-generation dataset.
7. Read-only database permissions, sensitive-output authorization, secret
   handling, and end-user denial satisfy Section 5.
8. The nonproduction PostgreSQL plan/read-volume human gate and the
   production IAM/load/freshness human gates are documented as release blockers;
   this document does not claim they have passed.
9. `analytics-etl export-local` accepts only validated local/nonproduction
   configuration and approved selections; it cannot create a GCS client or
   invoke publication or pointer code.
10. Local export requires an existing safe destination, creates a unique private
    staging directory, atomically finalizes only after all selected datasets
    succeed, and removes failed staging output without replacing the primary
    failure.
11. Local export documentation requires per-use security/operator approval,
    restricted access, explicit retention, and secure cleanup; these are
    operational gates and are not granted by the code.
