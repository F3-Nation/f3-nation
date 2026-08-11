# ADR 0003: Retire PgBouncer in favor of bounded direct connections

- **Status:** Proposed
- **Date:** 2026-08-11
- **Deciders:** TBD
- **Related:** [#176](https://github.com/F3-Nation/f3-nation/issues/176)
  (document PgBouncer), [`docs/PGBOUNCER.md`](../PGBOUNCER.md) (what exists
  today)

## Summary

**Recommendation: retire PgBouncer.** Connect `api`, `map`, and `admin`
directly to Cloud SQL through the Cloud SQL connector, with connection limits
enforced in the application instead of in a pooler.

The reasoning, each expanded below:

1. **[The load does not justify a pooler.](#1-the-load-does-not-justify-a-pooler)**
   Production peaked at 88 database connections over 30 days against a ceiling
   of 400. The median hour uses one.
2. **[The original justification no longer applies.](#2-the-original-justification-no-longer-applies)**
   PgBouncer was introduced to absorb serverless connection churn. Every app is
   a long-lived Cloud Run container now, holding one memoized client per
   process.
3. **[The direct path is already running in production.](#3-the-direct-path-is-already-running-in-production)**
   `app_auth` and the Slack bot connect straight to Cloud SQL today. This is not
   a migration into the unknown.
4. **[The only thing PgBouncer still provides is a connection ceiling.](#4-what-pgbouncer-actually-provides-today)**
   That ceiling exists because the application sets no pool limit of its own. It
   belongs in the driver, not on a VM.
5. **[Keeping it costs more than removing it.](#5-what-keeping-it-would-cost)**
   The pooler is the least-managed component in the stack: an unmanaged zonal
   single point of failure with no logs, no admin access, no IaC, and a port
   open to the internet.
6. **[Retiring it closes six open problems at once.](#6-what-retiring-it-buys)**
   It also lets us re-enable TLS and prepared statements.
7. **[The migration has a strict order and an instant rollback.](#7-migration-sequence)**
   Bound the pools, add the alert, migrate, run both paths for a week, then
   delete.
8. **[One open question should be settled first.](#8-open-question)** The
   88-connection peak exceeds PgBouncer's own cap, so some of it is already
   direct traffic — but the split is unproven.

---

## 1. The load does not justify a pooler

Measured 2026-08-11 from Cloud Monitoring —
`cloudsql.googleapis.com/database/postgresql/num_backends`, hourly `ALIGN_MAX`,
30-day window:

| Instance                   | Peak                          | p95 | Median | `max_connections` |
| -------------------------- | ----------------------------- | --- | ------ | ----------------- |
| `f3data` (production)      | **88** (2026-07-17 03:45 UTC) | 24  | 1      | **400**           |
| `f3data-nonprod` (staging) | 20                            | 3   | 1      | —                 |

All 88 of the production peak were on the `f3_prod` database. The worst hour in
a month left 78% of the connection ceiling unused; the typical hour uses a
single connection.

Transaction pooling solves a specific problem: many short-lived clients
contending for a small number of expensive backends. At this volume there is no
contention to relieve. A pooler here is not tuning — it is a second network hop
and a second thing to operate.

To re-measure:

```bash
# max_connections + who is actually connected, without printing the secret
doppler run --project f3-map --config prd --command \
  'psql "$DATABASE_URL" -tAc "show max_connections" \
     -c "select usename, application_name, client_addr, state, count(*) \
         from pg_stat_activity group by 1,2,3,4 order by 5 desc"'
```

Historical counts come from the Monitoring API; `max_connections = 400` is the
tier default for `db-custom-2-8192` — it is not set as a database flag.

## 2. The original justification no longer applies

PgBouncer was stood up in April 2025, when the map app ran on a serverless
platform. There, each invocation could open its own connection and the database
saw connection-per-request churn — exactly what a pooler absorbs.

That architecture is gone. `api`, `map`, `admin`, and `auth` all run as
Cloud Run containers, and the database client is memoized per process:

```ts
// packages/db/src/client.ts
let _db: AppDb | undefined;
// ...
_db ??= resolveDb();
```

One `postgres.js` client per instance, held for the life of the container, with
its own internal pool. That is the thing PgBouncer was compensating for, and the
application now does it natively.

## 3. The direct path is already running in production

Grouping `pg_stat_activity` on `f3_prod` by `client_addr` shows the pooler
fronts only part of the fleet:

| Client                | Reaches Postgres via                                            |
| --------------------- | --------------------------------------------------------------- |
| `api`, `map`, `admin` | `client_addr = 34.172.230.30` → **through PgBouncer**           |
| `app_auth`            | no `client_addr` → **direct**, via the Cloud SQL connector      |
| `f3slackbot`          | no `client_addr` → **direct**                                   |
| `datastream_user`     | `34.67.234.134` → direct (BigQuery CDC, own authorized network) |
| `cloudsqladmin`       | `127.0.0.1` — Cloud SQL's own agent                             |

Two application workloads already connect directly and have not caused
problems. The proposal is to make the remaining three match them, not to invent
a new pattern.

This also corrects a common mental model: "everything goes through the pooler"
has not been true for some time.

## 4. What PgBouncer actually provides today

One thing: a hard ceiling on connections to Postgres.

```ini
max_db_connections = 40     # server connections to f3_prod, across all pools
max_client_conn = 1000      # client connections into PgBouncer
pool_mode = transaction
```

That ceiling matters because the application has none of its own:

```ts
// packages/db/src/utils/functions.ts:28
const client = postgres(databaseUrl, sslOptions); // no `max` → driver default of 10
```

Ten connections per instance, and `f3-admin` permits `maxScale: 100` — a
theoretical 1000 connections from a single service against a 400-connection
database. `max_db_connections = 40` is the only reason that is safe.

So the pooler is compensating for a missing configuration value. The fix is to
set the value. `docs/AI_DEVELOPMENT_GUIDE.md` already instructs contributors to
size pools this way; the repository does not currently follow its own guidance.

## 5. What keeping it would cost

`docs/PGBOUNCER.md` §8 has the full list. The material items:

| Problem                                                                      | Why it matters                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| Single hand-built `e2-micro`, one zone, no IaC, no health check, no autoheal | Losing it takes all pooled production traffic offline   |
| Port 6432 open to `0.0.0.0/0`, no target tags                                | Credentials are the only barrier from the open internet |
| No TLS on either hop                                                         | Credentials and rows cross the internet in plaintext    |
| No logging since April 2025 — no logfile, no syslog, no journal              | No record of auth failures, disconnects, or pool waits  |
| Admin console unreachable (`unix_socket_dir` does not survive boot)          | `SHOW POOLS` is unavailable during an incident          |
| PgBouncer 1.16.1 (2021), `auth_type = md5`                                   | Years of upstream fixes missing; MD5 is deprecated      |
| `unattended-upgrades` enabled on an unmanaged box                            | It can restart itself with nobody watching and no logs  |

Making that infrastructure trustworthy — IaC, a managed instance group or
managed pooler, TLS, logging, admin access, a version upgrade — is several days
of work. Spent on a component that, per §1, is relieving no measurable pressure.

## 6. What retiring it buys

- Removes the single point of failure entirely, rather than making it redundant.
- Removes the public 6432 listener and the `0.0.0.0/0` firewall rule.
- Removes both plaintext hops: the Cloud SQL connector encrypts and
  IAM-authenticates on its own.
- Lets `getDbUrl()` stop forcing `useSsl = false` — the comment there reads
  `// Remove SSL to enable PGBouncer to work`.
- Lets the driver use prepared statements again. Transaction pooling is what
  forces `prepare: false`; without it, that constraint and the related
  session-state restrictions (`SET`, `LISTEN`/`NOTIFY`, advisory locks, session
  temp tables) go away.
- Aligns production with staging, local, and preview environments, which already
  connect directly — so pooling-specific breakage can no longer hide until
  production.

## 7. Migration sequence

The order is load-bearing. Each step must land before the next begins.

1. **Bound the application pool.** Set an explicit `max` on the `postgres.js`
   client (3–5 is ample at `containerConcurrency: 80`, where a Node process
   still runs one query at a time per request), and set a deliberate `maxScale`
   per service instead of inheriting 100. Verify the arithmetic against 400,
   including the direct connectors from §3. Example that fits: 3 services ×
   `maxScale` 20 × `max` 5 = 300, leaving 100 of headroom.
2. **Add the connection alert.** Alert on `num_backends` against 400 for
   `f3data`. A threshold near 60% (240) would have stayed silent across the
   entire measured window while still catching a leak. This must exist _before_
   the pooler is removed — otherwise one change removes both the guardrail and
   the alarm.
3. **Migrate `api`, `map`, and `admin` to the Cloud SQL connector**, matching
   how `auth` already connects. Re-enable SSL in `getDbUrl()` and drop
   `prepare: false`. Test the prepared-statement change deliberately: it is a
   real behavior change, not a flag flip.
4. **Run both paths for a week.** PgBouncer stays up and reachable throughout.
5. **Delete**, in this order: the VM, the `pgbouncer` firewall rule, and the
   `34.172.230.30` entry in Cloud SQL's authorized networks.

### Rollback

Through step 4, cutover is a `DATABASE_URL` swap per service — from the Cloud
SQL connector back to `pgbouncer.prod.db.f3nation.com:6432` — with the VM still
running and still in the authorized-network list. Rollback is a redeploy, not a
rebuild.

Note that two services currently pin the pooler's raw IP (`34.172.230.30`)
rather than its DNS name. Normalizing those first makes both the cutover and the
rollback a single consistent change.

## 8. Open question

**The 88-connection peak is unattributed, and it should be attributed before
step 3.**

88 backends on `f3_prod` exceeds PgBouncer's own `max_db_connections = 40`, so
the pooler cannot be the source of all of it. Two explanations, not mutually
exclusive:

- The direct connectors from §3 (`app_auth`, `f3slackbot`, `datastream_user`)
  account for the excess — in which case the pooler is already fronting a
  minority of production load, strengthening this ADR.
- The `[databases] * =` wildcard means `max_db_connections` is enforced per
  requested database name, so distinct names receive distinct 40-connection
  budgets.

The peak occurred at 03:45 UTC — 11:45pm Eastern — which suggests a batch job or
a Datastream backfill rather than user traffic. That would weaken the pooling
case further.

What would change the recommendation: evidence that `api` and `map` were
queueing large numbers of client connections behind those 40 during real
weekday traffic. That is what `SHOW POOLS` (`cl_waiting`) would answer, but the
admin console is currently unreachable. The practical substitute is sampling
`pg_stat_activity` grouped by `client_addr` during a known-busy window. A few
minutes of work, and it is the last genuinely open question.

## Alternatives considered

**Keep PgBouncer and harden it.** Put the VM in Terraform, move to a managed
instance group with health checks, add TLS on both hops, restore logging, fix
the admin console, upgrade off 1.16.1. Rejected: several days of work to make a
component trustworthy that §1 shows is relieving no pressure, and it leaves an
extra network hop and an extra failure domain in front of every query.

**Replace it with a managed pooler.** Cloud SQL offers managed connection
pooling, which would remove the SPOF without removing the pooling layer.
Rejected for now on the same grounds — it solves the operational problem but
still buys pooling we have no measured need for. Worth revisiting if load ever
approaches the ceiling.

**Do nothing.** Rejected: the status quo is not stable. The VM is an
unmonitored, unlogged, internet-reachable single point of failure that can
restart itself unattended. "Working today" is not the same as "safe to leave."

## Consequences

**Accepted risks:**

- The connection ceiling moves from infrastructure into application config. A
  bad deploy — an unbounded pool, a raised `maxScale` — could exhaust Postgres
  directly. Mitigated by step 2's alert, which is why it precedes removal.
- Prepared statements return. This is a performance improvement but a behavior
  change, and it needs testing rather than assumption.
- Adding a future workload means checking it against the 400-connection budget
  by hand. Previously PgBouncer absorbed that mistake. The budget arithmetic
  should live somewhere visible in the repository, not in this ADR alone.

**Improvements:**

- One fewer VM, one fewer public listener, one fewer failure domain.
- Encrypted, IAM-authenticated database access on every path.
- Production connection behavior matches every other environment.
- Six open infrastructure problems close without being individually fixed.
