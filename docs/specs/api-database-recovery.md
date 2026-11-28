# API database connection recovery

> Human designer: Chubbs (@michaeldpotter)

## 1. Summary

An API instance whose database connections stop answering must recover its connection pool or be replaced by the platform. Recovery bounds user-visible failure without replaying a request whose write outcome may be unknown.

## 2. Context & links

- Apps affected: API; shared database client consumers retain their existing timeout and transaction behavior.
- Key code: [database client construction](../../packages/db/src/utils/functions.ts), [query timeout](../../packages/db/src/utils/query-timeout.ts), [API health](../../apps/api/src/app.ts), [API deployment](../../.github/workflows/deploy-api.yml).
- The [health contract](health-contract-and-status.md) requires `/health` to return HTTP 200 even when a dependency is down. Platform liveness therefore uses a separate route.

## 3. User stories

- As a member, I want an instance with silent database connections to recover so intermittent failures do not persist until someone redeploys.
- As an operator, I want bounded health checks and identifiable recovery events so unhealthy instances can be replaced and investigated.

## 4. Acceptance criteria (testable, non-contradictory)

- **AC-1** — GIVEN the API's shared database pool WHEN three top-level queries reach the existing pool-wait/execution deadline without a successful bounded query between them THEN future operations use one new pool and the retired pool drains for at most five seconds before being force-closed. Concurrent timeout callbacks from the retired pool cannot trigger another replacement.
- **AC-2** — GIVEN a successful bounded query WHEN a later timeout occurs THEN earlier timeout counts do not contribute to a replacement. A late result after its caller timed out cannot count as a success.
- **AC-3** — GIVEN an operation on a retiring pool WHEN recovery occurs THEN it may fail but is never automatically replayed. Existing transaction and audit-context timeout exclusions remain intact. A transaction interrupted by retirement has an unknown outcome until the caller verifies persisted state; recovery does not claim it rolled back.
- **AC-4** — GIVEN database-client shutdown WHEN close completes THEN the current and retired pools have been closed and no timeout callback can create a new pool.
- **AC-5** — GIVEN local Postgres behind a relay that silences existing connections while accepting healthy new connections WHEN the recovery threshold is reached THEN a subsequent SELECT succeeds through a new connection without restarting the application.
- **AC-6** — GIVEN `/health` WHEN requested THEN it retains HTTP 200, no-store, and the shared health schema, and includes a critical database check bounded to three seconds. A failed check exposes no SQL, credentials, hostnames, or driver error text.
- **AC-7** — GIVEN simultaneous health checks WHEN the database is silent THEN they share at most one outstanding probe query, even after the health response deadline expires. Probe ownership lasts until the native operation settles, including forced pool closure; the ordinary query deadline cannot release it. Health probes neither count as deadlines nor reset recovery state. Ownership can remain pending indefinitely while other connections succeed. Health calls keep reporting a critical timeout for that pending query until driver settlement, retirement, or shutdown releases it. Caller continuations share a deadline-bounded response; later polls reuse its settled timeout result while the physical probe remains pending. The API logs one sanitized stalled-probe event when the health response deadline passes. Liveness performs no database query.
- **AC-8** — GIVEN `/live` THEN it returns 200 until replacement pools record deadline timeouts spanning at least 60 seconds without a timely success. Failure evidence survives further replacements; a timely success clears it. A new timeout callback establishes failure, never elapsed idle time alone. A failed watchdog returns 503 without querying the database. This per-instance signal is not a database-wide availability claim.
- **AC-9** — GIVEN the API deployment definition THEN its existing TCP startup behavior is preserved and an HTTP `/live` liveness probe runs every 15 seconds with a five-second request timeout and six consecutive failures required for replacement. Brief failures do not immediately restart the instance.
- **AC-10** — GIVEN a pool replacement THEN a structured `db.pool.recycled` event identifies the timeout count and pool generation without SQL, bound values, connection strings, or raw errors. Query-deadline events support per-instance operational investigation.
- **AC-11** — GIVEN the alert handoff THEN it provides a reviewable production log-based alert definition for sustained timeout events, with a five-minute evaluation window and an instance identifier where Cloud Logging exposes one. Applying it and selecting notification destinations require operator authorization.

## 5. Roles & authorization (RBAC)

| Action                                           | Allowed                                  | Explicitly denied                               |
| ------------------------------------------------ | ---------------------------------------- | ----------------------------------------------- |
| Read health or liveness                          | Public callers and platform probes       | Mutation of application records through probes  |
| Replace a pool                                   | API runtime after its recovery threshold | Caller-supplied recovery commands or thresholds |
| Apply liveness deployment or alert configuration | Authorized release operators             | Runtime API callers                             |

## 6. Out of scope / non-goals

- Identifying what silences established Cloud SQL connector connections; recovery handles the symptom whatever the cause.
- Retrying failed queries or transactions, changing authorization, or changing database schema.
- Altering the existing query deadline or adding deadlines to transactions.
- Automatically enabling recovery for non-API applications or operator CLIs.
- Deploying services, creating cloud alerts, or changing production settings during local development.

## 7. Critical-path test cases

- Silent established connections time out; threshold replacement permits a subsequent query on a healthy new connection.
- Success resets the threshold; late and retired-generation completions do not affect a replacement generation.
- Concurrent timeout callbacks replace the pool once; shutdown prevents replacement; writes are not replayed.
- Database health succeeds, fails, and times out with bounded concurrent probe work and sanitized responses. Liveness remains healthy before recovery and during idle periods, fails after sustained replacement-pool timeouts, and clears after timely progress.
- Deployment configuration preserves startup behavior and contains the expected API-only liveness settings.

## 8. Observability

- `db.query.deadline_exceeded`: bounded top-level query reached its deadline; no SQL or parameter values.
- `db.pool.recycled`: pool generation replaced after repeated timeouts.
- `db.pool.recovery_failed`: one event when the progress watchdog transitions to unhealthy, identifying the pool generation without driver details; timely progress permits a later failure transition to emit a new event.
- `db.pool.retirement_failed`: forced retirement failed; no raw driver error is logged.
- `api.health.database_probe_stalled`: one pending physical health query outlived its response deadline; no query or driver details.
- API health reports database status through the shared contract; `/live` provides the platform's HTTP failure signal.
- Each pool keeps its existing five-connection ceiling. At the default query deadline, one retiring pool can overlap its successor during the five-second drain, briefly allowing ten connections per instance (200 across 20 API instances). Against the [connection budget](../adr/0004-retire-pgbouncer.md), fleet-wide overlap raises the nominal whole-instance total from about 260 to about 360, exceeding the documented 280 alert threshold and reducing headroom below 400. Revision overlap and other consumers can add further demand. Production rollout requires a separately approved capacity plan that preserves the ADR’s headroom below the connection-budget alert; it must not silently raise the budget alert. Watch Cloud SQL connection usage alongside per-instance recycle and deadline events. A traffic-shift rollback to a known-good revision restores that revision's client and probe configuration; redeploy rollback constraints are in the [release process](../RELEASE_PROCESS.md).
