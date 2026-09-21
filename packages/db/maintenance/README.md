# Submission ID repair candidate

This manual repair preserves every submission while giving each one a unique
ID. It is **not an automatic migration and is not approved for production**.
The candidate ends in `ROLLBACK`. Even a rollback rehearsal takes an
exclusive table lock; do not run it against production without exact approval.

## Behavior and decisions requiring sign-off

- Keep the original ID on the earliest `created_at` record in each group, then
  order by `timestamp` and physical tuple ID for ties. This choice does not
  establish which submission historically owned the ID. Approve that policy
  before use; the physical tie-breaker is stable only during the locked run.
- Allocate remaining rows above the largest existing ID. No rows are deleted;
  all other fields are compared exactly before completion.
- Save a mapping for **every** original row in the private
  `pr825_submission_repair.id_map` table: old ID, new ID, and MD5 of the original
  row representation. The fingerprint is a reference aid, not a security or
  preservation proof. Exact JSON comparisons provide the preservation check.
  Do not export mappings or hashes publicly. They are not a substitute for a
  backup, and cannot uniquely distinguish byte-identical original copies.
- Add `PRIMARY KEY (id)` and retain `GENERATED ALWAYS AS IDENTITY`. Advance the
  sequence with transactional `ALTER SEQUENCE ... RESTART`, never `setval`.
  Preserve an already advanced next value. Abort on integer exhaustion.
- Refuse existing primary keys, foreign keys, user triggers, rules, inheritance,
  partitions, row security, unexpected identity settings, and repeat execution.
  A DBA must review any newly discovered dependency rather than remove a guard.

## Production prerequisites (not performed by this preparation)

1. Confirm deployed Codex revision, database/search path, all other consumers,
   external ID references, and catalog dependencies. Source review alone does
   not establish deployed configuration. Admin notification emails contain IDs.
2. Obtain a restorable backup and approve the keeper policy, exact script,
   target, owner role, maintenance window, and final transaction disposition.
   The account used for investigation is read-only, not a repair execution role.
   Production target for review is `f3data:us-central1:f3data`, database `f3_prod`.
   This script deliberately embeds no credentials or connection settings.
3. Stop/drain submission and moderation writers, jobs, importers and direct
   sequence consumers. Require admins to close/reload their old screens before
   resuming; stale forms still carry ambiguous original IDs. A table lock alone
   cannot fix those stale client decisions or prove sequence consumers stopped.
4. Recheck current shape/counts and compare them with the reviewed operation.
   Inspect owner default privileges and mapping access: the new schema grants
   PUBLIC no access, but any owner-specific default grants need review too.
5. Use a direct, approved owner session and `psql -X -v ON_ERROR_STOP=1 -f ...`.
   The candidate starts its own transaction. Do not wrap it in another one.
   Its 10-second statement, 3-second lock and 60-second idle-transaction
   timeouts fail rather than wait indefinitely. A lock timeout is a stop signal.
6. For a separately approved apply, review the exact diff replacing the final
   `ROLLBACK;` with `COMMIT;`. Do not alter the original candidate silently.
   The only query-result data emitted is preserved/reassigned counts; psql
   also prints command tags and any errors. On error disconnect to
   release the failed transaction and its locks; do not keep working in it.
7. Confirm uniqueness, row preservation, mapping access, next-ID behavior and
   single-row moderation under the approved verification plan. Deploy PR
   migrations 0027–0029 under their own release approval, then refresh clients
   and resume writers. Test writes in production require explicit approval too.

Before commit, rollback restores IDs, sequence state, constraints and mapping
creation. After commit, do not blindly reverse IDs: that reintroduces collisions
and may misidentify later activity. Keep the mapping and backup; recovery after
commit needs its own reviewed procedure while writes remain stopped.

## Reproduce the synthetic tests

With Docker running and the repository's pinned Node/pnpm toolchain active,
run this from the repository root:

```sh
pnpm -C packages/db test:repair
```

The command creates a **fresh disposable PostgreSQL 18.6 container**, uses trust
authentication only on localhost `127.0.0.1:55435`, and removes the container on
exit. It fails if that port is occupied; it never stops an existing container.
The test hard-codes its synthetic database `f3_pr825_test` and never reads a
database URL from the environment. Never redirect it to a shared database.
This explicit maintenance test is separate from the normal Vitest suite because
it requires Docker and replays the real migration journal on a fresh database.
Its TypeScript is included in the package's normal lint/type checks.

Tested scenarios (production read session reported PostgreSQL 18.4):

- 1,949 synthetic rows with 387 two-row ID collisions, all fields preserved.
- Default rollback and injected failure after sequence restart restore state.
- Earliest records retain IDs; the mapping accounts for every row.
- Single-row status update leaves its formerly colliding partner untouched.
- Identity enforcement, duplicate rejection and refusal to reapply.
- Actual migrations 0027–0029 after repair, followed by a verified audit insert.
- Sequence behind rows, ahead/already-called, and ahead/not-yet-called.
- Triple collision and identical copies with tied timestamps.
- Integer capacity failure, unexpected trigger and concurrent writer timeout.
- Independently exhausted sequence restores rows, sequence, identity, mapping
  and primary-key state on failure.
- Unexpected identity mode, sequence name, increment, cycle and cache settings
  are refused without changing rows.
- An ordinary unrelated role cannot use the mapping schema or read its table.
- Explicit catalog checks confirm rollback removes the primary key and mapping.

Only synthetic local tests have run. No production repair, deployment, commit,
or push is implied. Claude's native PR Review Toolkit completed code, test,
error-handling and comment reviews with Sonnet. It found no demonstrated repair
logic defect; the approved test and documentation follow-ups are included here.
The updated tests and repository packaging were verified locally, not reviewed
again by Claude. Production prerequisites above still apply.
