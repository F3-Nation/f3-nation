# Connecting to the staging or prod database

The staging and prod databases live on Cloud SQL in the `f3data` project and
have no public address you can reach directly. You reach them from your own
machine through the Cloud SQL Auth Proxy (`cloud-sql-proxy`): it listens on a
local port and forwards to Cloud SQL over an encrypted, IAM-authenticated
connection. Anything that talks to the database from your machine, such as
`pnpm db:migrate:staging` ([db-migrations.md](db-migrations.md)), psql, or
`apps/auth/scripts/migrate-oauth-clients-to-better-auth.ts`, connects to that
local port.

| Database | Instance connection name            | Local port |
| -------- | ----------------------------------- | ---------- |
| staging  | `f3data:us-central1:f3data-nonprod` | 5482       |
| prod     | `f3data:us-central1:f3data`         | 5481       |

## What you need first

1. **IAM access.** Your Google account must be in the
   `gcp.database-access@f3nation.com` group, which grants Cloud SQL Client on
   `f3data`. Ask a GCP admin to add you.
2. **A database user and password** for the database you're connecting to.
   IAM access lets the proxy reach the instance; Postgres still checks its own
   login. Ask a GCP admin for one.
3. **gcloud**, the Google Cloud CLI.
4. **cloud-sql-proxy**, version 2.

Google Cloud Shell doesn't work for this: the proxy there fails with a 403
about the billing or quota project. Run it on your own machine.

## Install the tools

### macOS

```sh
brew install --cask google-cloud-sdk
brew install cloud-sql-proxy
```

### Linux

Install gcloud from <https://cloud.google.com/sdk/docs/install>, then download
the `cloud-sql-proxy` binary for your platform from
<https://cloud.google.com/sql/docs/postgres/sql-proxy#install>, make it
executable (`chmod +x cloud-sql-proxy`) and put it on your `PATH`.

### Windows (PowerShell)

```powershell
winget install Google.CloudSDK
```

Then download `cloud-sql-proxy.x64.exe` from
<https://cloud.google.com/sql/docs/postgres/sql-proxy#install>, rename it to
`cloud-sql-proxy.exe`, and put it in a folder on your `PATH`, so the commands
below work as written. Open a new PowerShell window after installing so both
commands are found.

## Sign in (once per machine)

The same on every OS:

```sh
gcloud auth login
gcloud auth application-default login
```

The proxy uses the second login (Application Default Credentials).

If the proxy later fails with a 403 that mentions a billing, quota or
`serviceusage` project, point gcloud at a project you're allowed to use, then
run the application-default login again:

```sh
gcloud config set project YOUR_PROJECT_ID
gcloud auth application-default login
```

## Start the proxy

Run it in its own terminal and leave it running while you work. Stop it with
Ctrl+C when you're done.

```sh
# staging
cloud-sql-proxy f3data:us-central1:f3data-nonprod --port 5482

# prod
cloud-sql-proxy f3data:us-central1:f3data --port 5481
```

It's ready when it prints `The proxy has started successfully and is ready
for new connections!`.

Connect to `127.0.0.1` on that port **without SSL**: the local port doesn't
speak SSL, and the proxy already encrypts the connection to Cloud SQL. For
example, with psql:

```sh
psql "host=127.0.0.1 port=5482 dbname=f3_staging user=YOUR_DB_USER sslmode=disable"
```

## Troubleshooting

- **`connection refused` on 127.0.0.1:** the proxy isn't running, or it's on
  a different port.
- **The proxy logs `403` / `NOT_AUTHORIZED`:** your account isn't in the
  database-access group yet, or the application-default login is missing or
  for a different account. Re-run `gcloud auth application-default login`.
- **`password authentication failed`:** the proxy is fine; the database user
  or password is wrong.
- **`The server does not support SSL connections`:** the client asked for SSL.
  Turn it off (`sslmode=disable`) for a connection through the proxy.
