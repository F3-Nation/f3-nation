# Local Development Setup

Step-by-step guide for new contributors to get the F3 Nation monorepo running locally.

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

You need access to these GCP projects:

| Project                       | What's in it                                            | Who to ask          |
| ----------------------------- | ------------------------------------------------------- | ------------------- |
| **f3-authentication-staging** | DB creds, API keys, auth JWT, GCS logo bucket, SendGrid | Team lead           |
| **f3-me-app-staging**         | Me app OAuth client, session secret, GCS avatar creds   | tackle@f3nation.com |

Ask for the **Secret Manager Secret Accessor** role on each project.

```bash
gcloud auth login
gcloud auth application-default login   # needed by Cloud SQL Auth Proxy
```

**Important:** Set the ADC quota project so the Cloud SQL proxy uses the right billing project:

```bash
gcloud auth application-default set-quota-project f3-authentication-staging
```

> **Switching workspaces:** If you also work on other GCP projects (e.g., joinfold), the ADC quota project is global. When switching back to f3-nation, re-run the command above and restart the Cloud SQL proxy (`kill $(lsof -ti :5433)` — launchd restarts it automatically).

## 3. Populate secrets

Secrets live in GCP Secret Manager, not in the repo. The fastest way to get working env files is the automated script:

```bash
pnpm env:generate
```

This does two things:

1. Pulls shared secrets from `f3-authentication-staging`, writes a root `.env`, and symlinks it into `apps/api/.env.local`, `apps/map/.env.local`, `apps/auth/.env.local`
2. Pulls me-specific secrets from `f3-me-app-staging` and writes a standalone `apps/me/.env.local` (no symlink — the me app uses different env vars)

Preview what it would do without writing files:

```bash
pnpm env:generate:dry-run
```

> **Safety:** The script only pulls from staging projects — never production. All local dev defaults use staging database, staging APIs, and localhost URLs.

> **Me app note:** If you don't have access to `f3-me-app-staging`, the script will skip generating `apps/me/.env.local` and print a warning. The other apps will still work fine.

If you need to customize a specific app's env (e.g., point one app at a different API), break the symlink by replacing `apps/<app>/.env.local` with a regular file.

<details>
<summary>Manual setup (if the script doesn't work)</summary>

Pull secrets manually and map them to env vars. The canonical mapping is:

| GCP Secret Name                   | `.env` Variable(s)                    | Notes                                                                     |
| --------------------------------- | ------------------------------------- | ------------------------------------------------------------------------- |
| `database-host`                   | `DATABASE_HOST`                       | Use `localhost` for local dev (proxy handles the connection)              |
| `database-user`                   | `DATABASE_USER`                       | Also used in `DATABASE_URL`                                               |
| `database-password`               | `DATABASE_PASSWORD`                   | Also used in `DATABASE_URL`                                               |
| `database-name`                   | `DATABASE_NAME`                       | Also used in `DATABASE_URL`                                               |
| `auth-secret`                     | `AUTH_SECRET`                         | Required in production; optional in dev                                   |
| `auth-jwt-private-key`            | `AUTH_JWT_PRIVATE_KEY`                | RSA PEM key; single-line with `\n` escapes, wrapped in double quotes      |
| `api-key`                         | `API_KEY`                             |                                                                           |
| `super-admin-api-key`             | `SUPER_ADMIN_API_KEY`                 |                                                                           |
| `sendgrid-api-key`                | `EMAIL_SERVER`                        | SMTP connection string (e.g. `smtp://apikey:<key>@smtp.sendgrid.net:587`) |
| `google-maps-api-key`             | `NEXT_PUBLIC_GOOGLE_API_KEY`          | Google Maps JS API key; required by map + api apps. Mirrored from Vercel. |
| _(set manually)_                  | `EMAIL_FROM`                          | Sender address (e.g. `noreply@f3nation.com`)                              |
| _(set manually)_                  | `EMAIL_ADMIN_DESTINATIONS`            | Comma-separated admin email addresses                                     |
| `google-logo-bucket-private-key`  | `GOOGLE_LOGO_BUCKET_PRIVATE_KEY`      | GCS service account private key                                           |
| `google-logo-bucket-client-email` | `GOOGLE_LOGO_BUCKET_CLIENT_EMAIL`     | GCS service account email                                                 |
| `google-logo-bucket-bucket-name`  | `GOOGLE_LOGO_BUCKET_BUCKET_NAME`      | GCS bucket name for logos                                                 |
| _(same as DATABASE_URL)_          | `TEST_DATABASE_URL`                   | Connection string for test database                                       |
| _(set manually)_                  | `NOTIFY_WEBHOOK_URLS_COMMA_SEPARATED` | Optional; comma-separated webhook URLs for notifications                  |

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

See `.env.example` at the repo root for a complete template with placeholder values.

**Me app secrets** (from `f3-me-app-staging`, written to `apps/me/.env.local`):

| GCP Secret Name (project: `f3-me-app-staging`) | `.env.local` Variable  | Local Dev Value                           |
| ---------------------------------------------- | ---------------------- | ----------------------------------------- |
| `oauth-client-secret`                          | `OAUTH_CLIENT_SECRET`  | Secret for the `f3-me-local` OAuth client |
| `session-secret`                               | `SESSION_SECRET`       | 64-char hex for signing session cookies   |
| `f3-api-key`                                   | `F3_API_KEY`           | API key for calling F3 Nation API         |
| `gcs-credentials`                              | `GCS_CREDENTIALS`      | Base64-encoded GCS service account JSON   |
| _(hardcoded)_                                  | `OAUTH_CLIENT_ID`      | `f3-me-local`                             |
| _(hardcoded)_                                  | `OAUTH_REDIRECT_URI`   | `http://localhost:3003/api/auth/callback` |
| _(hardcoded)_                                  | `AUTH_PROVIDER_URL`    | `http://localhost:3004`                   |
| _(hardcoded)_                                  | `F3_API_BASE_URL`      | `http://localhost:3001/v1`                |
| _(hardcoded)_                                  | `GCS_BUCKET`           | `f3-public-images-staging`                |
| _(hardcoded)_                                  | `NEXT_PUBLIC_SITE_URL` | `http://localhost:3003`                   |

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

`apps/auth` uses [Ethereal](https://ethereal.email/) instead of SendGrid when `NODE_ENV !== "production"`, and every send logs a public preview URL of the form `Preview email: https://ethereal.email/message/...`. The email contains the 6-digit MFA code and a magic link; headless automation pulls the code and POSTs it to NextAuth's `/api/auth/callback/credentials` with a CSRF token. **No real inbox is needed locally**, and the `/api/verify-email` rate limit is bypassed in non-production environments.

Cookbook: [`docs/QA_LOCAL_AUTH.md`](QA_LOCAL_AUTH.md). Helper: [`scripts/qa/extract-mfa-link.sh`](../scripts/qa/extract-mfa-link.sh). Agent reference: [`apps/auth/AGENTS.md`](../apps/auth/AGENTS.md).

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
