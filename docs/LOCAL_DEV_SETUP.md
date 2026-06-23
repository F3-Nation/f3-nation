# Local Development Setup

> **New to the project?** Use the [Docker-based setup](LOCAL_DEV_DOCKER.md) instead — it requires no GCP credentials and gets you running in minutes with a single command.
>
> This document covers the **GCP-connected** setup for contributors who already have access to the `f3-authentication-staging` project.

Step-by-step guide for getting the F3 Nation monorepo running locally with GCP services.

## Prerequisites

| Tool                   | Install                                                      | Verify                      |
| ---------------------- | ------------------------------------------------------------ | --------------------------- |
| Node.js (see `.nvmrc`) | `nvm install`                                                | `node -v`                   |
| pnpm v10+              | `corepack enable && corepack prepare pnpm@latest --activate` | `pnpm -v`                   |
| Google Cloud CLI       | `brew install google-cloud-sdk`                              | `gcloud version`            |
| Cloud SQL Auth Proxy   | `brew install cloud-sql-proxy`                               | `cloud-sql-proxy --version` |

## 1. Clone and install

```bash
git clone git@github.com:F3-Nation/f3-nation.git
cd f3-nation
nvm install      # uses .nvmrc
pnpm install
```

## 2. Authenticate with Google Cloud

You need access to the **f3-authentication-staging** GCP project. Ask a team lead to grant you the `Secret Manager Secret Accessor` role.

```bash
gcloud auth login
gcloud auth application-default login   # needed by Cloud SQL Auth Proxy
```

## 3. Populate secrets

Secrets live in GCP Secret Manager, not in the repo. The fastest way to get a working `.env` is the automated script:

```bash
pnpm env:generate
```

This pulls staging secrets from GCP, constructs a complete `.env` at the repo root, and symlinks it into each app directory (`apps/api/.env.local`, `apps/map/.env.local`, `apps/auth/.env.local`). Preview what it would do without writing files:

```bash
pnpm env:generate:dry-run
```

> **Safety:** The script only pulls from the `f3-authentication-staging` project — never production. All local dev defaults use staging database, staging APIs, and localhost URLs.

If you need to customize a specific app's env (e.g., point one app at a different API), break the symlink by replacing `apps/<app>/.env.local` with a regular file.

<details>
<summary>Manual setup (if the script doesn't work)</summary>

Pull secrets manually and map them to env vars. The canonical mapping is:

| GCP Secret Name          | `.env` Variable(s)                                | Notes                                                                     |
| ------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------- |
| `database-host`          | `DATABASE_HOST`                                   | Use `localhost` for local dev (proxy handles the connection)              |
| `database-user`          | `DATABASE_USER`                                   | Also used in `DATABASE_URL`                                               |
| `database-password`      | `DATABASE_PASSWORD`                               | Also used in `DATABASE_URL`                                               |
| `database-name`          | `DATABASE_NAME`                                   | Also used in `DATABASE_URL`                                               |
| `auth-secret`            | `AUTH_SECRET`                                     | Required in production; optional in dev                                   |
| `auth-jwt-private-key`   | `AUTH_JWT_PRIVATE_KEY`                            | RSA PEM key; single-line with `\n` escapes, wrapped in double quotes      |
| `api-key`                | `API_KEY`                                         |                                                                           |
| `super-admin-api-key`    | `SUPER_ADMIN_API_KEY`                             |                                                                           |
| `sendgrid-api-key`       | `EMAIL_SERVER`                                    | SMTP connection string (e.g. `smtp://apikey:<key>@smtp.sendgrid.net:587`) |
| `google-maps-api-key`    | `NEXT_PUBLIC_GOOGLE_API_KEY`, `F3_GOOGLE_API_KEY` | Google Maps JS API key; required by map + api + admin apps.               |
| _(set manually)_         | `EMAIL_FROM`                                      | Sender address (e.g. `noreply@f3nation.com`)                              |
| _(set manually)_         | `EMAIL_ADMIN_DESTINATIONS`                        | Comma-separated admin email addresses                                     |
| _(same as DATABASE_URL)_ | `TEST_DATABASE_URL`                               | Connection string for test database                                       |
| _(set manually)_         | `NOTIFY_WEBHOOK_URLS_COMMA_SEPARATED`             | Optional; comma-separated webhook URLs for notifications                  |

**Client-side variables** (set these directly in `.env`):

| Variable               | Example value           | Notes                                                     |
| ---------------------- | ----------------------- | --------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`  | `http://localhost:3001` | URL of the API app                                        |
| `NEXT_PUBLIC_MAP_URL`  | `http://localhost:3000` | URL of the Map app                                        |
| `NEXT_PUBLIC_AUTH_URL` | `http://localhost:3004` | Optional; URL of the Auth app                             |
| `NEXT_PUBLIC_CHANNEL`  | `local`                 | One of: `local`, `ci`, `branch`, `dev`, `staging`, `prod` |

Construct `DATABASE_URL` from the individual fields:

```
DATABASE_URL=postgresql://<DATABASE_USER>:<DATABASE_PASSWORD>@localhost:5433/<DATABASE_NAME>
```

See each app's `.env.example` (e.g., `apps/api/.env.example`, `apps/map/.env.example`) for a complete template with placeholder values.

</details>

## 4. Start the Cloud SQL Auth Proxy

The staging database is a Cloud SQL instance. Locally, you connect through the proxy which authenticates via your `gcloud` credentials and exposes the DB on `localhost:5433`.

### Quick start (manual)

Run in a dedicated terminal tab — it needs to stay running while you develop:

```bash
cloud-sql-proxy f3data:us-central1:f3data-nonprod --port 5433
```

### Run as a background service (recommended)

Setting up the proxy as a persistent service means it starts automatically on login and you never have to think about it.

Adapted from [F3-Nation/database-helpers](https://github.com/F3-Nation/database-helpers#3-run-the-proxy-as-a-background-service).

#### macOS (launchd)

Create a plist file:

```bash
mkdir -p ~/Library/LaunchAgents
cat > ~/Library/LaunchAgents/com.google.cloud-sql-proxy.plist << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.google.cloud-sql-proxy</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/cloud-sql-proxy</string>
    <string>f3data:us-central1:f3data-nonprod?port=5433</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/cloud-sql-proxy.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/cloud-sql-proxy.err</string>
</dict>
</plist>
PLIST
```

> **Note:** If you installed via direct download instead of Homebrew, change the path to `/usr/local/bin/cloud-sql-proxy`. Intel Macs using Homebrew should use `/usr/local/bin/cloud-sql-proxy`.

Load and start the service:

```bash
launchctl load ~/Library/LaunchAgents/com.google.cloud-sql-proxy.plist
```

Verify it's running:

```bash
launchctl list | grep cloud-sql-proxy
lsof -i :5433   # should show cloud-sql-proxy listening
```

To stop or unload:

```bash
launchctl unload ~/Library/LaunchAgents/com.google.cloud-sql-proxy.plist
```

#### Linux / WSL (systemd)

Create a user service:

```bash
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/cloud-sql-proxy.service << 'EOF'
[Unit]
Description=Cloud SQL Auth Proxy

[Service]
ExecStart=/usr/local/bin/cloud-sql-proxy \
  "f3data:us-central1:f3data-nonprod?port=5433"
Restart=on-failure

[Install]
WantedBy=default.target
EOF
```

Enable and start:

```bash
systemctl --user daemon-reload
systemctl --user enable --now cloud-sql-proxy
```

Check status:

```bash
systemctl --user status cloud-sql-proxy
```

### How it works in each environment

| Environment                  | Connection method                                       | DATABASE_HOST                                 |
| ---------------------------- | ------------------------------------------------------- | --------------------------------------------- |
| **Local dev**                | Cloud SQL Auth Proxy on localhost:5433                  | `localhost`                                   |
| **Cloud Run (staging/prod)** | Built-in Cloud SQL sidecar (`--add-cloudsql-instances`) | `/cloudsql/f3data:us-central1:f3data-nonprod` |

## 5. Run database migrations

```bash
pnpm db:migrate
```

This applies all pending Drizzle migrations. On first setup you may need to run this before the apps will start correctly.

Other useful database commands:

| Command            | Description                                  |
| ------------------ | -------------------------------------------- |
| `pnpm db:migrate`  | Apply pending migrations                     |
| `pnpm db:generate` | Generate a new migration from schema changes |
| `pnpm db:studio`   | Open Drizzle Studio (DB browser)             |
| `pnpm db:seed`     | Seed the database with test data             |
| `pnpm db:reset`    | Reset the database (destructive!)            |

## 6. Start dev servers

```bash
pnpm dev
```

This starts all apps in parallel via Turborepo:

| App  | URL                   | Port |
| ---- | --------------------- | ---- |
| Map  | http://localhost:3000 | 3000 |
| API  | http://localhost:3001 | 3001 |
| Me   | http://localhost:3003 | 3003 |
| Auth | http://localhost:3004 | 3004 |

## Driving sign-in from automation (CI, AI agents, /pst:qa)

`apps/auth` routes all outbound email through `EMAIL_SERVER` (set in `.env`). In the Docker local dev environment, this points to Mailpit (`smtp://localhost:1025`), which captures every email without sending it. Headless automation can retrieve the 6-digit MFA code or magic link from Mailpit's API at `http://localhost:8025/api/v1/messages`. **No real inbox is needed locally**, and the `/api/verify-email` rate limit is bypassed in non-production environments.

> **Note:** `scripts/qa/extract-mfa-link.sh` was written for the old Ethereal flow and needs to be updated to query Mailpit's API instead of parsing Ethereal preview URLs from logs.

Cookbook: [`docs/QA_LOCAL_AUTH.md`](QA_LOCAL_AUTH.md). Agent reference: [`apps/auth/AGENTS.md`](../apps/auth/AGENTS.md).

## Troubleshooting

### `relation "auth.email_mfa_codes" does not exist`

Run `pnpm db:migrate` — you have pending migrations.

### `connection refused` on port 5433

The Cloud SQL Auth Proxy isn't running. Start it:

```bash
cloud-sql-proxy f3data:us-central1:f3data-nonprod --port 5433
```

### `permission denied` accessing GCP secrets

Ask a team lead to grant your Google account the `Secret Manager Secret Accessor` role on the `f3-authentication-staging` project.

### Port already in use

Another process is using the port. Find and kill it:

```bash
lsof -ti:5433 | xargs kill   # for the proxy
lsof -ti:3000 | xargs kill   # for the map app
```
