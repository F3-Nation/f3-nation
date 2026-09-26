# ADR 0004: Retire PgBouncer in favor of bounded direct connections

- **Status:** Accepted
- **Date:** 2026-08-11 (investigation) · accepted 2026-09-22
- **Deciders:** @dnishiyama, with the removal direction agreed by @taterhead247
  on [#176](https://github.com/F3-Nation/f3-nation/issues/176) 2026-08-25
- **Related:** [#176](https://github.com/F3-Nation/f3-nation/issues/176)
  (document PgBouncer), [How it used to be](#how-it-used-to-be) (the PgBouncer
  setup as found, recorded at the end of this ADR), [#901](https://github.com/F3-Nation/f3-nation/pull/901) and
  [#911](https://github.com/F3-Nation/f3-nation/pull/911) (the pool bounds this
  ADR depends on, both merged 2026-09-11)
- **Depends on:** [#767](https://github.com/F3-Nation/f3-nation/pull/767)
  (OpenTelemetry + PostHog error transport) — **merged 2026-09-22**, which is
  what the monitoring in §7 step 2 is built on

## Summary

**Decision: retire PgBouncer.** Connect the two services that actually use it —
`api` and `map` — directly to Cloud SQL through the Cloud SQL connector, with
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
4. **[The only thing PgBouncer provided was a connection ceiling.](#4-what-pgbouncer-provided-before-901)**
   That ceiling existed because the application set no pool limit of its own. It
   belongs in the driver, not on a VM — which is where #901 has since put it.
5. **[Keeping it costs more than removing it.](#5-what-keeping-it-would-cost)**
   The pooler is the least-managed component in the stack: an unmanaged zonal
   single point of failure with no logs, no admin access, no IaC, and a port
   open to the internet.
6. **[Retiring it closes six open problems at once.](#6-what-retiring-it-buys)**
   It also lets us re-enable TLS and prepared statements.
7. **[The migration has a strict order and a one-command rollback.](#7-migration-sequence)**
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

| Client            | Reaches Postgres via                                            |
| ----------------- | --------------------------------------------------------------- |
| `api`, `map`      | `client_addr = 34.172.230.30` → **through PgBouncer**           |
| `app_auth`        | no `client_addr` → **direct**, via the Cloud SQL connector      |
| `f3slackbot`      | no `client_addr` → **direct**                                   |
| `datastream_user` | `34.67.234.134` → direct (BigQuery CDC, own authorized network) |
| `cloudsqladmin`   | `127.0.0.1` — Cloud SQL's own agent                             |

Two application workloads already connect directly and have not caused
problems. The proposal is to make the remaining two match them, not to invent a
new pattern.

**Only `api` and `map` are in scope.** The August sample of this table also
showed an `admin` backend; re-checked 2026-09-22, it is gone. `apps/admin` and
`apps/me` import `@acme/api` as `import type { router }` — they are oRPC HTTP
clients that call the API over `F3_API_BASE_URL` and never open a database
connection. Three confirmations: the running `f3-admin` production service has
no `DATABASE_URL` in its environment at all; Doppler has no `f3-me` project and
returns nothing for `f3-me`/`f3-auth`; and a live `pg_stat_activity` sample
shows no `admin` backends. `apps/map` does connect —
`apps/map/src/orpc/client.server.ts` imports `router` as a _value_, so the
router runs in-process there.

Leftover from when `admin` did connect: Doppler `f3-admin` / `prd` still holds a
live production database credential that nothing consumes. Delete it.

This also corrects a common mental model: "everything goes through the pooler"
has not been true for some time.

## 4. What PgBouncer provided before #901

One thing: a hard ceiling on connections to Postgres. This section describes the
state at investigation time (2026-08-11); #901 has since moved that ceiling into
the driver, which is what makes step 1 of §7 already complete.

```ini
max_db_connections = 40     # server connections to f3_prod, across all pools
max_client_conn = 1000      # client connections into PgBouncer
pool_mode = transaction
```

That ceiling mattered because the application had none of its own:

```ts
// packages/db/src/utils/functions.ts:28
const client = postgres(databaseUrl, sslOptions); // no `max` → driver default of 10
```

Ten connections per instance, and `f3-admin` permitted `maxScale: 100` — a
theoretical 1000 connections from a single service against a 400-connection
database. `max_db_connections = 40` was the only reason that was safe.

So the pooler was compensating for a missing configuration value. The fix was to
set the value, which #901 did. `docs/AI_DEVELOPMENT_GUIDE.md` already instructs contributors to
size pools this way; the repository does not currently follow its own guidance.

## 5. What keeping it would cost

[How it used to be](#how-it-used-to-be) records the setup these come from. The
material items:

| Problem                                                                      | Why it matters                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Single hand-built `e2-micro`, one zone, no IaC, no health check, no autoheal | Losing it takes all pooled production traffic offline        |
| Port 6432 open to `0.0.0.0/0`, no target tags                                | Credentials are the only barrier from the open internet      |
| No TLS on either hop                                                         | Credentials and rows cross the internet in plaintext         |
| No logging since April 2025 — no logfile, no syslog, no journal              | No record of auth failures, disconnects, or pool waits       |
| Admin console unreachable (`unix_socket_dir` does not survive boot)          | `SHOW POOLS` is unavailable during an incident               |
| PgBouncer 1.16.1 (2021), `auth_type = md5`                                   | Years of upstream fixes missing; MD5 is deprecated           |
| `unattended-upgrades` enabled on an unmanaged box                            | A package upgrade can restart the pooler unwatched, unlogged |

Making that infrastructure trustworthy — IaC, a managed instance group or
managed pooler, TLS, logging, admin access, a version upgrade — is several days
of work. Spent on a component that, per §1, is relieving no measurable pressure.

## 6. What retiring it buys

- Removes the single point of failure entirely, rather than making it redundant.
- Removes the public 6432 listener and the `0.0.0.0/0` firewall rule.
- Removes both plaintext hops: the Cloud SQL connector establishes an encrypted
  tunnel that is authorized by IAM (`roles/cloudsql.client`).
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
   unchanged. Retune `--max-instances` to 15 at cutover: 2 services × 15 ×
   `max` 5 = 150, comfortably under the 400 ceiling alongside the direct
   connectors from §3.
2. **Put the monitors in place, and let them run against the _current_
   architecture first.** Removing the pooler removes the last automatic ceiling
   on connections; something has to hold that job afterward, and it has to be
   proven before the change, not after.

   #767 merged on 2026-09-22 and removed `@sentry/nextjs` from both `api` and
   `map`. Application errors now travel the OpenTelemetry logs pipeline and land
   in **PostHog error tracking** as `$exception` events
   (`packages/observability/src/posthog-exporter.ts`), stamped with
   `environment` and `service.name`. The original decision said "Sentry
   monitors"; Sentry no longer exists in these services, so the same two
   monitors are built on what replaced it. Two monitors:

   - **Connection-budget alert — Cloud Monitoring.** Alert policy on
     `cloudsql.googleapis.com/database/postgresql/num_backends` for
     `f3data`, firing at **240 backends** (60% of `max_connections = 400`, a
     threshold that would have stayed silent across the entire measured 30-day
     window while still catching a leak). This is the direct replacement for
     `max_db_connections = 40` and needs no code: Cloud SQL exports the metric
     natively.

     An earlier draft built this as a Cloud Run Job checking in to a Sentry cron
     monitor. With Sentry gone, the job's only remaining value is attribution —
     `num_backends` is a single number and cannot say _which_ client is holding
     the connections. Run the `pg_stat_activity` breakdown by `client_addr`
     manually during the baseline window instead (it is the query in §1); that
     answers §8 without standing up a scheduled job to maintain.

   - **Connection-failure alert — PostHog.** Alert on `$exception` events whose
     message matches the connection-failure class — `CONNECT_TIMEOUT`,
     `ECONNREFUSED`, `ENOTFOUND`, `sorry, too many clients already`,
     `terminating connection`, and #911's pool-wait/execution timeout, emitted
     as `Query exceeded <n>ms pool-wait/execution timeout`
     (`packages/db/src/utils/query-timeout.ts`) — filtered to
     `environment = production`, firing above 5 events in 5 minutes. Config
     only; both in-scope services already report through the exporter.

   Hold here until both monitors have been green for 24 hours against today's
   PgBouncer topology — long enough to cover the 03:45 UTC batch window where
   §8's unexplained peak landed. That baseline is the point: a monitor that has
   never been observed reporting _normal_ cannot be trusted to report
   _abnormal_.

   A third tier was considered and dropped: an uptime monitor on a
   database-backed `/health` endpoint. It would detect a silent failure roughly
   two minutes sooner, at the cost of a `db` check in `@f3nation/health`, a new
   endpoint per app, and a monitor per service per environment. At this traffic
   `api` is never idle, so the failure alert fires on real errors within about a
   minute. Worth revisiting if a cutover ever has to happen during a quiet
   window. (This supersedes the first draft of this plan, which made a `db`
   check in `@f3nation/health` the first piece of monitoring work.)

3. **Migrate `api` and `map` to the Cloud SQL connector**, matching how `auth`
   already connects. Staging first — which also proves the socket syntax and
   lets `f3data-nonprod`'s `0.0.0.0/0` authorized network close later — then
   deliberately induce connection pressure and confirm both monitors alarm and a
   rollback recovers. Production follows one service per day, `api` first, each
   cutover watched actively for an hour and soaked 24 hours before the next.

   **Any monitor alarming rolls that service back**, stops the sequence, and the
   cause gets diagnosed before it resumes. Latency p95 more than 50% above the
   24-hour pre-cutover baseline counts as an alarm. That one is checked by hand,
   not alerted: during the watch hour, the person running the cutover compares
   the service's Cloud Run `run.googleapis.com/request_latencies` p95 against
   the same metric's p95 over the 24 hours before cutover. It only matters while
   someone is watching, so it does not earn a standing alert policy.

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
SQL connector back to the pooler — with the VM still running and still in the
authorized-network list. Rollback is a config push, not a rebuild.

Config reaches Cloud Run separately from code: `_deploy-cloudrun.yml` deliberately
never sets `env_vars` or `secrets` (see the comment at line 197). `DATABASE_URL` is
a Secret Manager reference — confirmed on both services — so the swap is a Secret
Manager operation plus a revision roll, and **not** a git tag or a rebuild.

**Do not use `apps/<app>/scripts/cloud-run-env.sh` for this.** It exists for
initial service setup and is a liability afterwards, for two independent reasons:

- It pushes **every** variable from the operator's local `.env.cloud-run.<env>`.
  If that file has drifted from what the service is actually running — and there
  is no guarantee it hasn't — a one-line `DATABASE_URL` change silently rewrites
  everything else alongside it.
- After adding a new secret version it **destroys every previous version**
  (`gcloud secrets versions destroy`, keeping only the newest). That deletes the
  exact value a rollback needs. Both `DATABASE_URL` secrets currently sit at
  version 1 with nothing behind them, which is this behaviour showing its work.

Use scoped commands instead, and **pin the service to an explicit secret version
rather than `:latest`**:

```bash
# cutover: add the new value as a new version, then point the service at it
printf '%s' "$NEW_URL" | gcloud secrets versions add DATABASE_URL \
  --project <app-project> --data-file=-
gcloud run services update <service> --region us-central1 \
  --project <app-project> --update-secrets DATABASE_URL=DATABASE_URL:<new-version>

# rollback: point back at the previous version
gcloud run services update <service> --region us-central1 \
  --project <app-project> --update-secrets DATABASE_URL=DATABASE_URL:<old-version>
```

This is a better rollback than the plan started with. Nothing destroys the old
version, so the pre-cutover value stays retrievable in Secret Manager for as long
as the migration runs; rollback is one command and a revision roll, roughly a
minute. It also removes the earlier need to stash the connection string somewhere
outside the system — the value never has to be read out, copied into a ticket, or
pasted into a chat log, so no second uncontrolled copy of a production credential
is created. Record the _version number_ to roll back to; that is not a secret.

Note the pinning matters in its own right: while the reference is
`DATABASE_URL:latest`, a Cloud Run revision rollback restores nothing, because an
older revision re-reads the same `:latest` secret and gets the new value. Traffic
shifting is not a rollback path until the version is pinned.

One consequence for staffing: whoever watches the monitors during a cutover must
also be able to run those two commands for that service. "Roll back on alarm" is not a
plan if the alarm and the authority to act on it sit with different people.

Two things must stay untouched for any of this to work: the PgBouncer VM keeps
running and keeps its entry in Cloud SQL's authorized networks, and the `6432`
firewall rule stays open until decommission. Closing that rule early — it is a
legitimate finding in its own right — would remove the rollback path.

## 8. Open question

**The 88-connection peak is unattributed, and attributing it is a gate on
step 3.** During step 2's 24-hour baseline, run the `pg_stat_activity`
breakdown by `client_addr` from §1 by hand — at minimum once across the
03:45 UTC window where the peak landed and once during weekday daytime traffic —
and record the split before any traffic moves. There is no scheduled sampler;
a handful of manual samples in the right windows is enough to answer it.

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
- Encrypted, IAM-authorized database access on every path. Note the distinction:
  the connector authorizes the _connection_ via IAM and encrypts it, but the
  database still authenticates the _session_ with a username and password secret.
  Cloud SQL IAM database authentication is a separate migration, not in scope here.
- Production connection behavior matches every other environment.
- Six open infrastructure problems close without being individually fixed.

## How it used to be

The PgBouncer setup as found on 2026-08-11, read off the live VM and `gcloud`.
Kept here, rather than as a standalone doc, because it only needs to outlive
the migration — it is what steps 3–5 roll back to and then delete.

```
Cloud Run  f3-api / f3-map        DATABASE_URL → :6432
    │  TCP 6432, public internet, no TLS
    ▼
GCE VM  f3data-pgbouncer-vm       project f3data · us-central1-c · e2-micro
        10.128.0.4 / 34.172.230.30 (reserved static "pgbouncer")
        DNS pgbouncer.prod.db.f3nation.com
    │  TCP 5432, no TLS
    ▼
Cloud SQL  f3data                 POSTGRES_18 · db-custom-2-8192 · 35.239.19.124
```

**The box.** Created by hand 2025-04-23; no Terraform, startup script, or
config management. PgBouncer 1.16.1 from Ubuntu 22.04's apt package, run by a
SysV init script (`/etc/init.d/pgbouncer`, not a systemd unit) as `postgres`.
`unattended-upgrades` is on. Production only — staging, local, and previews
never had a pooler.

**The config**, `/etc/pgbouncer/pgbouncer.ini`, comments stripped:

```ini
[databases]
* = host=35.239.19.124 port=5432

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 20
min_pool_size = 5
reserve_pool_size = 10
server_reset_query = DISCARD ALL
server_check_query = SELECT 1
ignore_startup_parameters = extra_float_digits
pidfile = /var/run/postgresql/pgbouncer.pid
unix_socket_dir = /var/run/pgbouncer
max_db_connections = 40
server_lifetime = 3600
idle_transaction_timeout = 60
client_idle_timeout = 300
log_disconnections = 1
```

Three lines carried the weight. `max_db_connections = 40` was the real ceiling
on server connections (§4). `pool_mode = transaction` is what forced
`prepare: false` and ruled out session state. The `* =` wildcard forwards any
requested database name to Cloud SQL's hardcoded IP. `userlist.txt` holds MD5
hashes for `api`, `map`, and `postgres`, which PgBouncer passes through to
Cloud SQL. `unix_socket_dir` points at a directory that does not survive a
boot and no `admin_users` is set, so the admin console (`SHOW POOLS`) was
unreachable; with no `logfile` or syslog and the daemon detached, nothing was
logged after April 2025.

**What it forced on the application**, undone in step 5's cleanup PR:

- `getDbUrl()` in `packages/db/src/utils/functions.ts` sets `useSsl = false`
  (`// Remove SSL to enable PGBouncer to work`).
- `docs/AI_DEVELOPMENT_GUIDE.md` requires `prepare: false` under transaction
  pooling.

**What wires it in**, which is exactly what step 5 removes:

- Cloud SQL `f3data` authorized network `34.172.230.30`, labelled
  `PG Bouncer?`. The other five entries are Datastream's.
- Firewall rule `pgbouncer` in `f3data`: TCP 6432 from `0.0.0.0/0`, no target
  tags.
- The `DATABASE_URL` secret in `f3-api-app` and `f3-map-app`, shaped
  `postgres://<user>:<password>@<pgbouncer host or IP>:6432/f3_prod`.

**Getting to it while it still exists:**

```bash
gcloud compute ssh f3data-pgbouncer-vm --project f3data --zone us-central1-c
sudo systemctl status pgbouncer        # redirected through the SysV script
sudo ss -lntp | grep 6432
nc -vz pgbouncer.prod.db.f3nation.com 6432   # reachability from outside
```
