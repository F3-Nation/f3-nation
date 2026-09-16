# Daily analytics Parquet materializations

> **Approved by the user: 2026-08-26.** This document is the contract for the
> nine approved materializations. It describes the intended capability; it does
> not claim that live database, GCS, IAM, or production validation has
> been performed.

## 1. Summary

The analytics Cloud Run Job is a non-interactive daily full-refresh publisher. It
reads PostgreSQL transaction data through a dedicated read-only connection, uses
DuckDB to produce Parquet, and publishes immutable run-scoped objects to GCS.
The default invocation materializes all nine datasets in the explicit order
listed below, sequentially (not concurrently). One batch source-order value is
used for every dataset and the release manifest. An ordinary failure for one
dataset is recorded and does not prevent later datasets from running; the batch
exits unsuccessfully and cannot commit a release if any dataset fails.

The nine materializations are exactly:

1. `pv_regions`
2. `pv_pax`
3. `pv_kotter`
4. `pv_upcoming`
5. `pv_sectors`
6. `pv_territories`
7. `pv_areas`
8. `pv_aos`
9. `pv_events`

The batch is the publication unit. A dataset's failure or upload conflict may
leave unreachable staged objects, but cannot change the consumer-selected
release. Full release consistency takes priority over individual freshness.

## 2. Environment targets and operation

Production targets are, for each `<name>` in the approved list:

- GCS: `gs://f3-analytics/parquets/releases/<run-id>/<name>`

Nonproduction targets are:

- GCS: `gs://f3-analytics-nonprod/parquets/releases/<run-id>/<name>`

The job runs in project `f3data`, region `us-central1`. Production uses Cloud
SQL instance `f3data`; nonproduction uses `f3data-nonprod`. Cloud Run uses Cloud
SQL Unix sockets. Production is Scheduler-triggered daily; nonproduction is
manually invoked. Scheduler and task retries are zero. Jobs use one task and
parallelism, and a 60-minute timeout. Retention/lifecycle policy, not the
publisher, removes unreachable staged releases.

The default is all nine datasets in the order above. A subset may be used for
local export or diagnostics, but a publication run rejects any selection other
than the exact approved nine-name registry set. Only the exact set may create
the global release commit or advance the catalog.

## 3. Source and common publication contract

- PostgreSQL base tables are the only source. The database role is read-only:
  no INSERT, UPDATE, DELETE, DDL, or administrative privileges.
- DuckDB attaches PostgreSQL read-only and uses one documented read boundary per
  dataset. The batch source-order value is the logical batch-start ordering
  value, not a database-wide snapshot. The job supplies `refreshed_at` and `as_of_date`
  parameters where the query contract calls for them.
- Every dataset writes only beneath
  `parquets/releases/<run-id>/<dataset>/`. Parquet files and dataset manifests
  are immutable and create-if-absent; corrections create a new run.
- Before publication, generated files are checked for readable valid Parquet,
  expected schema, completeness, counts, and integrity metadata. Missing,
  malformed, duplicate, or schema-invalid data fails that dataset before it can
  contribute to the batch commit.
- A dataset manifest is the commit record and includes at least dataset name,
  run ID, exact committed directory, complete object list, checksums or
  equivalent integrity values, row/file/byte counts, schema version,
  logical batch-start source-order value, and publication timestamp. Any
  per-dataset read timestamp is descriptive and is not a database-wide snapshot.
- After all nine datasets are durable and validated, the publisher writes
  `parquets/releases/<run-id>/release.json` once, create-if-absent. It is the
  immutable commit record containing the nine generation-pinned dataset
  manifest references. It is written last. A catalog CAS or IAM failure may
  leave this immutable `release.json` present, but it remains unselected and
  invisible; catalog metadata alone determines consumer visibility.
- One fixed `parquets/catalog.json` has immutable empty content. Its
  schema-versioned custom metadata is changed only with
  `if_metageneration_match`, and records current/previous release IDs,
  manifest URIs and generations, source-order values, and a high-water
  source-order value. The object generation does not change on metadata update.
- Source order is the batch's comparable logical batch-start ordering value, not
  a database-wide snapshot. An older
  candidate cannot supersede current or lower the high-water value. After a CAS
  conflict, a newer candidate reloads and retries with the actual
  metageneration; a stale candidate fails safely.
- A human rollback may select only the retained, generation-pinned previous
  release through the explicit catalog metadata-CAS rollback operation. It
  retains the high-water value, so an in-flight stale run cannot undo the
  rollback. A genuinely newer source order may advance afterward.
- PAX Vault must read catalog metadata, retrieve the pinned `release.json`
  generation, then consume exactly its nine pinned dataset manifests and the
  objects they list. PAX Vault compatibility must be deployed and verified
  before catalog activation; PAX Vault rollout is external and consumer-owner
  owned.

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

Columns: `area_id`, `area_name`, `sector_id`, `sector_name`, `territory_id`,
`territory_name`, `logo_url`, `is_active`, `regions`.

`regions` contains child region records `{region_id, region_name, is_active}`.

### `pv_aos` — one row per AO

Columns: `refreshed_at`, `ao_id`, `ao_name`, `region_id`, `region_name`,
`logo_url`, `is_active`, `types`, `tags`.

`types` and `tags` contain `{type_id, type_name}` and `{tag_id, tag_name}`
derived from active events with non-null `pax_count` belonging to that AO.

### `pv_sectors` — one row per sector

Columns: `sector_id`, `sector_name`, `logo_url`, `is_active`, `territories`, `areas`.

`areas` contains sector-wide descendant area records `{area_id, area_name,
is_active}`, including areas reached through territories.

`pv_sectors.areas` contains every descendant area of the sector, whether direct
or nested under a territory.

`territories` contains child territory records `{territory_id, territory_name,
logo_url, is_active}`.

### `pv_territories` — one row per territory

Columns: `territory_id`, `territory_name`, `sector_id`, `sector_name`,
`logo_url`, `is_active`, `areas`.

`areas` contains child area records `{area_id, area_name, is_active}`.

### `pv_events` — one row per eligible event instance

Columns: `refreshed_at`, `event_id`, `event_date`, `event_name`, `pax_count`,
`fng_count`, `ao_org_id`, `ao_name`, `region_org_id`, `region_name`,
`area_org_id`, `area_name`, `territory_org_id`, `territory_name`,
`sector_org_id`, `sector_name`, `first_f_ind`,
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
objects, manifests, or catalog metadata.

The `pv_pax`, `pv_kotter`, and `pv_events` outputs are sensitive PAX/Kotter/events
data and their inclusion is explicitly authorized by this approval. Access is
limited to the approved ETL workload and explicitly approved PAX Vault/analytics
consumer identities; it is not direct end-user access. Security must approve
least-privilege database grants, IAM and impersonation boundaries, secret
delivery, network path, encryption/key ownership, audit retention, and whether
PAX Vault may read GCS directly. Credentials never enter logs or Parquet, and
logs/metrics contain no row-level sensitive data.

The publisher's release-path grant is create/get, scoped to
`parquets/releases/`; it has no delete and cannot overwrite
existing release content. The fixed catalog separately permits get/create and
`storage.objects.update` only on
`projects/_/buckets/<bucket>/objects/parquets/catalog.json` for metadata CAS.
Do not grant object update across `parquets/`. Nonprod and production buckets
and runtime identities remain distinct, and the exact bindings require human
security/platform approval.

## 6. Failure isolation, reliability, and observability

The batch owns publication lifecycle. Source/query, validation, upload, release,
and catalog-CAS errors are classified with dataset or batch context.
The runner continues after ordinary exceptions, records all failed names and
recovery metadata, then returns a nonzero/unsuccessful batch result. Process
cancellation is not treated as an ordinary dataset failure.

Structured events and metrics include batch/run ID, materialization name,
environment, phase, durations, counts, logical batch-start source order, committed
directory, outcome, catalog metageneration, publication lag, retry count, and
error class.
Use the approved logging abstraction rather than `console.*`; never emit
credentials, tokens, connection strings, PII, or raw rows. Alert on missed daily
execution, stale catalog source order, SLO/freshness breaches, repeated failures,
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
  query plans and measured read volume for all nine datasets against approved
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

1. The default daily run selects exactly the nine names in the stated sequential
   order and records a traceable batch/run ID.
2. Each dataset has an isolated release-scoped path and manifest; no dataset can
   publish to another's path. There are no per-dataset leases or `current.json`
   pointers.
3. Valid output satisfies its contract above and is immutable, readable Parquet
   under a new run directory.
4. Validation or ordinary dataset publication failure makes the batch
   unsuccessful and writes no release commit or catalog metadata. A later
   catalog CAS/IAM failure may leave an immutable `release.json`, but it remains
   unselected and invisible; catalog metadata remains unchanged. Later datasets
   may run, but no partial release is current; unreachable objects are
   lifecycle-cleaned.
5. Successful publication writes one immutable release manifest last and advances
   only the fixed catalog through metageneration CAS and monotonic source order.
6. Retry and concurrent-publisher handling cannot overwrite committed objects or
   create a mixed-generation dataset.
7. Read-only database permissions, sensitive-output authorization, secret
   handling, and end-user denial satisfy Section 5.
8. The nonproduction PostgreSQL plan/read-volume human gate and the
   production IAM/load/freshness human gates are documented as release blockers;
   this document does not claim they have passed.
9. `analytics-etl export-local` accepts only validated local/nonproduction
   configuration and registry-validated selections; it cannot create a GCS
   client or invoke publication or catalog code.
10. Local export requires an existing safe destination, creates a unique private
    staging directory, atomically finalizes only after all selected datasets
    succeed, and removes failed staging output without replacing the primary
    failure.
11. Local export documentation requires per-use security/operator approval,
    restricted access, explicit retention, and secure cleanup; these are
    operational gates and are not granted by the code.
