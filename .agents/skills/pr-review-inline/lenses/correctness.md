Lane: correctness. Does the changed code do the right thing for every input and caller?

Look for:

- Logic errors: inverted conditions, wrong operators, off-by-one, a missing `await`, broken
  control flow, a type that doesn't match the runtime value.
- Edge cases the change doesn't handle: empty, null, zero, duplicates, ordering, time zones,
  very large inputs.
- Atomicity: read-then-write races, related writes outside one transaction, a one-time claim
  that isn't atomic or is never released when its side effect fails.
- Cross-boundary breakage: every caller and consumer of a contract this PR changes, in every
  app and language that uses it.
- Performance that becomes an outage: a query per item in a loop, a query with no limit or
  pagination, work inside a hot loop, unbounded memory growth. On the API a slow query holds a
  pooled connection that cheap calls then queue behind.
- Requirements: behavior the requirements ask for that is missing or partial, and behavior
  nobody asked for.
- Data and schema: a migration that fails or loses data on existing rows (a NOT NULL column
  with no default or backfill, a narrowed type, a dropped column or enum value still read),
  and a schema or API change that code already deployed can't handle during the rollout.

How to work:

1. For each unit in the change inventory, state what it must do, then read the code to see
   whether it does.
2. For each changed function, type, route or schema, find its callers and its siblings (the
   neighboring procedures that follow the same pattern) and check that they still agree.
3. For each new branch, name an input that takes it and trace what happens.
