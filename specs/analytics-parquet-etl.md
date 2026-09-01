# Daily analytics Parquet materializations

> **Approved by the user: 2026-08-26.** This document is the contract for the
> eight approved materializations. It describes the intended capability; it does
> not claim that live database, GCS, IAM, or production validation has
> been performed.

## 1. Summary

The analytics Cloud Run Job is a non-interactive daily full-refresh publisher. It
reads PostgreSQL transaction data through a dedicated read-only connection, uses
DuckDB to produce Parquet, and publishes immutable run-scoped objects to GCS.
The default invocation materializes all eight datasets in the explicit order
listed below, sequentially (not concurrently). An ordinary failure for one
dataset is recorded and does not prevent later datasets from running; the batch
exits unsuccessfully if any dataset fails.

The eight materializations are exactly:

1. `pv_regions`
2. `pv_pax`
3. `pv_kotter`
4. `pv_upcoming`
5. `pv_areas`
6. `pv_aos`
7. `pv_sectors`
8. `pv_events`

Each dataset has an independent immutable run path, manifest, current pointer,
and publication lease. A dataset's failure or publication conflict must not
change the publication state of another dataset.

## 2. Environment targets and operation

Production targets are, for each `<name>` in the approved list:

- GCS: `gs://analytics/parquets/<name>`

Nonproduction targets are:

- GCS: `gs://f3-analytics-nonprod/parquets/<name>`

The job runs in project `f3data`, region `us-central1`. Production uses Cloud
SQL instance `f3data`; nonproduction uses `f3data-nonprod`. Cloud Run uses Cloud
SQL Unix sockets. Production is Scheduler-triggered daily; nonproduction is
manually invoked. Scheduler and task retries are zero. Jobs use one task and
parallelism, a 60-minute timeout, and a 90-minute generation-protected GCS
publication lease.

The default is all eight datasets in the order above. A narrowly allowlisted
selection may be used for operations or recovery, but it cannot introduce an
unknown name, duplicate a name, or select a different target. Future datasets,
cadences, and arbitrary query-driven selection require a new approval.

## 3. Source and common publication contract

- PostgreSQL base tables are the only source. The database role is read-only:
  no INSERT, UPDATE, DELETE, DDL, or administrative privileges.
- DuckDB attaches PostgreSQL read-only and uses one documented consistency
  boundary/snapshot per dataset. The job supplies `refreshed_at` and `as_of_date`
  parameters where the query contract calls for them.
- Every dataset writes only beneath a new unique run directory. Committed
  Parquet and manifests are immutable; corrections create a new run.
- Before publication, generated files are checked for readable valid Parquet,
  expected schema, completeness, counts, and integrity metadata. Missing,
  malformed, duplicate, or schema-invalid data fails that dataset before its
  pointer is changed.
- A dataset manifest is the commit record and includes at least dataset name,
  run ID, exact committed directory, complete object list, checksums or
  equivalent integrity values, row/file/byte counts, schema version,
  source-read/snapshot timestamp, and publication timestamp.
- The dataset's current pointer is advanced only after all its objects and
  manifest are durable, using a generation-conditional/concurrency-safe update.
  Readers resolve one pointer and consume only that generation.
- A prior known-good publication remains consumable on failure. Retries create
  distinct run IDs and never overwrite committed objects. Lease takeover,
  pointer recovery, rollback, garbage collection, retention, and alert
  escalation must preserve consumers and are human-approved operational policy.

## 4. User-query data contracts

The following are the approved output boundaries, grains, columns, and semantic
rules. Nested lists are deterministic (the query-defined name/ID ordering) and
empty relationships are represented as empty lists, not omitted rows.

### `pv_regions` — one row per region

Columns: `region_id`, `region_name`, `area_id`, `area_name`, `logo_url`,
`is_active`, `aos`, `types`, `tags`, `refreshed_at`.

`aos` contains `{ao_org_id, ao_name}`; `types` contains `{type_id, type_name}`;
`tags` contains `{tag_id, tag_name}`. Regions are derived from the org hierarchy.
Only active event instances with non-null `pax_count` contribute vocabulary and
AO relationships. Events marked `meta.exclude_from_pax_vault` must be excluded;
that flag is either boolean/null or the dataset fails validation.

### `pv_pax` — one row per eligible user

Columns: `refreshed_at`, `user_id`, `f3_name`, `home_region_id`,
`home_region_name`, `avatar_url`, `status`, `start_date_override`, `regions`,
`aos`, `types`, `tags`.

Users require a non-null, syntactically valid email. `f3_name` falls back to the
user ID when blank. `regions` contains `{region_org_id, region_name}` and `aos`
contains `{ao_org_id, ao_name}` from distinct observed attendance. `types` and
`tags` contain `{type_id, type_name}` and `{tag_id, tag_name}` respectively.
Observed attendance is non-planned attendance on active events with non-null
`pax_count`; no invalid or planned-only observation is included.

### `pv_kotter` — one row per classified eligible user

Columns: `user_id`, `home_region_id`, `f3_name`, `avatar_url`, `kotter_status`,
`total_events`, `first_event_date`, `days_since_last_event`, `last_event_date`,
`last_event_name`, `last_event_ao_name`, `last_event_ao_org_id`, `bestie_list`.

The source is actual, non-planned attendance by users with valid email on active,
non-null-`pax_count` events, excluding events marked with a true
`exclude_from_pax_vault` flag. The candidate window is 14–90 days since last
event. Status classification is the approved query logic: `New PAX Drop`,
`Veteran Drift`, `Seasonal`, `Soft Drift`, `Active`, or `Inactive`. `bestie_list`
contains at most three `{user_id, f3_name, avatar_url, co_attendance_count}`
records, ordered by co-attendance then user ID.

### `pv_upcoming` — upcoming event-instance/category rows

Columns: `refreshed_at`, `start_date`, `start_time`, `ao_name`, `ao_org_id`,
`region_org_id`, `location_name`, `event_name`, `event_type`, `event_category`,
`q_list`.

The event is active and has `start_date > as_of_date`. Events, locations, and
the AO organization are all left joined; there is no AO `org_type` or other AO
eligibility predicate. `event_name` is `COALESCE(ei.name, e.name)`.
`event_type` aggregates all distinct event type names with ordered
`STRING_AGG`. The grouping includes `event_category`, so differing categories
produce distinct output rows. `q_list` comes from attendance joined through
`attendance_x_attendance_types` to `attendance_types` where `att.type = 'Q'`;
it includes both actual and planned attendance and is ordered by `f3_name`.
Missing relationships are empty/null according to the query schema.

### `pv_areas` — one row per area

Columns: `area_id`, `area_name`, `sector_id`, `sector_name`, `logo_url`,
`is_active`, `regions`.

`regions` contains child region records `{region_id, region_name, is_active}`.

### `pv_aos` — one row per AO

Columns: `refreshed_at`, `ao_id`, `ao_name`, `region_id`, `region_name`,
`logo_url`, `is_active`, `types`, `tags`.

`types` and `tags` contain `{type_id, type_name}` and `{tag_id, tag_name}`
derived from active events with non-null `pax_count` belonging to that AO.

### `pv_sectors` — one row per sector

Columns: `sector_id`, `sector_name`, `logo_url`, `is_active`, `areas`.

`areas` contains child area records `{area_id, area_name, is_active}`.

### `pv_events` — one row per eligible event instance

Columns: `refreshed_at`, `event_id`, `event_date`, `event_name`, `pax_count`,
`fng_count`, `ao_org_id`, `ao_name`, `region_org_id`, `region_name`,
`area_org_id`, `area_name`, `sector_org_id`, `sector_name`, `first_f_ind`,
`second_f_ind`, `third_f_ind`, `types`, `tags`, `attendance`.

Events are active, have non-null `pax_count`, resolve their org hierarchy, and
are not excluded by the validated `exclude_from_pax_vault` flag. Type flags are
derived from event categories. `types` contains `{id, name, description,
event_category}` and `tags` contains `{id, name, description}`. `attendance`
contains `{user_id, f3_name, q_ind, coq_ind, avatar_url, attended, ghost,
fartsack}`; ghost/fartsack are derived from planned versus actual attendance.
Attendance users require valid email.

## 5. Authorization and sensitive data

This is a backend publication capability with no oRPC procedure, end-user
trigger, download, query, or edit action. Production and nonproduction use
separate runtime identities; the Scheduler identity is invoker-only and GitHub
WIF is the deployment identity. End users and application identities cannot
invoke the job, read PostgreSQL, read the ETL bucket, or mutate committed
objects, manifests, or pointers.

The `pv_pax`, `pv_kotter`, and `pv_events` outputs are sensitive PAX/Kotter/events
data and their inclusion is explicitly authorized by this approval. Access is
limited to the approved ETL workload and explicitly approved PAX Vault/analytics
consumer identities; it is not direct end-user access. Security must approve
least-privilege database grants, IAM and impersonation boundaries, secret
delivery, network path, encryption/key ownership, audit retention, and whether
PAX Vault may read GCS directly. Credentials never enter logs or Parquet, and
logs/metrics contain no row-level sensitive data.

## 6. Failure isolation, reliability, and observability

Each materialization acquires and releases its own 90-minute generation-conditional
lease and owns its own publication lifecycle. Lease conflicts, source/query,
validation, upload, and pointer errors are classified per dataset.
The runner continues after ordinary exceptions, records all failed names and
recovery metadata, then returns a nonzero/unsuccessful batch result. Process
cancellation is not treated as an ordinary dataset failure.

Structured events and metrics include batch/run ID, materialization name,
environment, phase, durations, counts, source snapshot time, committed
directory, outcome, pointer age, publication lag, retry count, and error class.
Use the approved logging abstraction rather than `console.*`; never emit
credentials, tokens, connection strings, PII, or raw rows. Alert on missed daily
execution, stale pointers, SLO/freshness breaches, repeated failures,
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
  query plans and measured read volume for all eight datasets against approved
  nonproduction data. The human gate must establish that sequential execution,
  connection/query scope, runtime, and source load are acceptable. Tests or
  synthetic fixtures do not substitute for this gate.
- **Production gates:** production IAM, production load sizing, and production
  freshness/SLO acceptance remain human-owned release decisions. Security,
  platform, analytics, and consumer owners approve access, limits, rollout,
  rollback, retention, and garbage collection.

No implementation or documentation entry in this spec should be read as live
validation evidence. The spec's acceptance evidence is limited to the checks
performed and recorded by the responsible humans during release.

## 8. Acceptance criteria

1. The default daily run selects exactly the eight names in the stated sequential
   order and records a traceable batch/run ID.
2. Each selected dataset has an isolated path, manifest, pointer, and lease; no
   dataset can publish to another's path or pointer.
3. Valid output satisfies its contract above and is immutable, readable Parquet
   under a new run directory.
4. Validation or ordinary publication failure leaves that dataset's prior
   pointer consumable, while later datasets still run; any failure makes the
   batch unsuccessful.
5. Successful publication advances only the matching generation-protected
   current pointer after durable GCS commit.
6. Retry and concurrent-publisher handling cannot overwrite committed objects or
   create a mixed-generation dataset.
7. Read-only database permissions, sensitive-output authorization, secret
   handling, and end-user denial satisfy Section 5.
8. The nonproduction PostgreSQL plan/read-volume human gate and the
   production IAM/load/freshness human gates are documented as release blockers;
   this document does not claim they have passed.
9. `analytics-etl export-local` accepts only validated local/nonproduction
   configuration and registry-validated selections; it cannot create a GCS
   client or invoke publication, lease, pointer, or publisher code.
10. Local export requires an existing safe destination, creates a unique private
    staging directory, atomically finalizes only after all selected datasets
    succeed, and removes failed staging output without replacing the primary
    failure.
11. Local export documentation requires per-use security/operator approval,
    restricted access, explicit retention, and secure cleanup; these are
    operational gates and are not granted by the code.
