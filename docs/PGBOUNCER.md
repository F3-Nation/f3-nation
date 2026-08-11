# PgBouncer

How F3 Nation pools Postgres connections in production: what PgBouncer is, where it
runs, how to reach it, how to check on it, and what breaks when it goes down.

> **Scope.** PgBouncer is **production only**. Staging, local dev, and PR preview
> environments all talk to Postgres directly. See [Environments](#environments).

---

## 1. Why it exists

Cloud Run scales horizontally: every instance of `f3-api`, `f3-map`, and `f3-admin`
opens its own pool of Postgres connections. Postgres allocates a full backend process
per connection, so `instances × pool_size` can exhaust the database long before CPU or
memory is the limit. Cloud SQL caps `max_connections` by tier.

PgBouncer sits between the apps and Cloud SQL. Apps open cheap connections to
PgBouncer; PgBouncer multiplexes them onto a much smaller set of real Postgres
connections, handing a server connection to a client only for the duration of a
transaction (transaction pooling).

```
┌──────────────────────────────────────┐
│ Cloud Run (per app project)          │
│   f3-api / f3-map / f3-admin         │
│   DATABASE_URL → :6432               │
└───────────────┬──────────────────────┘
                │ TCP 6432 (public internet, no TLS)
                ▼
┌──────────────────────────────────────┐
│ GCE VM  f3data-pgbouncer-vm          │
│ project f3data · us-central1-c       │
│ 10.128.0.4 (int) · 34.172.230.30 (ext)│
│ DNS pgbouncer.prod.db.f3nation.com   │
└───────────────┬──────────────────────┘
                │ TCP 5432
                ▼
┌──────────────────────────────────────┐
│ Cloud SQL  f3data  (POSTGRES_18)     │
│ db-custom-2-8192 · 35.239.19.124     │
│ database: f3_prod                    │
└──────────────────────────────────────┘
```

---

## 2. Where it lives

| Thing             | Value                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GCP project       | `f3data`                                                                                                                                                                      |
| Resource          | GCE VM `f3data-pgbouncer-vm`                                                                                                                                                  |
| Zone              | `us-central1-c`                                                                                                                                                               |
| Machine type      | `e2-micro` (2 shared vCPU, 1 GB)                                                                                                                                              |
| Image             | Ubuntu 22.04 LTS Minimal, 10 GB boot disk                                                                                                                                     |
| Internal IP       | `10.128.0.4`                                                                                                                                                                  |
| External IP       | `34.172.230.30` — a **reserved static** address named `pgbouncer` in `us-central1`, so it survives VM recreation (and it is what Cloud SQL's authorized-networks list allows) |
| DNS               | `pgbouncer.prod.db.f3nation.com` → `34.172.230.30`                                                                                                                            |
| Listen port       | `6432`                                                                                                                                                                        |
| Created           | 2025-04-23                                                                                                                                                                    |
| PgBouncer version | **1.16.1** (`pgbouncer 1.16.1-1ubuntu1`, stock Ubuntu 22.04 apt package)                                                                                                      |
| Process           | `/usr/sbin/pgbouncer -d /etc/pgbouncer/pgbouncer.ini`, running as `postgres`                                                                                                  |
| Service manager   | SysV init (`/etc/init.d/pgbouncer`) — **not** a native systemd unit; `enabled` at boot                                                                                        |
| Last start        | 2025-11-11 (VM last rebooted then; PgBouncer came back automatically)                                                                                                         |
| Service account   | `1086302786213-compute@developer.gserviceaccount.com` (default compute SA)                                                                                                    |
| Network tags      | `http-server`, `https-server`                                                                                                                                                 |

The VM also has `unattended-upgrades` enabled (`APT::Periodic::Unattended-Upgrade "1"`),
which is why an unscheduled reboot/restart can happen without anyone touching it.

Firewall rule `pgbouncer` (project `f3data`, VPC `default`) allows **TCP 6432 from
`0.0.0.0/0`** — no target tags, so it applies to every VM in the project. See
[Known gaps](#8-known-gaps--risks).

There is no Terraform, no startup script, and no config management for this VM. It was
created by hand and PgBouncer was installed and configured on the box. The only record
of it before this document was two lines in a README.

---

## 3. The database behind it

Cloud SQL instance `f3data` in project `f3data`:

| Setting      | Value                                                             |
| ------------ | ----------------------------------------------------------------- |
| Engine       | POSTGRES_18                                                       |
| Tier         | `db-custom-2-8192` (2 vCPU, 8 GB)                                 |
| Disk         | 25 GB `PD_HDD`                                                    |
| Public IP    | `35.239.19.124`                                                   |
| Availability | `ZONAL` (no HA / no failover replica)                             |
| SSL          | `sslMode: ALLOW_UNENCRYPTED_AND_ENCRYPTED`, `requireSsl: false`   |
| Backups      | daily 01:00 UTC, 7 retained, PITR on (7 days of transaction logs) |
| Maintenance  | Saturday 06:00, `canary` update track                             |
| Flags        | `cloudsql.logical_decoding=on`, `log_min_duration_statement=5000` |

Authorized networks (the only IPs allowed to reach the public IP):

| IP                                                                             | Label                              |
| ------------------------------------------------------------------------------ | ---------------------------------- |
| `34.172.230.30`                                                                | `PG Bouncer?` — the PgBouncer VM   |
| `34.72.28.29`, `34.67.234.134`, `34.67.6.157`, `34.72.239.218`, `34.71.242.81` | Datastream replication to BigQuery |

That is the enforcement point for the **public IP**: nothing but PgBouncer and
Datastream can reach prod Postgres that way. If you add an app that dials the public IP
directly, it will hang until you either add its egress IP here or route it through
PgBouncer.

It is not the only door, though. Workloads attached through the Cloud SQL connector
(`--add-cloudsql-instances` / Auth Proxy) bypass authorized networks entirely — that is
how `app_auth` and `f3slackbot` connect today (see
[§4](#not-everything-in-production-goes-through-pgbouncer)).

The non-production instance `f3data-nonprod` (`db-g1-small`, `34.46.232.108`) is
separate and is **not** fronted by PgBouncer.

---

## 4. Environments

| Environment                 | Connects to                                                                            | Port | Pooled?                                           |
| --------------------------- | -------------------------------------------------------------------------------------- | ---- | ------------------------------------------------- |
| **Production**              | `pgbouncer.prod.db.f3nation.com` (`34.172.230.30`) → `f3_prod`                         | 6432 | ✅ PgBouncer                                      |
| **Staging**                 | `staging.db.f3nation.com` (`34.46.232.108`, Cloud SQL `f3data-nonprod`) → `f3_staging` | 5432 | ❌ direct                                         |
| **Local dev**               | `localhost` Postgres 18 in Docker → `f3nation`                                         | 5433 | ❌ direct (see `docker-compose.yml`)              |
| **Local against Cloud SQL** | Cloud SQL Auth Proxy → `f3data:us-central1:f3data-nonprod`                             | 5433 | ❌ direct (see `scripts/db-proxy.sh`)             |
| **PR previews**             | Postgres sidecar container on `localhost`                                              | 5432 | ❌ direct (see `.github/preview/*.template.yaml`) |

Practical consequence: **pooling behavior is not exercised anywhere except
production.** A query pattern that works in staging can still break in prod if it
depends on session state (see [App-side constraints](#5-app-side-constraints)).

### Not everything in production goes through PgBouncer

`pg_stat_activity` on `f3_prod`, grouped by `client_addr`, shows the pooler fronts only
some of the fleet:

| Client                                     | Reaches Postgres via                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `api`, `map` (and `admin`) — `postgres.js` | `client_addr = 34.172.230.30` → **through PgBouncer**                                       |
| `app_auth` — `postgres.js`                 | no `client_addr` → **direct** (Cloud SQL socket / connector)                                |
| `f3slackbot`                               | no `client_addr` → **direct**                                                               |
| `datastream_user`                          | `client_addr = 34.67.234.134` → **direct** (BigQuery CDC, its own authorized-network entry) |
| `cloudsqladmin`                            | `127.0.0.1` — Cloud SQL's own agent                                                         |

So the "everything goes through the pooler" mental model is already false. Two app
workloads connect straight to Cloud SQL today.

### Measured load (30 days, Cloud Monitoring)

Metric `cloudsql.googleapis.com/database/postgresql/num_backends`, hourly `ALIGN_MAX`:

| Instance         | Peak                          | p95 | Median | `max_connections` |
| ---------------- | ----------------------------- | --- | ------ | ----------------- |
| `f3data` (prod)  | **88** (2026-07-17 03:45 UTC) | 24  | 1      | **400**           |
| `f3data-nonprod` | 20                            | 3   | 1      | —                 |

All 88 of the prod peak were on the `f3_prod` database. Peak sits at **22% of
`max_connections`**; the median hour uses one connection. For scale on the app side,
`f3-admin` peaked at **13 active Cloud Run instances** in the same window against a
`maxScale` of 100.

Repro:

```bash
# max_connections + who is actually connected, without printing the secret
doppler run --project f3-map --config prd --command \
  'psql "$DATABASE_URL" -tAc "show max_connections" \
     -c "select usename, application_name, client_addr, state, count(*) \
         from pg_stat_activity group by 1,2,3,4 order by 5 desc"'
```

Historical connection counts come from the Monitoring API — see the helper script
referenced in the F3 Plane ticket for "PgBouncer VM is an unmanaged zonal SPOF".

### Do we still need it?

The original reason was serverless: connection-per-invocation churn. That is gone —
every app is a Cloud Run container and `packages/db/src/client.ts` memoizes one
`postgres.js` client per process. But **PgBouncer is currently the only ceiling on
connections**: `packages/db/src/utils/functions.ts:28` calls `postgres(databaseUrl,
sslOptions)` with no `max`, so the driver default of 10 applies, and `f3-admin` alone
allows `maxScale: 100` — a theoretical 1000 connections from one service against a
400-connection database. `max_db_connections = 40` is what makes that safe.

Going direct is viable, but only after the ceiling moves into the app: set an explicit
`max` on the postgres-js client (3–5 is ample at `containerConcurrency: 80`), bound
`maxScale` per service, and attach through the Cloud SQL connector rather than the
public IP. Tracked as a decision on the SPOF ticket in Plane.

### Where the connection strings live

Doppler, per app project, `prd` config:

```bash
doppler secrets get DATABASE_URL --project f3-api   --config prd --plain
doppler secrets get DATABASE_URL --project f3-map   --config prd --plain
doppler secrets get DATABASE_URL --project f3-admin --config prd --plain
```

Shape:

```
postgres://<user>:<password>@pgbouncer.prod.db.f3nation.com:6432/f3_prod
```

> ⚠️ `f3-api` and `f3-admin` prod `DATABASE_URL`s hardcode the raw IP
> `34.172.230.30:6432`; only `f3-map` uses the hostname. Normalize all three to
> `pgbouncer.prod.db.f3nation.com` so the endpoint can move without a secret edit and a
> redeploy.

---

## 5. App-side constraints

PgBouncer in transaction pooling mode does not give a client the same backend
connection twice, so anything that relies on session state is unsafe. Two places in
this repo already encode that:

**No TLS to PgBouncer** — `packages/db/src/utils/functions.ts`:

```ts
// Remove SSL to enable PGBouncer to work
const useSsl = false;
```

The app→PgBouncer hop is plaintext. So is PgBouncer→Cloud SQL: the .ini sets no
`server_tls_sslmode` (1.16 defaults to `disable`), and Cloud SQL accepts it because
`requireSsl: false`. Both hops cross the public internet unencrypted.

**No prepared statements** — from `docs/AI_DEVELOPMENT_GUIDE.md`:

> Match the driver to the pooler: with **PgBouncer transaction pooling**, set
> `prepare: false`.

Also avoid, on pooled connections:

- `SET`/`SET LOCAL` outside a transaction, and any session GUC you expect to persist
- `LISTEN`/`NOTIFY`
- Advisory locks held across statements
- Session-level temp tables
- `WITH HOLD` cursors

And when sizing app pools: `instances × pool_max` must stay under PgBouncer's
`max_client_conn`, and PgBouncer's `default_pool_size` must stay under Cloud SQL's
`max_connections`.

---

## 6. Getting to it

SSH to the VM (requires GCP access to project `f3data`):

```bash
gcloud auth login
gcloud compute ssh f3data-pgbouncer-vm --project f3data --zone us-central1-c
```

Config lives at:

```
/etc/pgbouncer/pgbouncer.ini    # pools, ports, modes, limits
/etc/pgbouncer/userlist.txt     # credentials PgBouncer accepts from clients
```

Service control — this is a **SysV init script**, not a native systemd unit, so
`systemctl` calls get redirected through `systemd-sysv-install`:

```bash
sudo systemctl status pgbouncer     # or: sudo service pgbouncer status
sudo systemctl reload pgbouncer     # re-reads config, keeps connections
sudo systemctl restart pgbouncer    # drops all client connections
ps -o pid,user,etime,args -C pgbouncer
sudo ss -lntp | grep 6432
```

`journalctl -u pgbouncer` returns **no entries** — see [logging](#logging-is-currently-off).

### The live config

`/etc/pgbouncer/pgbouncer.ini`, verbatim (comments stripped):

```ini
[databases]
* = host=35.239.19.124 port=5432

[users]

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

What that actually means:

| Setting                            | Meaning here                                                                                                                                                                                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `* = host=35.239.19.124 port=5432` | **Wildcard.** Any database name a client asks for is forwarded to prod Cloud SQL by IP. There is no per-database allowlist and no `dbname=` override — `f3_prod` works because the client asks for it. The Cloud SQL IP is hardcoded; if the instance IP changes, this line must change. |
| `pool_mode = transaction`          | Server connections are handed out per transaction. This is what forbids prepared statements and session state (§5).                                                                                                                                                                      |
| `max_client_conn = 1000`           | Ceiling on app-side connections into PgBouncer.                                                                                                                                                                                                                                          |
| `default_pool_size = 20`           | 20 server connections per (user, database) pair.                                                                                                                                                                                                                                         |
| `reserve_pool_size = 10`           | 10 extra per pool for clients that have been waiting.                                                                                                                                                                                                                                    |
| `max_db_connections = 40`          | **The real ceiling: at most 40 server connections to `f3_prod` across all pools.** This, not `default_pool_size`, is what Cloud SQL sees.                                                                                                                                                |
| `min_pool_size = 5`                | Keeps 5 warm so a cold spike doesn't pay connection setup.                                                                                                                                                                                                                               |
| `client_idle_timeout = 300`        | Idle client connections dropped after 5 min.                                                                                                                                                                                                                                             |
| `idle_transaction_timeout = 60`    | A transaction left open and idle for 60s is killed — this is the guard against one bad request pinning a server connection.                                                                                                                                                              |
| `server_lifetime = 3600`           | Server connections recycled hourly.                                                                                                                                                                                                                                                      |
| `auth_type = md5`                  | Password auth against `userlist.txt`. Note MD5 is deprecated upstream in favor of SCRAM.                                                                                                                                                                                                 |

`/etc/pgbouncer/userlist.txt` contains three users — `api`, `map`, `postgres` — with
MD5 password hashes. These are the credentials the apps present; they must also be
valid on Cloud SQL, since PgBouncer forwards them.

### Capacity math

```
Cloud Run instances × app pool size   ≤  max_client_conn (1000)
PgBouncer → Cloud SQL                 ≤  max_db_connections (40)  ← the tight one
Cloud SQL max_connections             =  Cloud SQL default for db-custom-2-8192
                                         (no max_connections flag is set on the instance)
```

Check the database's side with:

```sql
SHOW max_connections;
SELECT count(*) FROM pg_stat_activity;
```

40 server connections is comfortably under any Cloud SQL default — the pooler is doing
its job. The number to watch is client-side queueing, not the database.

---

## 7. Checking on it

### Is it up?

From anywhere with the prod credentials:

```bash
# TCP reachability
nc -vz pgbouncer.prod.db.f3nation.com 6432

# Real query through the pool
psql "postgres://<user>:<password>@pgbouncer.prod.db.f3nation.com:6432/f3_prod" -c "select 1"
```

### The admin console — currently unreachable

PgBouncer exposes its own virtual database named `pgbouncer` (`SHOW POOLS`, `SHOW
STATS`, `RELOAD`, `PAUSE`). **On this box you cannot get to it today.** Two reasons:

1. `unix_socket_dir = /var/run/pgbouncer` — **that directory does not exist.** `/var/run`
   is a tmpfs; it is recreated empty on every boot and nothing recreates the PgBouncer
   socket dir. `ss -lntp` shows PgBouncer listening only on TCP `0.0.0.0:6432`, no unix
   socket. So the usual peer-authenticated local admin path is gone.
2. No `admin_users` (or `stats_users`) is set in the .ini, and there is no `pgbouncer`
   entry in `userlist.txt` — so there is no account that can log into the admin
   database over TCP either.

Attempting it fails like this:

```
psql: error: connection to server on socket "/var/run/pgbouncer/.s.PGSQL.6432" failed:
No such file or directory
```

**Fix (one-line change, do this before you need it in an incident):** point
`unix_socket_dir` at the directory that already exists and is owned by `postgres`, and
name an admin user:

```ini
unix_socket_dir = /var/run/postgresql
admin_users = postgres
stats_users = postgres
```

then `sudo systemctl restart pgbouncer` (restart, not reload — socket changes need it),
after which:

```bash
sudo -u postgres psql -h /var/run/postgresql -p 6432 -U postgres pgbouncer -c "SHOW POOLS;"
```

Once that is in place, the commands worth knowing (these are PgBouncer's, not SQL):

| Command                        | Tells you                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `SHOW POOLS;`                  | per-pool `cl_active` / `cl_waiting` / `sv_active` / `sv_idle` — **`cl_waiting > 0` means clients are queuing for a server connection** |
| `SHOW CLIENTS;`                | every connected client, its state and age                                                                                              |
| `SHOW SERVERS;`                | the real Postgres connections behind the pools                                                                                         |
| `SHOW STATS;`                  | per-database request rate, bytes, average query and wait time                                                                          |
| `SHOW CONFIG;`                 | the live config (authoritative over the .ini if someone `SET` it)                                                                      |
| `SHOW DATABASES;`              | configured targets and their pool sizes                                                                                                |
| `RELOAD;`                      | re-read the .ini without dropping clients                                                                                              |
| `PAUSE <db>;` / `RESUME <db>;` | drain a pool (e.g. for a Cloud SQL maintenance window)                                                                                 |

### Logging is currently off

There is no working PgBouncer log:

- The .ini sets no `logfile` and no `syslog`, and the daemon runs detached (`-d`), so
  its output goes nowhere.
- `/var/log/postgresql/pgbouncer.log` is **0 bytes**; the rotated
  `pgbouncer.log.1` stops at `2025-04-23 21:46 got SIGTERM, fast exit` — the last time
  a `logfile` was configured.
- `journalctl -u pgbouncer` → `-- No entries --` (SysV init, not a systemd unit).
- There is no logrotate config for it.

So `log_disconnections = 1` in the config is doing nothing, and **there is no record of
connection churn, auth failures, or pool waits.** To restore it, add to the .ini and
restart:

```ini
logfile = /var/log/postgresql/pgbouncer.log
```

(The file already exists and is owned by `postgres`.) Add a logrotate entry at the same
time — the box only has a 10 GB disk.

### The database side

```sql
-- how many real connections PgBouncer is holding
SELECT count(*), state FROM pg_stat_activity GROUP BY state;
SHOW max_connections;
```

Slow queries (>5s) land in Cloud SQL logs via `log_min_duration_statement=5000`:

```bash
gcloud logging read \
  'resource.type="cloudsql_database" AND resource.labels.database_id="f3data:f3data"' \
  --project f3data --limit 50
```

### VM health

```bash
gcloud compute instances describe f3data-pgbouncer-vm --project f3data --zone us-central1-c
```

Metrics (CPU, network) are in Cloud Monitoring under the instance. **There is no
uptime check and no alerting on this VM or on PgBouncer today.**

---

## 8. Known gaps / risks

| #   | Gap                                                                                                                                                              | Impact                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Single `e2-micro` VM, zonal, hand-built.** No instance group, no health check, no IaC, no startup script.                                                      | Loss of the VM or the zone takes **all of production** offline, and there is no scripted rebuild. Recovery is manual.                                                           |
| 2   | **Port 6432 open to `0.0.0.0/0`.** The firewall rule has no target tags or source restriction.                                                                   | Prod DB credentials are the only thing standing between the internet and `f3_prod`. Should be restricted to Cloud Run egress (static NAT IPs or a VPC connector).               |
| 3   | **No TLS on either hop.** App→PgBouncer is plaintext by design; Cloud SQL has `requireSsl: false`.                                                               | Credentials and row data cross the public internet unencrypted.                                                                                                                 |
| 4   | **Cloud SQL prod is `ZONAL`.** No HA, no read replica.                                                                                                           | Zone failure = outage; recovery is restore-from-backup (RPO up to PITR window).                                                                                                 |
| 5   | **No monitoring or alerting** on PgBouncer pool saturation, `cl_waiting`, or VM liveness.                                                                        | Connection exhaustion is discovered by users, not by an alert.                                                                                                                  |
| 6   | **Pooling is prod-only.**                                                                                                                                        | Transaction-pooling incompatibilities (prepared statements, session state) cannot surface before production.                                                                    |
| 7   | `f3-api` and `f3-admin` prod `DATABASE_URL`s pin the raw IP; only `f3-map` uses DNS.                                                                             | The endpoint cannot move without editing secrets in Doppler and redeploying two apps.                                                                                           |
| 8   | **The admin console is unreachable** — `unix_socket_dir` points at a directory that does not exist after boot, and no `admin_users`/`stats_users` is configured. | During an incident you cannot run `SHOW POOLS`, `SHOW STATS`, `PAUSE`, or `RELOAD`. You are blind to queueing. One-line fix in [§7](#the-admin-console--currently-unreachable). |
| 9   | **No logs at all.** No `logfile`, no syslog, no journal, daemonized.                                                                                             | No record of auth failures, disconnect storms, or pool waits. Fix in [§7](#logging-is-currently-off).                                                                           |
| 10  | **PgBouncer 1.16.1** (Ubuntu 22.04 stock, released 2021) with `auth_type = md5`.                                                                                 | Years of upstream fixes missing; MD5 auth is deprecated in favor of SCRAM.                                                                                                      |
| 11  | **Wildcard `[databases] * =`** forwards any requested database name to prod Cloud SQL, with the Cloud SQL **IP hardcoded**.                                      | No per-database allowlist; and a Cloud SQL IP change silently breaks prod until someone edits the .ini by hand.                                                                 |
| 12  | `unattended-upgrades` is on, on a single unmanaged box.                                                                                                          | An automatic package upgrade or reboot can restart the pooler with no one watching and no logs to show for it.                                                                  |
| 13  | Boot disk is 10 GB and the VM runs the default compute service account with broad default scopes.                                                                | Minor, but it is not least-privilege.                                                                                                                                           |

---

## 9. Runbook

### "The site is down / everything is a database error"

1. `nc -vz pgbouncer.prod.db.f3nation.com 6432` — if it fails, the VM or the service is
   down. Check the instance is `RUNNING`, then SSH in and
   `sudo systemctl status pgbouncer` / `ps -C pgbouncer` / `sudo ss -lntp | grep 6432`.
2. If PgBouncer is up, you want `SHOW POOLS;` — high `cl_waiting` means clients are
   queued and the pool (capped at `max_db_connections = 40`) is the bottleneck.
   **Today that requires first applying the `unix_socket_dir` / `admin_users` fix in
   [§7](#the-admin-console--currently-unreachable) and restarting**, which itself drops
   connections. Fix it on a calm day, not during the incident.
3. Check Cloud SQL directly: instance state, CPU, and `pg_stat_activity` for
   long-running or `idle in transaction` sessions. Kill the offenders. Slow queries
   (>5s) are in Cloud SQL logs via `log_min_duration_statement=5000`.
4. Confirm nothing changed underneath: the `[databases]` stanza hardcodes Cloud SQL's
   IP `35.239.19.124`, and Cloud SQL's authorized-networks list hardcodes the VM's IP
   `34.172.230.30`. If either was changed, every connection fails.
5. Last resort: `sudo systemctl restart pgbouncer`. This **drops every client
   connection**; apps reconnect but in-flight requests fail.

### "We need to rebuild the VM"

There is no automation today. Until [gap #1](#8-known-gaps--risks) is closed:

1. Snapshot `/etc/pgbouncer/` off the current box **before** you need it.
2. A replacement must keep external IP `34.172.230.30` (it is in Cloud SQL's authorized
   networks) or you must add the new IP there first.
3. Install `pgbouncer` from apt, restore `pgbouncer.ini` + `userlist.txt`, `chown
postgres`, enable the init script, open 6432.

### "Cloud SQL maintenance window"

`PAUSE f3_prod;` in the admin console drains the pool cleanly, then `RESUME f3_prod;`
afterward — better than letting every client hit a dropped backend. Requires the admin
console fix in [§7](#the-admin-console--currently-unreachable) first.

---

## 10. Related docs

- `docs/GCP_APP_SETUP.md` — Cloud Run + WIF deploy pipeline for each app
- `docs/LOCAL_DEV_DOCKER.md`, `docs/LOCAL_DEV_SETUP.md` — local Postgres, no pooler
- `docs/AI_DEVELOPMENT_GUIDE.md` §connection pooling — driver/pool sizing rules
- `scripts/db-proxy.sh` — Cloud SQL Auth Proxy to `f3data-nonprod`
- `packages/db/src/utils/functions.ts` — where SSL is disabled for PgBouncer
