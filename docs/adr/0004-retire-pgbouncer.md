# ADR 0004: Retire PgBouncer in favor of bounded direct connections

- **Date:** 2026-09-22 (investigation 2026-08-11)
- **Author(s):** @dnishiyama, with the removal direction agreed by
  @taterhead247 on 2026-08-25

## Context

`api` and `map` reach the production Postgres (`f3data`) through PgBouncer, a
pooler on a single hand-built VM. Everything else that talks to the database
already connects directly. The setup as found is recorded under
[How it used to be](#how-it-used-to-be).

### The load does not justify a pooler

Measured 2026-08-11 from Cloud Monitoring
(`cloudsql.googleapis.com/database/postgresql/num_backends`, hourly `ALIGN_MAX`,
30 days):

| Instance                   | Peak                          | p95 | `max_connections` |
| -------------------------- | ----------------------------- | --- | ----------------- |
| `f3data` (production)      | **88** (2026-07-17 03:45 UTC) | 24  | **400**           |
| `f3data-nonprod` (staging) | 20                            | 3   | —                 |

The worst hour in a month left 78% of the connection ceiling unused.
Transaction pooling solves many short-lived clients contending for a few
expensive backends; at this volume there is no contention to relieve, so the
pooler is a second network hop and a second thing to operate, not tuning.

All 88 peak connections were on `f3_prod`, which PgBouncer caps at 40, so at
least 48 of them were already direct traffic.

### The original justification is gone

PgBouncer was stood up in April 2025, when the map ran on a serverless platform
and every invocation could open its own connection. Every app is now a
long-lived Cloud Run container holding one memoized `postgres.js` client per
process, with its own pool.

### The direct path already runs in production

| Client            | Reaches Postgres via                              |
| ----------------- | ------------------------------------------------- |
| `api`, `map`      | **PgBouncer** (`client_addr = 34.172.230.30`)     |
| `app_auth`        | **direct**, Cloud Run's Cloud SQL connector       |
| `f3slackbot`      | **direct**, Cloud Run's Cloud SQL connector       |
| `datastream_user` | direct (BigQuery CDC, its own authorized network) |
| `cloudsqladmin`   | Cloud SQL's own agent                             |

Only `api` and `map` are database clients among the TypeScript apps that use
PgBouncer: `admin` and `me` call the API over HTTP and never open a database
connection. `map` connects because its server-side rendering runs the API router
in-process.

### What PgBouncer actually provided

One thing: a hard ceiling on connections into Postgres
(`max_db_connections = 40`). It mattered only because the application set no
pool limit of its own — ten connections per instance by default, against
services allowed to scale to 100 instances. That limit now lives in the driver
(`max: 5`, with idle and connect timeouts, plus a client-side pool-wait timeout),
which is where it belongs.

### What keeping it would cost

| Problem                                                                      | Why it matters                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Single hand-built `e2-micro`, one zone, no IaC, no health check, no autoheal | Losing it takes all pooled production traffic offline        |
| Port 6432 open to `0.0.0.0/0`                                                | Credentials are the only barrier from the open internet      |
| No TLS on either hop                                                         | Credentials and rows cross the internet in plaintext         |
| No logging since April 2025                                                  | No record of auth failures, disconnects, or pool waits       |
| Admin console unreachable                                                    | `SHOW POOLS` is unavailable during an incident               |
| PgBouncer 1.16.1 (2021), `auth_type = md5`                                   | Years of upstream fixes missing; MD5 is deprecated           |
| `unattended-upgrades` on an unmanaged box                                    | A package upgrade can restart the pooler unwatched, unlogged |

Making that trustworthy is several days of work on a component that relieves no
measured pressure.

## Decision

**Retire PgBouncer.** `api` and `map` connect directly to Cloud SQL through
Cloud Run's built-in Cloud SQL connector (the Unix-socket path `auth` and the
Slack bot already use), and connection limits are enforced by each client's
configuration rather than by a pooler.

What that commits us to:

- **A whole-instance connection budget.** With no pooler, the sum of every
  direct client's peak connections — a service's `--max-instances` × its
  maximum pool connections (overflow included), a Cloud Run job's concurrent
  tasks × the same — must stay under `max_connections = 400`, with headroom
  below the connection-budget alert. `api` runs at 20 instances and `map` at
  15, each × 5 (sized from 30 days of prod demand: `api` peaked at 20 active
  instances, `map` at 13); the Slack bot's pool is bounded too, and the
  configured total is about 260. The limits live in the deploy workflows and
  client code, not in hand-applied settings.
- **Monitors before the change, not after.** A Cloud Monitoring alert on
  `num_backends` (280, i.e. 70% of 400, above the configured total) backstops a
  breach of the budget, and a PostHog alert on connection-failure root causes
  catches pool exhaustion inside it. Both are baselined against the current topology, and their staging twins
  are seen firing, before any service moves.
- **One service at a time, with a one-command rollback.** Staging first, then
  `api`, then `map`. Cutover and rollback are a switch between pinned versions
  of the service's `DATABASE_URL` secret (never `:latest`), with PgBouncer left
  running as the rollback path until both services have run on the connector
  for a week.
- **Then delete it:** the VM, its firewall rule, and its authorized-network
  entry, followed by restoring what the pooler forced on the application (SSL,
  the default for `prepare`).

## Alternatives considered

**Keep PgBouncer and harden it.** Terraform, a managed instance group with
health checks, TLS on both hops, logging, a working admin console, an upgrade
off 1.16.1. Rejected: several days of work on a component that is relieving no
pressure, still leaving an extra hop and failure domain in front of every query.

**Replace it with a managed pooler.** Cloud SQL's managed connection pooling
would remove the single point of failure without removing pooling. Rejected for
now on the same grounds: it buys pooling there is no measured need for. Worth
revisiting if load ever approaches the ceiling.

**Do nothing.** Rejected: an unmonitored, unlogged, internet-reachable single
point of failure that can restart itself unattended is not stable just because
it works today.

## Consequences

**Better:**

- One fewer VM, public listener, and failure domain; no plaintext hops. The
  connector authorizes the _connection_ with IAM (`roles/cloudsql.client`) and
  encrypts it; the database still authenticates the _session_ with a password
  (Cloud SQL IAM database authentication is a separate decision).
- Production connects the way staging, local, and previews already do, so
  pooling-specific breakage can no longer hide until production.
- Transaction-pooling restrictions on session state (`SET`, `LISTEN`/`NOTIFY`,
  advisory locks, session temp tables) go away.

**Accepted risks:**

- The connection ceiling moves from infrastructure into configuration. A deploy
  that raises `--max-instances`, a pool size, or adds an unbounded direct
  client can exhaust Postgres directly. The `num_backends` alert notifies; it
  does not enforce. Every new database client has to be counted against the
  budget by whoever adds it.
- Restoring `prepare` to its default affects only direct tagged-template usage
  (the seed and reset scripts): Drizzle issues every query through
  `client.unsafe()`, which postgres.js never prepares. Those scripts still need
  exercising when it changes.
- Rollback depends on pinned secret versions. While a service references
  `DATABASE_URL:latest`, a Cloud Run revision rollback restores nothing, and the
  `cloud-run-env.sh` helpers destroy old secret versions and re-point every
  secret to `:latest` — so they must not be used for this.

## How it used to be

The PgBouncer setup as found on 2026-08-11, read off the live VM and `gcloud`.
Kept so the rollback target and what gets deleted are on record.

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
SysV init script (`/etc/init.d/pgbouncer`) as `postgres`. `unattended-upgrades`
is on. Production only — staging, local, and previews never had a pooler.

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

`max_db_connections = 40` was the real ceiling. `pool_mode = transaction` is
what forced `prepare: false` and ruled out session state. The `* =` wildcard
forwards any requested database name to Cloud SQL's hardcoded IP.
`userlist.txt` holds MD5 hashes for `api`, `map`, and `postgres`.
`unix_socket_dir` does not survive a boot and no `admin_users` is set, so the
admin console was unreachable; with no `logfile` or syslog, nothing was logged
after April 2025.

**What it forced on the application:** `getDbUrl()` in
`packages/db/src/utils/functions.ts` sets `useSsl = false`
(`// Remove SSL to enable PGBouncer to work`), and the shared client sets
`prepare: false`.

**What wires it in:**

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
