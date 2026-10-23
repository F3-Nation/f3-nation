---
applyTo: "**/*.py,**/pyproject.toml,uv.lock,.python-version"
---

# Python (slackbot, analytics, db-python)

## Conventions (do not apply TypeScript rules here)

- Tests are pytest (`test_*.py`) under each package's `tests/`. Never ask for
  Vitest, `*.test.ts` names or 2-space indentation.
- Ruff owns lint and format. Its 120-column limit is real for Python; the
  shared config comes from the root `pyproject.toml`.
- Tasks run through `scripts/python-task.sh`. Dependencies are managed with
  uv, and `uv.lock` changes with any `pyproject.toml` change.
- A Python version change updates every pin together:
  - `.python-version`, root and app.
  - `requires-python`.
  - Dockerfiles: multi-arch index digest, no `FROM --platform`.
  - The setup action and `uv.lock`.

  Never downgrade.

## Correctness

- Catch narrow exceptions. Inside per-item loops (each recipient, org or
  region), catch, log and continue so one failure doesn't stop the batch.
- Log fixed event names and normalized error categories. Never log raw
  exception text, emails, names or phone numbers; messages can carry PII and
  credentials.
- Use `is not None` when `0` or `""` is a meaningful value.
- Outer-join aggregates are coalesced to `0` before sorting or summing.

## apps/analytics

- Every query that exposes events honors `meta.exclude_from_pax_vault`.
- Org-hierarchy hops are depth-agnostic. Fixtures cover both
  Sector→Area and Sector→Territory→Area.
- A successful `blob.patch()` is the commit point. A later confirmation
  failure is logged as committed-but-unconfirmed, never as a failure.
- Contract changes (dropped or renamed columns, new dataset versions) record
  consumer compatibility and rollback in `docs/duckdb-producer-contract.md`.
- Time-budget tests leave headroom for a loaded CI runner. Wall-clock sleeps
  are flakiness bugs.
