# Pax Vault Parquet materializations

> **Approval scope:** The 2026-08-26 approval applies to the inherited scope
> and ordered set of nine `pv_*` materializations only. The separately
> human-approved revised acceptance criteria defined below expand the scope to
> ten datasets by appending `pv_attendance`; they also revise `pv_pax` as
> described below. Neither scope approval satisfies human security, platform,
> scale, consumer-compatibility, or production gates.
> This document is not evidence that database, GCS, IAM,
> schema-registry, consumer-compatibility, or production validation has passed.
> Security and operational gates remain explicit release blockers.

## 1. Product and release boundary

Pax Vault is an independent product from the four analytics materializations in
[`analytics-parquet-etl.md`](./analytics-parquet-etl.md). It publishes exactly
these ten datasets, in this order:

1. `pv_regions`
2. `pv_pax`
3. `pv_kotter`
4. `pv_upcoming`
5. `pv_sectors`
6. `pv_territories`
7. `pv_areas`
8. `pv_aos`
9. `pv_events`
10. `pv_attendance`

Production objects are rooted under
`gs://BUCKET/pax-vault/releases/<releaseId>/`; nonproduction uses the
corresponding configured nonproduction bucket and the same `pax-vault/` product
prefix. A release has one immutable `release.json`, one dataset manifest for
each of the ten names, and their immutable Parquet objects. The independent
mutable selector is `gs://BUCKET/pax-vault/current.json`. A subset can be used
for local diagnostics, but only the exact ten-dataset set can be published.
Analytics uses its separate `analytics/releases/` root and
`analytics/current.json` pointer.

The ten-dataset set and current schema versions below are the only schemas for
new publication. A narrowly scoped rollback may select the exact retained
pre-upgrade nine-dataset release whose version vector is
`pv_regions.v1`, `pv_pax.v2`, `pv_kotter.v1`, `pv_upcoming.v1`,
`pv_sectors.v2`, `pv_territories.v1`, `pv_areas.v2`, `pv_aos.v1`, and
`pv_events.v2`. The historical `pv_pax.v2` projection has fourteen columns and
ends in `roles`; it does not include the `lifetime_posts` or `lifetime_qs`
columns in current `pv_pax.v3`. Rollback eligibility requires the exact release
identity, generation, URI, and manifest hash recorded as `retainedPrevious` by
the current pointer, followed by full release and Parquet validation. That hash
binds the retained manifest bytes but is not a signature or independent proof
of publisher identity. Rollback continues to use pointer generation
compare-and-swap and preserves the source-order high-water mark. No hybrid
version vector or arbitrary old release is eligible. Consumer compatibility
for serving this historical shape remains a human release gate.

The batch reads datasets in the order above, sequentially. Each dataset has its
own source read boundary. Sequential reads do not constitute a shared
PostgreSQL transaction snapshot; release metadata must not claim snapshot
consistency or that all datasets came from one source snapshot. Record the
actual source read timestamp for each dataset, not a shared batch timestamp
masquerading as the read time.

Pax Vault uses the `pv-release.v2` release and pointer contract. Analytics is a
separate product with its independent `analytics-release.v1` contract; neither
contract selects or versions the other's releases. Dataset manifest `columns`
is an ordered array of `{name, logicalType, nullable}` records in exact SQL
projection order. Its schema fingerprint is SHA-256 over the canonical UTF-8
JSON bytes of that array: object keys are sorted recursively, insignificant
whitespace and BOM are omitted, and array order is preserved. The current
registry's top-level `nullable: true` values are a conservative output policy,
not proof that physical Parquet fields contain nulls or are physically
non-nullable. Nested physical types and repetition/nullability require
physical-file validation and external consumer signoff; those remain gates.
No concrete schema-fingerprint hash vector is asserted here.

The candidate count verification golden represents count `N` under
`rows-json-v1` as the positional bigint result `[[{"$bigint":"N"}]]`, while
its query names the allowlisted dataset (for example,
`SELECT COUNT(*) AS row_count FROM pv_pax`). This candidate-artifact transport
check is distinct from independent fixture-based query-parity evidence. It
does not imply a source snapshot or prove SQL parity.

## 2. Ordered dataset contracts

The following column names and order describe the SQL output projection. The
schema registry must additionally verify the DuckDB logical types and
nullability; nullability is not inferred by this document. Nested lists are
deterministically ordered as specified and empty relationships are `[]`, not
omitted rows.

### `pv_regions` — one row per region organization

Columns, in order: `region_id`, `region_name`, `area_id`, `area_name`,
`logo_url`, `is_active`, `aos`, `types`, `tags`, `refreshed_at`.

All region organizations are emitted, including inactive regions. A region's
area is its direct parent only when that parent has `org_type = 'area'`. The
`aos` list contains distinct `{ao_org_id, ao_name}` records; `types` and `tags`
contain distinct `{type_id, type_name}` and `{tag_id, tag_name}` records.
Vocabulary and AO relationships come only from active event instances with
non-null `pax_count` and valid `exclude_from_pax_vault` metadata set false or
null. Events with the flag true are excluded; a non-boolean/non-null flag fails
the dataset. Event organizations resolve to a direct region or an AO whose
parent is a region. Lists sort by display name then ID; no observed relationship
produces an empty list.

### `pv_pax` — one row per user with eligible email

Columns, in order: `refreshed_at`, `user_id`, `f3_name`, `home_region_id`,
`home_region_name`, `avatar_url`, `email`, `status`, `start_date_override`,
`regions`, `aos`, `types`, `tags`, `roles`, `lifetime_posts`, `lifetime_qs`.

Email must be non-null and match the practical SQL pattern
`^[^\s@]+@[^\s@]+\.[^\s@]+$`: non-empty local and domain portions, no
whitespace or `@` within either portion, and a dot with a non-empty final
portion. This is a pragmatic eligibility check, not RFC-complete address
validation, mailbox verification, or proof of deliverability. `f3_name` falls
back to the user ID rendered as text when null/blank. `start_date_override` is
read from scalar JSON string/numeric/boolean values and represented as text;
compound values and JSON null yield null.

`regions` contains distinct `{region_org_id, region_name}` and `aos` contains
distinct `{ao_org_id, ao_name}` values from observed, non-planned attendance on
active events with non-null `pax_count` and no true
`exclude_from_pax_vault` flag. Only supported direct-region or AO-under-region
hierarchy rows contribute observations. `types` and `tags` contain distinct
`{type_id, type_name}` and `{tag_id, tag_name}` values observed on those same
eligible events. All four lists are ordered deterministically by name and ID
(roles by organization ID then role ID), and are empty lists when there are no
matching records.

`lifetime_posts` is the distinct count of eligible event instances with actual
(non-planned) attendance by the user; `lifetime_qs` is the distinct count of
those event instances where the user's actual attendance has an attached `Q`
attendance type. Count distinct event-instance IDs, not attendance rows. Both
are `INTEGER` and are zero when there are no qualifying events. Q status is
derived only from the attendance's attached Q attendance-type row, not from a
user-level flag or another event attribute.

`roles` is a list of records shaped
`{role_id, role_name, org_id, org_name, org_type}` sourced from
`roles_x_users_x_org`. Duplicate assignment triples are collapsed. Role and org
dimension joins are left joins: if a referenced role or org dimension is
missing, the assignment remains, the corresponding name falls back to its ID
rendered as text, and missing org type is null. These application role records
are profile data only; **roles are not an authorization source** for the
publisher or consumers.

### `pv_kotter` — one row per qualifying Kotter candidate

Columns, in order: `user_id`, `home_region_id`, `f3_name`, `avatar_url`,
`kotter_status`, `total_events`, `first_event_date`, `days_since_last_event`,
`last_event_date`, `last_event_name`, `last_event_ao_name`,
`last_event_ao_org_id`, `bestie_list`.

The input is distinct actual (non-planned) attendance by users with non-null
email matching the same practical syntax pattern documented for `pv_pax`, on
active events with non-null `pax_count`, excluding events with
`meta.exclude_from_pax_vault = true`. A malformed non-null/non-boolean exclusion
flag fails the dataset. Candidates have 14–90 days since their most recent
actual event. The classification output is one of `New PAX Drop`,
`Veteran Drift`, `Seasonal`, `Soft Drift`, `Active`, or `Inactive`, using the
current SQL's thresholds and precedence. `bestie_list` contains at most three
`{user_id, f3_name, avatar_url, co_attendance_count}` records, sorted by
co-attendance descending then user ID ascending; absent besties produce `[]`.
Results are sorted by days since last event ascending, then `f3_name`.

### `pv_upcoming` — upcoming event-type-category rows

Columns, in order: `refreshed_at`, `start_date`, `start_time`, `ao_name`,
`ao_org_id`, `region_org_id`, `location_name`, `event_name`, `event_type`,
`event_category`, `q_list`.

Include active events with `start_date > as_of_date` and no true
`exclude_from_pax_vault` metadata flag; malformed flags fail the dataset. Events,
locations, and the AO organization are left-joined, without an AO `org_type` or
other AO eligibility predicate. Region is populated only when the joined AO's
direct parent is a region. `event_name` is `COALESCE(ei.name, e.name)`.
`event_type` is the ordered distinct event-type names for one event/category;
the result grain can therefore contain multiple category rows per event.
`q_list` is a distinct list of users joined through attendance-type rows where
type is `Q`; actual and planned attendance both contribute. Names fall back to
user ID when blank and entries sort by name then user ID. Missing Qs yield `[]`.
Rows sort by start date then event-instance ID.

### `pv_sectors` — one row per sector organization

Columns, in order: `sector_id`, `sector_name`, `logo_url`, `is_active`,
`territories`, `areas`.

`territories` contains direct child territories shaped
`{territory_id, territory_name, logo_url, is_active}`. `areas` contains every
descendant area of the sector, whether directly nested or reached through a
territory or other descendant organization, shaped
`{area_id, area_name, is_active}`. Both lists sort by display name then ID and
are empty when no matching descendants exist.

### `pv_territories` — one row per territory organization

Columns, in order: `territory_id`, `territory_name`, `sector_id`, `sector_name`,
`logo_url`, `is_active`, `areas`.

The sector is populated only when the territory's direct parent has
`org_type = 'sector'`. `areas` contains direct child area records shaped
`{area_id, area_name, is_active}`, sorted by display name then ID; no children
produces `[]`.

### `pv_areas` — one row per area organization

Columns, in order: `area_id`, `area_name`, `sector_id`, `sector_name`,
`territory_id`, `territory_name`, `logo_url`, `is_active`, `regions`.

The area walks its ancestor chain to identify sector and territory. `regions`
contains direct child region records shaped
`{region_id, region_name, is_active}`, sorted by display name then ID; no
children produces `[]`.

### `pv_aos` — one row per AO organization

Columns, in order: `refreshed_at`, `ao_id`, `ao_name`, `region_id`,
`region_name`, `logo_url`, `is_active`, `types`, `tags`.

All AO organizations are emitted; the region is populated only when the direct
parent has `org_type = 'region'`. `types` and `tags` are distinct
`{type_id, type_name}` and `{tag_id, tag_name}` records from active events with
non-null `pax_count` directly belonging to that AO. These vocabulary queries do
not apply the `exclude_from_pax_vault` metadata predicate. Lists sort by display
name then ID and are `[]` when empty.

### `pv_events` — one row per eligible event instance

Columns, in order: `refreshed_at`, `event_id`, `event_date`, `event_name`,
`pax_count`, `fng_count`, `description`, `preblast`, `preblast_rich`,
`backblast`, `backblast_rich`, `meta`, `ao_org_id`, `ao_name`,
`region_org_id`, `region_name`, `area_org_id`, `area_name`,
`territory_org_id`, `territory_name`, `sector_org_id`, `sector_name`,
`first_f_ind`, `second_f_ind`, `third_f_ind`, `types`, `tags`, `attendance`.

Include active events with non-null `pax_count` and a false/null
`meta.exclude_from_pax_vault`; invalid non-null/non-boolean flag values fail.
The recursive organization ancestor lookup supplies AO, region, area, territory,
and sector IDs/names (bounded to 20 ancestors and protected against cycles).
`preblast_rich` and `backblast_rich` are JSON values; `meta` is retained as JSON.
Type entries are `{id, name, description, event_category}`; tag entries are
`{id, name, description}`. Both lists sort by name then ID and are `[]` if
empty. Only attendance users with non-null email matching the practical email
syntax pattern above are included. Attendance is grouped per event and user and
contains `{user_id, f3_name, q_ind, coq_ind, avatar_url, attended, ghost,
fartsack}`; the flags distinguish actual from planned attendance and lists sort
by name then user ID. Missing attendance, types, or tags produce empty lists.

### `pv_attendance` — one row per eligible actual attendance ID

Columns, in exact order: `refreshed_at`, `id`, `user_id`,
`event_instance_id`, `q_ind`, `coq_ind`, `start_date`, `ao_org_id`,
`region_org_id`, `tags`, `types`, `categories`. Do not include
`attendance_meta`, `created`, `updated`, `ao_name`, or pax profile fields
(`f3_name`, `home_region_id`, `home_region_name`, `avatar_url`,
`user_status`).

Each source attendance ID produces one row; do not aggregate or deduplicate
attendance records by user or event. Include actual attendance only (exclude
planned attendance), and only for users with a non-null email matching the
practical email syntax specified for `pv_pax`. Events use exactly the
`pv_events` eligibility rule: active event instances with non-null `pax_count`,
and `exclude_from_pax_vault` false or null. A true exclusion flag excludes the
event; malformed non-null/non-boolean values fail the dataset. `attendance_meta`
is not projected. `q_ind` and `coq_ind` identify whether the attendance has the
attached Q and Co-Q attendance types, respectively. `start_date` is the event
date. `ao_org_id` and `region_org_id` come from the same recursive
event-organization ancestry used by `pv_events`: retain the AO ID, and set
`region_org_id` to the event organization's region ancestor, including when the
event organization is itself a region; it is null when no region ancestor
exists. `tags` and `types` are distinct lists of integer IDs (not records),
sorted by ID ascending; `categories` is a distinct list of non-null enum
identifier strings, sorted lexicographically. The source has no numeric
category ID. Empty relationships are `[]`.

`pv_attendance.v1` is currently unreleased and unconsumed, per the product
owner. This projection may therefore be revised while it remains unreleased and
unconsumed; it does not imply compatibility gates have passed. The general
schema-version bump rule applies to released or consumed contracts, not to this
still-unreleased `pv_attendance.v1` revision.

## 3. Security and operational release gates

These are sensitive PAX and event datasets. The `pv_events` SQL currently has
no `is_private` filter and no `is_private` output column, so active eligible
events are not excluded based on privacy status. Event `meta`, private-event
content present in source-backed fields, and rich preblast/backblast JSON must
be treated as sensitive. Security owners must explicitly sign off on that
private-event inclusion behavior and sensitive-field exposure before
production. This scope description is not a substitute for
security authorization. Before production, human security/platform owners must
sign off on least-privilege PostgreSQL grants, sensitive-field inclusion,
private-event exposure, GCS IAM and consumer identities, impersonation and
secret-delivery boundaries, network path, encryption/key ownership, audit
retention, and whether PAX Vault may read GCS directly. The intended boundary
denies end-user invocation and direct source/release-object reads; this spec is
not evidence that deployed IAM enforces that boundary. Never log credentials,
PII, or row-level output.

The intended database role is read-only. Production and nonproduction must use
distinct buckets and runtime identities; this is a design requirement, not
evidence that the deployed permissions or identities have been verified. The
publisher writes create-only immutable
objects below the product's release prefix and updates only
`pax-vault/current.json` through GCS object-generation compare-and-swap. The
producer must validate all ten datasets and the complete release before the
pointer CAS; a failure leaves the prior pointer selected. Replacing pointer
content requires the GCS content-replacement permission scoped to the exact
`pax-vault/current.json` object. A generic metadata-update permission is not a
substitute, and no product-prefix-wide update grant is implied. A human security
owner must approve and verify the actual binding; this spec does not claim live
IAM has been configured or validated.

Sequential query plans, source read volume, connection/query scope, runtime,
and database load require human review against approved nonproduction data.
Production IAM, load sizing, freshness/SLO, retention/garbage collection,
rollback, and consumer/schema compatibility are human-owned release blockers.
Retention targets are at least one day for current and previous valid releases,
14 days for ordinary completed releases, and a minimum age of 14 days before
abandoned prefixes are eligible for cleanup; never delete current. These
targets do not claim automated garbage collection or a live lifecycle policy.
Keep prior live data and its serving path until consumer
owners sign off on the pointer-based cutover. This spec records intended
contracts, not passed gates or live validation evidence.

## 4. Validation references

The exact SQL projections and materialization rules live in
`apps/analytics/analytics/sql/pv_*.sql`; unit contracts and schema-version
declarations are in `apps/analytics/tests/`. Registry-declared current schema
versions are `pv_regions.v1`, `pv_pax.v3`, `pv_kotter.v1`, `pv_upcoming.v1`,
`pv_sectors.v2`, `pv_territories.v1`, `pv_areas.v2`, `pv_aos.v1`, and
`pv_events.v2`, and `pv_attendance.v1`. The approved schema-registry concept
does not establish that an
external executable registry or consumer compatibility check has been
furnished or run. The external compatibility gate must verify the exact
projection, logical types, nullability, and rollback-eligible consumer support.
