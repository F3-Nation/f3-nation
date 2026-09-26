# `pv_*` DuckDB release producer contract

This is the handoff contract for the external producer of the immutable
DuckDB/Parquet releases consumed by Pax Vault. The consumer treats a release as
untrusted input: a successful upload is not a publication. Publication occurs
only when the producer has validated the complete release and atomically
advanced `current.json`.

The normative Pax Vault migration requirements are in
[`duckdb-migration-plan.md`](./duckdb-migration-plan.md), and the nine approved
dataset projections and eligibility semantics are in
[`../specs/pax-vault-parquet-etl.md`](../specs/pax-vault-parquet-etl.md). This
document turns those requirements into an implementable producer interface.
Analytics is a separate product with its own four-dataset release and independent pointer; it
does not share a release or source-snapshot guarantee with Pax Vault.

## 1. What the checked-in sample has, and what it does not

The sample under
`.gcs/f3-analytics/parquets/releases/20260919T122348.105104Z-a9031809a896437ba37f6e32088e1c37/`
already demonstrates:

- an immutable-looking, unique release prefix;
- one Parquet object and one `manifest.json` below each dataset directory;
- per-file `uri`, `generation`, `size`, and `crc32c`;
- dataset `row_count`, `byte_count`, `file_count`, `schema_version`, and a
  `source_read_timestamp` for the actual per-dataset source read;
- a release-level `release.json` listing dataset manifest URIs and manifest
  generations;
- all nine required datasets: `pv_pax`, `pv_events`, `pv_regions`, `pv_areas`,
  `pv_sectors`, `pv_aos`, `pv_upcoming`, `pv_kotter`, and `pv_territories`.

It is **not yet a serving-contract release**. In particular, the sample has
no fixed `pax-vault/current.json`, no contract metadata or monotonic
`releaseSequence`, no SHA-256 for the canonical manifest, no schema/column
fingerprints, no required candidate-release verification goldens, and no producer evidence that
all object generations were read back and validated before publication. Its
per-dataset manifests and `release.json` are useful inputs, but must be
extended or regenerated to meet the schemas below. The agreed Pax Vault
contract explicitly includes `pv_territories` among its nine datasets; its
schema must therefore be included in the external consumer-compatibility gate.

## 2. Immutable layout and object set

Use one configured bucket and this Pax Vault layout:

```text
gs://BUCKET/pax-vault/releases/<releaseId>/release.json
gs://BUCKET/pax-vault/releases/<releaseId>/pv_pax/manifest.json
gs://BUCKET/pax-vault/releases/<releaseId>/pv_pax/partitions/pv_pax-0.parquet
gs://BUCKET/pax-vault/releases/<releaseId>/pv_events/manifest.json
gs://BUCKET/pax-vault/releases/<releaseId>/pv_events/partitions/pv_events-0.parquet
... one directory for every one of the nine Pax Vault datasets ...
gs://BUCKET/pax-vault/current.json
```

Analytics has an independent product root and pointer, analogously:
`gs://BUCKET/analytics/releases/<releaseId>/...` and
`gs://BUCKET/analytics/current.json`. Its exact datasets are
`event_info`, `future_event_info`, `attendance_info`, and
`missing_backblasts`. The products have independent release IDs, manifests,
publication/CAS state, and retention; neither pointer selects the other's data.

`releaseId` is unique, immutable, and safe as a path component (for example,
`20260919T122348.105104Z-a9031809a896437ba37f6e32088e1c37`). Never overwrite
or delete an object in a published prefix. Every URI must remain beneath that
prefix; reject `..`, alternate buckets, absolute/path-escaped names, unknown
files, duplicate datasets, and duplicate object entries. Each product's
`current.json` is its only mutable object.

The required Pax Vault dataset allowlist is exactly:
`pv_pax`, `pv_events`, `pv_regions`, `pv_areas`, `pv_sectors`, `pv_aos`,
`pv_upcoming`, `pv_kotter`, and `pv_territories`. A release must contain
exactly all nine, not merely a subset. Analytics independently requires exactly
`event_info`, `future_event_info`, `attendance_info`, and
`missing_backblasts` in its analytics release; these are not Pax Vault datasets.

The currently declared dataset schema versions are `pv_regions.v1`,
`pv_pax.v2`, `pv_kotter.v1`, `pv_upcoming.v1`, `pv_sectors.v2`,
`pv_territories.v1`, `pv_areas.v2`, `pv_aos.v1`, and `pv_events.v2` for Pax
Vault; analytics uses `event_info.v1`, `future_event_info.v1`,
`attendance_info.v1`, and `missing_backblasts.v1`. These are the declared
producer registry versions; exact columns, logical types, and nullability must
still pass the external compatibility gate.

## 3. Required release and dataset manifests

`release.json` is an immutable release index. It must identify the release,
contract, per-dataset read policy/timestamps, and every dataset manifest. Example (illustrative
values):

```json
{
  "contractVersion": "pv-release.v2",
  "releaseId": "20260919T122348.105104Z-a9031809a896437ba37f6e32088e1c37",
  "createdAtUtc": "2026-09-19T12:24:54.714278Z",
  "producerRevision": "pipeline@abc123",
  "sourceReadPolicy": "ordered-sequential-per-dataset",
  "datasets": {
    "pv_pax": {
      "manifestUri": "gs://BUCKET/pax-vault/releases/RELEASE/pv_pax/manifest.json",
      "manifestGeneration": "1789820643043457",
      "schemaVersion": "pv_pax.v2"
    }
  }
}
```

The example abbreviates the dataset map; production output must list every
allowlisted dataset and no others. `release.json` itself is not the pointer,
and it must not contain a self-referential hash. `pv-release.v2` is the Pax
Vault release/pointer contract emitted by the current producer. Analytics is
independent and uses `analytics-release.v1` for its release and pointer
contract; it does not use `pv-release.v2` or share Pax Vault publication state.

`pv_pax.v2` includes the approved email and roles fields. `pv_events.v2`
includes rich event content (`description`, `preblast`, `preblast_rich`,
`backblast`, `backblast_rich`, and `meta`), plus type/tag descriptions.
`pv_areas.v2` and `pv_sectors.v2` carry revised hierarchy outputs. These
requirements must be reflected in schema versions, fingerprints, columns, and
consumer compatibility checks. Each dataset must have `manifest.json`, with all
object metadata required to pin and validate reads:

```json
{
  "contractVersion": "pv-release.v2",
  "dataset": "pv_pax",
  "schemaVersion": "pv_pax.v2",
  "rowCount": 105026,
  "totalSizeBytes": 4397550,
  "schemaFingerprintSha256": "<sha256-of-canonical-columns-array>",
  "columns": [
    { "name": "user_id", "logicalType": "INTEGER", "nullable": true },
    { "name": "email", "logicalType": "VARCHAR", "nullable": true },
    {
      "name": "roles",
      "logicalType": "STRUCT(role_id INTEGER, role_name VARCHAR, org_id INTEGER, org_name VARCHAR, org_type VARCHAR)[]",
      "nullable": true
    }
  ],
  "sourceReadPolicy": "ordered-sequential-per-dataset",
  "sourceReadTimestampUtc": "2026-09-19T12:23:48.191387Z",
  "goldens": [
    {
      "name": "candidate_transport_check",
      "uri": "gs://BUCKET/pax-vault/releases/RELEASE/pv_pax/goldens/candidate_transport_check.json",
      "generation": "1789820642862753",
      "sizeBytes": 19,
      "query": "SELECT COUNT(*) AS row_count FROM pv_pax",
      "canonicalization": "rows-json-v1",
      "sha256": "<sha256-of-exact-artifact-bytes>"
    }
  ],
  "objects": [
    {
      "uri": "gs://BUCKET/pax-vault/releases/RELEASE/pv_pax/partitions/pv_pax-0.parquet",
      "generation": "1789820642862752",
      "sizeBytes": 4397550,
      "crc32c": "BpfXxg==",
      "rowCount": 105026
    }
  ]
}
```

The `columns` array above is illustrative and abbreviated. Array order is the
SQL projection order; each entry has exactly `name`, `logicalType`, and
`nullable`. The `roles` logical type is a list of structs with `role_id`,
`role_name`, `org_id`, `org_name`, and `org_type`. `nullable: true` is the
conservative top-level output policy, not proof that Parquet physically
contains nulls or that any field is physically non-nullable. Nested struct/list
physical types, repetition/nullability, and the distinction between top-level
and nested nullability require physical-file validation and external consumer
signoff. These remain release gates. The example SHA-256 is intentionally a
placeholder, not a computed test vector.

The golden object's bytes for a candidate count of one would be
`[[{"$bigint":"1"}]]` in UTF-8. The artifact is stored as the golden object;
it is not an extra `artifactUtf8` manifest field.

Use the exact GCS object generation returned after each upload. Include all
Parquet files if a dataset is partitioned. Every object path must be unique,
under the dataset release prefix, and its `sizeBytes`/`rowCount` must sum to
the manifest's `totalSizeBytes`/`rowCount`. The manifest's ordered `columns`
array must exactly match the approved schema for that product and dataset
(column names, DuckDB logical types, and nullability), and
`schemaFingerprintSha256` is the SHA-256 of its canonical bytes. Canonical
fingerprint input is the UTF-8 JSON encoding of that array, with object keys
sorted recursively, no insignificant whitespace, no BOM, and array order
preserved. Hash those exact bytes with SHA-256; do not hash a map or reorder the
array. Each release dataset must have at least one
candidate-release verification golden. It is generated from the actual
candidate release after producing its Parquet and is not independent parity
evidence. Its immutable `uri` and generation are downloaded generation-pinned
by the consumer; it carries `sizeBytes`, the exact registry verification
`query`, and an unambiguous `canonicalization` identifier. `rows-json-v1` means
the ordered DuckDB
`getRows()` JSON array, recursively canonicalized with sorted object keys;
NULL/undefined becomes `null`, bigint becomes `{ "$bigint": "..." }`,
decimal values remain exact strings, dates/timestamps become tagged ISO values,
buffers become `{ "$bytes": "base64" }`, and nested structs/lists/maps are
recursively canonicalized deterministically. It must
also carry either a SHA-256 of those canonical artifact bytes or a
`canonicalValue` whose canonical JSON bytes are compared. The producer executes
the verification query against the actual candidate data and stores its
canonical result as the golden artifact. The consumer executes that same query
after staging and compares its canonical result bytes to the artifact. These
release-specific goldens test transport/staging consistency: they establish
that consumer staging reproduces the producer's candidate result. They do not
independently prove SQL compatibility or correctness. Golden artifacts are
retained with their release.

The current producer's count verification golden runs `COUNT(*)` over the
candidate Parquet and records the result using `rows-json-v1` as the positional
row array `[[{"$bigint":"N"}]]` (where `N` is the decimal count). The manifest
query remains the allowlisted-dataset query, for example
`SELECT COUNT(*) AS row_count FROM pv_pax`. This is a candidate-release
transport check only; it is not independent fixture-parity evidence, a source
snapshot, or proof of SQL parity. Independent fixture-based parity is a
separate gate.

Artifact classes are exact: the manifest is only
`<release>/<dataset>/manifest.json`; Parquet objects are only
`<release>/<dataset>/partitions/<safe-name>.parquet`; and golden artifacts are
only `<release>/<dataset>/goldens/<safe-name>.json`. No artifact may be reused
across classes or datasets.

The compatibility registry is conceptually approved, but no external executable
registry has been furnished. Until it is supplied and implemented, publication
requires an explicit external consumer-compatibility gate: owners must verify
every serving and rollback-eligible revision against the proposed pointer,
release, and per-dataset schemas. Do not claim a machine-readable registry check
has run. The required registry must specify columns, types/nullability,
non-negative row-count policy, and deterministic verification query
specifications. Unknown schema versions, missing goldens,
column/fingerprint mismatches, per-dataset read-metadata inconsistencies,
duplicate object paths, and aggregate size/count mismatches are rejected.

## 4. `current.json`, hashes, and canonical bytes

Each product's fixed pointer must have this shape, with its own contract/schema
versions and product prefix (example shown for Pax Vault):

```json
{
  "contractVersion": "pv-release.v2",
  "releaseId": "20260919T122348.105104Z-a9031809a896437ba37f6e32088e1c37",
  "prefix": "gs://BUCKET/pax-vault/releases/20260919T122348.105104Z-a9031809a896437ba37f6e32088e1c37/",
  "manifestUri": "gs://BUCKET/pax-vault/releases/RELEASE/release.json",
  "manifestGeneration": "1789820696000000",
  "manifestSha256": "<sha256-of-release-json-canonical-bytes>",
  "schemaVersion": "pv-release.v2",
  "createdAtUtc": "2026-09-19T12:24:54.714278Z",
  "producerRevision": "pipeline-abc123",
  "releaseSequence": 42
}
```

Here `manifestUri` refers to `release.json`; its generation and SHA-256 must
match the object actually read by the producer. On each successful forward
publication or rollback, `releaseSequence` is the currently observed sequence
plus one; on an initial pointer it starts at 1. CAS retries reread the pointer
and recalculate the next sequence. The pointer has **no
`pointerSha256`**. The GCS object generation returned for `current.json` is
the pointer-content version and is the CAS/read pin. GCS metageneration is
metadata state, not `releaseSequence`, and is not a substitute for content
CAS.

For Analytics, the analogous pointer fields use `analytics-release.v1` for
`contractVersion` and `schemaVersion` and the `analytics/releases/` prefix.
Analytics and Pax Vault remain separate contracts and release chains.

Canonical JSON means UTF-8, one JSON value, object keys sorted recursively by
Unicode code point, no insignificant whitespace, no BOM, and deterministic
number rendering (integers where the schema says integer; no NaN or Infinity).
Do not hash parsed then differently re-serialized JSON. Serialize once using a
canonical JSON implementation, hash those exact bytes with SHA-256, and upload
those exact bytes. Hashes are lowercase hexadecimal. Verify by downloading the
object and hashing the downloaded bytes. There is no self hash in any object.

## 5. Publish protocol and CAS

1. Allocate a new `releaseId` and write every Parquet object under its new
   prefix. Do not reuse a prefix after any failed attempt.
2. Read back every object and record generation, size, and CRC32C. Validate
   Parquet table names, columns, logical types, nullability, row counts, schema
   fingerprint, actual source-read metadata, and candidate-release verification
   goldens. Independent SQL parity is validated separately from the release.
3. Canonicalize and write `release.json` only after its dataset manifests are
   complete. Read it back, verify its generation, bytes, and SHA-256, then
   validate the complete candidate against the allowlists and registry.
4. Read the product-specific pointer (`pax-vault/current.json` or
   `analytics/current.json`) and record its GCS object generation. Update it with
   `ifGenerationMatch=<observed generation>`. For first creation, use
   `ifGenerationMatch=0` (create-only). This is content CAS; do not use
   metageneration for it.
5. Read that same product-specific pointer back and validate its content and
   returned GCS object generation. A failed precondition is not publication:
   re-read the pointer, choose the next sequence, and retry. Never overwrite a
   release prefix. An ambiguous transport error must be reconciled against the
   observed pointer; do not report it as definitely uncommitted unless the
   pointer state proves that outcome.

The pointer update replaces content at one exact object key. The required GCS
content-replacement permission must be scoped to that exact product pointer
object, not inferred from a generic metadata-update permission. Human security
owners must approve and verify the actual binding; this document makes no claim
that a live IAM binding exists.

Consumers download the pointer, then the manifest and every Parquet object
with generation-pinned GCS reads. They stream objects directly into a unique
candidate directory and enforce configured maximum release and per-object byte
budgets before downloading. They validate every partition, aggregate, schema,
golden, and source timestamp, re-read the pointer immediately before
activation, and discard/restart if the pointer generation changed. This
prevents mixing releases during a concurrent update without retaining all
Parquet buffers in memory.

## 6. Compatibility, source parity, and registry

The compatibility registry is conceptually approved, but no external executable
registry has been furnished. Once provided, maintain a versioned,
machine-readable registry of supported pointer `contractVersion`, manifest
`contractVersion`, and every dataset `schemaVersion`, including which
application revisions remain rollback-eligible. Until then, use the explicit
external consumer-compatibility gate and do not claim an executable check has
run. Publishing is blocked if any serving or rollback-eligible revision cannot
read the candidate. Additive fields require consumer tolerance;
renames/removals require a new contract version and coordinated rollout.

The nine Pax Vault datasets and four analytics datasets are read sequentially,
with independent per-dataset read boundaries; they are not one PostgreSQL or
BigQuery snapshot. Record each dataset's actual source read timestamp and the
declared read policy. Never describe these reads as a shared snapshot or claim
that datasets came from the same source snapshot. A per-dataset read timestamp
is taken at that dataset's actual source read boundary, not assigned from the
batch start or release publication time.

Keep two evidence classes separate:

1. **Independent SQL compatibility/parity evidence** uses fixed, retained
   fixtures or another immutable reference and compares implementation results
   with independently established expected results. It covers rows, ordering,
   NULLs, empty arrays, JSON parsing, aggregates, date boundaries, filters,
   limits, and error behavior for each migrated query path. This evidence is
   maintained outside release-specific verification goldens; it does not use
   changing live BigQuery data as the comparison baseline.
2. **Candidate-release verification goldens** are generated for each actual
   candidate from its produced Parquet/release data. They are retained in that
   candidate's immutable prefix and replayed by the consumer after staging to
   verify transport, object pinning, and staged-data consistency. They are not
   independent SQL parity evidence and must not be described as such.

## 7. Retention, rollback, and incomplete releases

The retention targets are: keep current and previous valid releases for at
least one day for rollback, retain ordinary completed releases for 14 days, and
do not consider abandoned prefixes for cleanup until they are at least 14 days
old. Never delete the current release. Any future cleanup process must preserve
rollback-eligible prefixes and be generation-aware. These are operational
retention requirements, not a claim that automated garbage collection or a live
GCS lifecycle policy is implemented. A failed or incomplete prefix is never
referenced by `current.json`; producer bookkeeping should mark it abandoned.
Consumers must
continue using their last-known-good release on refresh failure, subject to
their configured maximum age; they must not fall back silently to BigQuery.

Rollback is a normal validated pointer CAS to a retained, previously valid
release. It uses the same generation/hash checks and ordering as forward
publication. Never mutate the rolled-back prefix.

Pub/Sub may emit a “release available” event to accelerate reconciliation, but
it is optional and is not the source of truth. Events may be lost, duplicated,
or reordered; consumers always reconcile from `current.json`.

## 8. Producer implementation checklist

- [ ] Use the configured bucket and exact immutable prefix layout.
- [ ] Publish exactly the nine Pax Vault datasets, or exactly the four
      analytics datasets under their separate product root and pointer.
- [ ] Generate complete per-dataset manifests and `release.json`.
- [ ] Record object generations, CRC32C, byte sizes, row counts, schema
      fingerprints, actual per-dataset read timestamps/policy, independent SQL
      parity evidence, and candidate-release verification goldens.
- [ ] Canonicalize JSON and compute SHA-256 over the exact uploaded bytes.
- [ ] Validate all objects and manifests by generation-pinned read before CAS.
- [ ] Pass the external consumer-compatibility gate for all serving and
      rollback-eligible revisions (until an executable registry is furnished).
- [ ] Use create-only `ifGenerationMatch=0` for first `current.json` creation.
- [ ] Use observed-generation `ifGenerationMatch` for every pointer update.
- [ ] Read back and validate the pointer after a successful CAS.
- [ ] Retain current and previous at least one day, ordinary releases 14 days,
      abandoned prefixes at least 14 days, and never delete current.
- [ ] Never publish incomplete prefixes, mutate published objects, or rely on
      Pub/Sub delivery.

## 9. Acceptance tests

The producer handoff is accepted only when these tests pass against a GCS
test bucket (or an equivalent generation-faithful emulator):

1. Given identical canonical manifest inputs (including release ID, object
   URIs/generations, timestamps, schemas, and counts), canonical serialization
   yields identical manifest bytes and SHA-256. Fresh runs with different
   release IDs, object generations, or timestamps are expected to differ.
2. The sample-shaped release is rejected when it lacks pointer metadata,
   manifest SHA-256/schema fingerprints/goldens, or lacks any of the required
   nine Pax Vault datasets.
3. Missing dataset, extra file, duplicate dataset, path traversal, wrong
   bucket, unknown schema version, and malformed canonical JSON are rejected.
4. Changing a Parquet byte, size, CRC32C, generation, row count, schema, or
   manifest byte after manifest creation is detected before publication.
5. Two publishers racing on `current.json` yield exactly one successful CAS;
   the loser retries from a fresh pointer and never claims publication.
6. First creation succeeds only with `ifGenerationMatch=0`; an existing
   pointer causes creation to fail rather than overwrite it.
7. A pointer generation change during staging causes consumer activation to
   discard the candidate; all reads remain pinned to one release.
8. A valid retained release can be rolled back by the same pointer CAS, while
   an incomplete or deleted release cannot be referenced.
9. The external consumer-compatibility gate verifies support from every
   serving and rollback-eligible revision; this is not represented as an
   executable registry test until that registry is furnished and implemented.
10. Actual per-dataset read timestamps/policy and candidate-release verification
    goldens are present; replayed consumer results match those candidate
    artifacts. Separately, independent fixture-based SQL parity evidence passes.
    No shared-snapshot guarantee is asserted, and changing live BigQuery data
    is not the independent parity baseline.

Validation owner: parent.
