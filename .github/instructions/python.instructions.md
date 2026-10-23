---
applyTo: "**/*.py,**/pyproject.toml,uv.lock,**/.python-version"
---

# Python (slackbot, analytics, db-python)

## Conventions (do not apply TypeScript rules here)

- Tests are pytest (`test_*.py`) under each package's `tests/`. Never ask for
  Vitest, `*.test.ts` names or 2-space indentation.
- Ruff owns lint and format; each package configures it in its own
  `pyproject.toml` (the root has none). The 120-column limit is real for
  Python.
- Tasks run through `scripts/python-task.sh`: it skips when `uv` is missing
  locally, fails in CI, and strips the ESLint cache flags Turbo appends.
- Dependencies are managed with uv. A dependency, `requires-python` or
  version change in a `pyproject.toml` also changes `uv.lock`.
- A Python bump updates every pin together, and never downgrades:
  `.python-version` (root and `apps/slackbot`), `requires-python` in every
  `pyproject.toml`, mypy `python_version`, the Dockerfile base images and
  `uv.lock`.

## Correctness

- In best-effort batches where items are independent (each recipient, org
  or region), catch, log and continue so one failure doesn't stop the batch.
  Inside one shared DB transaction, let errors propagate (or isolate each
  item with a savepoint); a caught DB error leaves the transaction aborted.
- Never log emails, names, phone numbers or credentials.
- Use `is not None` when `0` or `""` is a meaningful value.

## apps/analytics

- Catch narrow exceptions; broad `except Exception` only at CLI or process
  boundaries.
- Log fixed event names and normalized error categories, never raw exception
  text, which can carry PII and credentials.
- Every `pv_*` query that exposes events honors `meta.exclude_from_pax_vault`.
- Org-hierarchy hops are depth-agnostic. Fixtures cover both Sector→Area and
  Sector→Territory→Area.
- Outer-join aggregates in SQL are coalesced to `0` before sorting or summing.
- A successful pointer write (`upload_from_string` with a generation match)
  is the commit point. A later readback or confirmation failure is reported
  as committed-but-unconfirmed, never as a failed publish.
- Contract changes (dropped or renamed columns, new dataset versions) record
  consumer compatibility and rollback in `docs/duckdb-producer-contract.md`.
- Time-budget tests leave headroom for a loaded CI runner.
