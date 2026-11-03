# apps/analytics

Python ETL that publishes the Pax Vault datasets. Python conventions:
[`apps/slackbot/AGENTS.md` § Python conventions](../slackbot/AGENTS.md#python-conventions-all-python-packages).

- Catch narrow exceptions; broad `except Exception` only at CLI or process
  boundaries.
- Log fixed event names and normalized error categories, never raw exception
  text, which can carry PII and credentials.
- Every `pv_*` query that exposes events honors `meta.exclude_from_pax_vault`.
- Org-hierarchy hops are depth-agnostic; fixtures cover both Sector → Area and
  Sector → Territory → Area.
- Outer-join aggregates in SQL are coalesced to `0` before sorting or summing.
- A successful pointer write (`upload_from_string` with a generation match)
  is the commit point. A later readback or confirmation failure is reported as
  committed-but-unconfirmed, never as a failed publish.
- Contract changes (dropped or renamed columns, new dataset versions) record
  consumer compatibility and rollback in
  [`docs/duckdb-producer-contract.md`](../../docs/duckdb-producer-contract.md).
- Time-budget tests leave headroom for a loaded CI runner.
