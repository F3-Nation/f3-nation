# Temporary Orphaned Event-Series Future-Instance Backfill

> Human designer: Parent orchestrator (human approval granted; no production run
> before human approval)

## 1. Summary

Provide a temporary, operator-run local backfill that identifies eligible active
event series with no active future instance and creates their future instances,
without changing the schema or API. The command defaults to dry-run and requires
an explicit `--apply` for production writes.

## 2. Context & links

- App(s) affected: api / tooling
- Key code: `packages/api/src/lib/cascade-service.ts`
- Runtime database: `DATABASE_URL` (must be the production database URL)

## 3. User stories

- As an operator, I want to preview eligible orphaned series and aggregate
  outcomes so that I can review the production impact before writing.
- As an operator, I want to apply the reviewed backfill safely so that missing
  future instances are restored without duplicates or exposing PII.

## 4. Acceptance criteria (testable, non-contradictory)

- **AC-1** — GIVEN local invocation with `DATABASE_URL` set to production WHEN
  no `--apply` flag is supplied THEN the command performs read-only queries only
  (no writes, locks, or rollback simulation), calculates intended counts using
  shared recurrence logic, and reports the dry-run result.
- **AC-2** — GIVEN either mode WHEN eligibility is evaluated THEN the command
  uses a keyset cursor and bounded batches, with a predicate semantically
  equivalent to the authoritative predicate: the event is active, its end date
  is NULL or strictly greater than the fixed database-derived run UTC date, and
  no active instance for that series has a start date strictly greater than that
  date. The predicate is evaluated against the fixed date for the entire run.

- **AC-3** — GIVEN `--apply --confirm-event-writes-quiesced` WHEN an eligible
  series is about to be written during a genuinely quiescent maintenance window
  covering all event and event-type edits and all API cascade writers
  THEN a per-series `SERIALIZABLE` transaction first reads and locks the current
  event row, re-checks eligibility after acquiring the lock, fetches the current
  event-type IDs, and creates from that in-transaction snapshot; an ineligible
  series is skipped.
- **AC-4** — GIVEN an eligible series WHEN its instances are created THEN the
  command uses `createEventInstancesForSeries` semantics, starts from the fixed
  run UTC date, uses four years ahead by default, and includes inherited
  event-type join rows.
- **AC-5** — GIVEN a series with null recurrence fields WHEN it is processed
  THEN recurrence nulls use cascade defaults (weekly pattern, interval 1, and
  index 1), rather than backfill-specific defaults.
- **AC-6** — GIVEN any mode WHEN processing completes THEN output contains only
  aggregate counts (eligible, would-create/created, skipped, and failures) and
  non-PII failure summaries; it does not print names, descriptions, emails,
  addresses, raw rows, or instance IDs. Apply requires a preflighted,
  gitignored `.local/` output path and writes created instance IDs and run
  metadata there for rollback.
- **AC-7** — GIVEN a write failure for one series WHEN processing continues THEN
  the failure is counted and other series are attempted; the command exits
  non-zero if any failure occurred. Before that series commits, its created
  instance IDs are durably journaled and fsynced to the local output file;
  after a crash, harmless IDs from an uncommitted transaction may remain in the
  journal.
- **AC-8** — GIVEN a serialization conflict WHEN the bounded retry limit is
  reached THEN the command safely counts the series as a failure or skip,
  performs no partial write for that series, and continues processing.
- **AC-9** — GIVEN a run WHEN candidate processing begins THEN candidates are
  processed in bounded keyset/cursor batches without loading all candidates into
  memory.
- **AC-10** — GIVEN a run WHEN the UTC calendar date changes before an apply
  write THEN the command aborts before that write; all eligibility checks and
  recurrence calculations use one fixed UTC run date. After creation and before
  the transaction commits, the command checks the database UTC date again and
  aborts that transaction if it differs.
- **AC-11** — GIVEN implementation or execution WHEN the backfill is reviewed
  THEN no schema, public API, or persistent application behavior is changed.

## 5. Roles & authorization (RBAC)

This is a local operator command, not an authenticated application procedure.

| Action                                                      | Allowed                                                                                           | Explicitly denied                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Preview with production `DATABASE_URL`                      | An explicitly approved operator with read access                                                  | Unapproved users and application end users                                                                  |
| Apply writes with `--apply --confirm-event-writes-quiesced` | An explicitly approved operator after human review, with a genuinely quiescent maintenance window | Everyone without explicit production write authorization; apply without the confirmation flag or quiescence |

## 6. Out of scope / non-goals

- No schema migrations, API procedures, UI, or permanent scheduling.
- No repair of ended, inactive, non-series, or already-populated events.
- No deletion, mutation, or reconciliation of existing instances.
- No logging or reporting of PII or per-event identifying details.

## 7. Critical-path test cases

- Dry-run performs only read queries, takes no locks, and produces zero writes.
- Apply re-check skips a series made ineligible concurrently.
- Apply retries serialization conflicts only within the bounded limit and never
  commits a partial per-series transaction.
- Created rows and inherited event-type joins match cascade-service semantics.
- A mixed success/failure run reports aggregates and exits non-zero.
- Full script coverage verifies dry-run read-only behavior, semantic eligibility,
  keyset batching, fixed-date rollover aborts, required apply flags and
  preflighted `.local/` output paths, row locking and post-lock rechecks,
  current event-type snapshot use, atomic instance/join commits, zero-created
  skip classification, serializable/deadlock retries and exhaustion, safe
  aggregate-only logging, durable ID journaling, artifact permissions, and
  cleanup on success and failure.

## 8. Observability

- Events/metrics emitted via `@acme/logger`:
  - `backfill.orphaned_event_series.completed`
  - `backfill.orphaned_event_series.failed`
- Logs and final output contain aggregate counts, mode, UTC run date, and
  failure reason categories only; never PII, raw database records, or instance
  IDs. Created IDs are written only to the operator-provided local output file.

## 9. Operator review, rollback & validation

- **Before apply:** confirm the production `DATABASE_URL`, inspect the dry-run
  aggregates, confirm the four-year scope and expected load, preflight a
  gitignored `.local/` output path, obtain human approval, pass
  `--confirm-event-writes-quiesced`, and schedule a genuinely quiescent
  maintenance window covering all event/event-type edits and API cascade
  writers. At production scale, process in bounded keyset/cursor batches with
  rate/concurrency limits and monitor database load. Capture and review
  `EXPLAIN ANALYZE` evidence for the semantically equivalent eligibility
  predicate before any production apply.
- **Approval gate:** no production run occurs until the operator has reviewed
  `EXPLAIN ANALYZE` and confirmed every maintenance-window, output-path, and
  command precondition. No production run occurs before human approval; parent
  orchestrator approval is recorded, but the production operator must still
  verify that approval before applying.
- **Rollback:** stop the command, use the local operator output file's created
  instance IDs and run metadata (excluding any IDs known to belong to an
  uncommitted transaction), and use an operator-reviewed database
  transaction/script to remove only rows created by that run (including their
  cascading join rows). Do not delete pre-existing data or expose IDs in logs.
- **After apply:** use the output file to identify only that run's created rows,
  then rerun the exact eligibility SQL, confirm no eligible orphaned
  series remain (or explain failures/skips), validate instance and event-type
  join counts and recurrence dates, review failure aggregates, and retain the
  dry-run/apply summaries for audit.

**Validation owner:** parent orchestrator. No production run is permitted before
human approval; that approval has been granted in the parent orchestration.
