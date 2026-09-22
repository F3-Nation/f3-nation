# ADR 0004: Retire PgBouncer in favor of bounded direct connections

- **Status:** Accepted
- **Date:** 2026-08-11 (investigation) · accepted 2026-09-22
- **Deciders:** @dnishiyama, with the removal direction agreed by @taterhead247
  on [#176](https://github.com/F3-Nation/f3-nation/issues/176) 2026-08-25
- **Related:** [#176](https://github.com/F3-Nation/f3-nation/issues/176)
  (document PgBouncer), [`docs/PGBOUNCER.md`](../PGBOUNCER.md) (what exists
  today), [#901](https://github.com/F3-Nation/f3-nation/pull/901) and
  [#911](https://github.com/F3-Nation/f3-nation/pull/911) (the pool bounds this
  ADR depends on, both merged 2026-09-11)

## Summary

**Decision: retire PgBouncer.** Connect the TypeScript apps — `api`, `map`,
`admin`, and `me` — directly to Cloud SQL through the Cloud SQL connector, with
connection limits enforced in the application instead of in a pooler. Cut over
behind monitors that can see connection pressure, one service at a time, and
roll back on any alarm.

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
   Bound the pools, stand up the monitors and baseline them against the current
   architecture, migrate one service at a time, run both paths for a week, then
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
problems. The proposal is to make the rest match them, not to invent a new
pattern. ("The rest" is four services, not three: `me` does not depend on
`@acme/db` directly, but it reaches it transitively through `@acme/api` and so
carries its own `DATABASE_URL`.)

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

1. **Bound the application pool.** ✅ **Done** — [#901](https://github.com/F3-Nation/f3-nation/pull/901)
   set `max: 5`, `idle_timeout: 20`, `connect_timeout: 10` on the `postgres.js`
   client and gave each service a deliberate `--max-instances` instead of
   inheriting 100. [#911](https://github.com/F3-Nation/f3-nation/pull/911) added
   the client-side queue timeout, which is pooler-agnostic and carries over
   unchanged. Retune `--max-instances` to 15 at cutover: 4 services × 15 ×
   `max` 5 = 300, leaving ~100 under the 400 ceiling for the direct connectors
   from §3.
2. **Put the monitors in place, and let them run against the _current_
   architecture first.** Removing the pooler removes the last automatic ceiling
   on connections; something has to hold that job afterward, and it has to be
   proven before the change, not after. Three monitors, all in Sentry (org
   `f3-nation`, project `maps-nextjs`):
   - **Uptime monitor on a database-backed health endpoint.** `/v1/ping` returns
     `{alive: true}` without touching Postgres, so it would stay green through a
     total database outage. Add a `db` check (`select 1`, 1s timeout) to
     `@f3nation/health` — the package already has the contract and timeout
     machinery — expose `/health` on `api`, `map`, `admin`, and `me`, and return
     503 when that check is `down`. One monitor per service per environment,
     1-minute interval, alarm after 3 consecutive failures.
   - **Cron monitor on the connection budget.** A Cloud Run Job on Cloud
     Scheduler, every 5 minutes, samples `pg_stat_activity` and checks in with
     Sentry — `error` when total backends reach 240 (60% of 400, a threshold
     that would have stayed silent across the entire measured window). Group the
     sample by `client_addr` and attach it as check-in context; that also
     settles §8. Keep a Cloud Monitoring alert on `num_backends` alongside it: a
     cron monitor is only as alive as its job, and the platform alert is the
     independent backstop.
   - **Issue alert on connection-failure signatures** — `CONNECT_TIMEOUT`,
     `ECONNREFUSED`, `sorry, too many clients already`, `terminating
connection`, and #911's query timeout — above 5 events in 5 minutes. Note
     that `apps/admin` and `apps/me` have no Sentry SDK today, so this monitor
     is blind to two of the four services until one is added.

   Hold here until every monitor has been green for 48 hours against today's
   PgBouncer topology. That baseline is the point: a monitor that has never been
   observed reporting _normal_ cannot be trusted to report _abnormal_.

3. **Migrate `api`, `map`, `admin`, and `me` to the Cloud SQL connector**,
   matching how `auth` already connects. Staging first, all four, soaked for a
   week — then deliberately induce connection pressure and confirm each monitor
   alarms and a rollback recovers. Production follows one service per day, `api`
   first, each cutover watched actively for an hour and soaked 24 hours before
   the next.

   **Any monitor alarming rolls that service back**, stops the sequence, and the
   cause gets diagnosed before it resumes. Latency p95 more than 50% above the
   24-hour pre-cutover baseline counts as an alarm.

   Re-enabling SSL in `getDbUrl()` and dropping `prepare: false` are _not_ part
   of the cutover — they land in step 5, so that a rollback during step 3 is
   only ever a connection-string change. The prepared-statement switch is a real
   behavior change, not a flag flip, and deserves its own PR and its own test.

4. **Run both paths for a week.** PgBouncer stays up and reachable throughout.
5. **Delete**, in this order: the VM (stopped for 30 days first), the
   `pgbouncer` firewall rule, and the `34.172.230.30` entry in Cloud SQL's
   authorized networks. Then the cleanup PR: `prepare: true`, SSL back on,
   Cloud SQL `sslMode` tightened, and the 400-connection budget arithmetic
   written somewhere visible in the repository.

### Rollback

Through step 4, cutover is a `DATABASE_URL` swap per service — from the Cloud
SQL connector back to `pgbouncer.prod.db.f3nation.com:6432` — with the VM still
running and still in the authorized-network list. Rollback is a redeploy, not a
rebuild.

Note that two services currently pin the pooler's raw IP (`34.172.230.30`)
rather than its DNS name. Normalizing those first makes both the cutover and the
rollback a single consistent change.

Faster, where it works: `DATABASE_URL` is configured on the Cloud Run service
out of band — `_deploy-cloudrun.yml` passes only `image` and `flags` to
`deploy-cloudrun` and never sets `env_vars` or `secrets` — so the connection
string is baked into the revision, and rollback is a traffic shift measured in
seconds rather than a redeploy measured in minutes:

```bash
gcloud run services update-traffic <service> \
  --to-revisions <pre-cutover-revision>=100 \
  --region us-central1 --project <project>
```

**Confirm this before the first production cutover.** If `DATABASE_URL` turns
out to be a Secret Manager reference pinned to `:latest` rather than a literal
environment variable, the container re-reads the secret at start and a revision
rollback restores nothing — rollback then falls back to editing the secret and
redeploying. Which of the two is true determines what "roll back on alarm"
actually costs, so it is worth the five minutes to check.

Two things must stay untouched for any of this to work: the PgBouncer VM keeps
running and keeps its entry in Cloud SQL's authorized networks, and the `6432`
firewall rule stays open until decommission. Closing that rule early — it is a
legitimate finding in its own right — would remove the rollback path.

## 8. Open question

**The 88-connection peak is unattributed, and it should be attributed before
step 3.** Step 2 now answers it as a side effect: the connection-budget job
samples `pg_stat_activity` grouped by `client_addr` every five minutes, so the
48-hour baseline produces the attribution before any traffic moves.

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
