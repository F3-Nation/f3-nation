# Local Development Setup

Step-by-step guide for new contributors to get the F3 Nation monorepo running locally.

## Prerequisites

| Tool                   | Install                                                      | Verify                      |
| ---------------------- | ------------------------------------------------------------ | --------------------------- |
| Node.js (see `.nvmrc`) | `nvm install`                                                | `node -v`                   |
| pnpm v10+              | `corepack enable && corepack prepare pnpm@latest --activate` | `pnpm -v`                   |
| Google Cloud CLI       | `brew install google-cloud-sdk`                              | `gcloud -v`                 |
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

Secrets live in GCP Secret Manager, not in the repo. Pull them into a local `.env`:

```bash
# One-liner: fetch all staging secrets and write .env
# (requires jq: brew install jq)

PROJECT="f3-authentication-staging"
SECRETS=$(gcloud secrets list --project="$PROJECT" --format="value(name)")

for secret in $SECRETS; do
  VALUE=$(gcloud secrets versions access latest --secret="$secret" --project="$PROJECT" 2>/dev/null)
  echo "$secret=$VALUE"
done
```

Then map those secret names to the env vars the app expects. The canonical mapping is:

| GCP Secret Name        | `.env` Variable(s)                            | Notes                                                                |
| ---------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| `database-host`        | `DATABASE_HOST`                               | Use `localhost` for local dev (proxy handles the connection)         |
| `database-user`        | `DATABASE_USER`                               | Also used in `DATABASE_URL`                                          |
| `database-password`    | `DATABASE_PASSWORD`                           | Also used in `DATABASE_URL`                                          |
| `database-name`        | `DATABASE_NAME`                               | Also used in `DATABASE_URL`                                          |
| `auth-secret`          | `AUTH_SECRET`, `NEXTAUTH_SECRET`              | Same value for both                                                  |
| `auth-jwt-private-key` | `AUTH_JWT_PRIVATE_KEY`                        | RSA PEM key; single-line with `\n` escapes, wrapped in double quotes |
| `api-key`              | `API_KEY`                                     |                                                                      |
| `sendgrid-api-key`     | `SENDGRID_API_KEY`, `TWILIO_SENDGRID_API_KEY` | Same value for both                                                  |

Construct `DATABASE_URL` from the individual fields:

```
DATABASE_URL=postgresql://<DATABASE_USER>:<DATABASE_PASSWORD>@localhost:5432/<DATABASE_NAME>
```

The remaining env vars are local defaults (URLs, ports, etc.) — see `.env.example` or ask a team member for a working `.env`.

## 4. Start the Cloud SQL Auth Proxy

The staging database is a Cloud SQL instance. Locally, you connect through the proxy which authenticates via your `gcloud` credentials and exposes the DB on `localhost:5432`.

```bash
cloud-sql-proxy f3data:us-central1:f3data-nonprod --port 5432
```

> **Tip:** Run this in a dedicated terminal tab — it needs to stay running while you develop.

### How it works in each environment

| Environment                  | Connection method                                       | DATABASE_HOST                                 |
| ---------------------------- | ------------------------------------------------------- | --------------------------------------------- |
| **Local dev**                | Cloud SQL Auth Proxy on localhost:5432                  | `localhost`                                   |
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

This starts all three apps in parallel via Turborepo:

| App  | URL                   | Port |
| ---- | --------------------- | ---- |
| Map  | http://localhost:3000 | 3000 |
| API  | http://localhost:3001 | 3001 |
| Auth | http://localhost:3004 | 3004 |

## Troubleshooting

### `relation "auth.email_mfa_codes" does not exist`

Run `pnpm db:migrate` — you have pending migrations.

### `connection refused` on port 5432

The Cloud SQL Auth Proxy isn't running. Start it:

```bash
cloud-sql-proxy f3data:us-central1:f3data-nonprod --port 5432
```

### `permission denied` accessing GCP secrets

Ask a team lead to grant your Google account the `Secret Manager Secret Accessor` role on the `f3-authentication-staging` project.

### Port already in use

Another process is using the port. Find and kill it:

```bash
lsof -ti:5432 | xargs kill   # for the proxy
lsof -ti:3000 | xargs kill   # for the map app
```
