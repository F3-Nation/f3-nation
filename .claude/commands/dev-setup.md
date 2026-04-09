# Local Dev Setup

Interactive local development environment setup and diagnostics. Reads the canonical setup guide at `docs/LOCAL_DEV_SETUP.md` and walks through each step, verifying prerequisites, fixing issues, and getting the full stack running.

---

## Input

$ARGUMENTS

**Modes:**

- No arguments — full interactive setup (check prerequisites → generate env → start proxy → verify DB → start dev servers)
- `status` — check the health of all components (proxy, env, DB connection, app ports)
- `fix` — diagnose and auto-fix common issues (missing deps, stale env, proxy down, port conflicts)
- `reset` — regenerate `.env` from GCP and restart services

---

## Step 1 — Read the Guide

Read `docs/LOCAL_DEV_SETUP.md` for the canonical steps. This skill automates that guide.

---

## Step 2 — Check Prerequisites

Verify each prerequisite is installed:

```bash
node -v          # Node.js
pnpm -v          # pnpm
gcloud version   # Google Cloud CLI
cloud-sql-proxy --version  # Cloud SQL Auth Proxy
```

For any missing tool, auto-install it:

- **Node.js**: `nvm install` (uses `.nvmrc`)
- **pnpm**: `corepack enable && corepack prepare pnpm@latest --activate`
- **gcloud**: `brew install google-cloud-sdk` (macOS) or SDK installer (Linux)
- **cloud-sql-proxy**: `brew install cloud-sql-proxy` (macOS) or direct binary (Linux)

After install, re-verify. If still missing, print the manual install instruction and stop.

---

## Step 3 — Check GCP Authentication and Project Context

```bash
gcloud auth print-identity-token 2>/dev/null
gcloud auth application-default print-access-token 2>/dev/null
```

If either fails, prompt the user:

```
GCP authentication needed. Run these commands in your terminal:
  gcloud auth login
  gcloud auth application-default login
```

Wait for the user to confirm, then re-check.

**Quota project check:**

The ADC quota project must be set correctly for the Cloud SQL proxy and secret access to work. This is critical when switching between workspaces (e.g., f3-nation vs joinfold).

```bash
QUOTA_PROJECT=$(cat ~/.config/gcloud/application_default_credentials.json 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.quota_project_id||'')" 2>/dev/null)
```

If `QUOTA_PROJECT` is not `f3-authentication-staging`, fix it:

```bash
gcloud auth application-default set-quota-project f3-authentication-staging
```

After changing the quota project, restart the Cloud SQL proxy (kill existing process; launchd or systemd will restart it automatically):

```bash
kill $(lsof -ti :5433) 2>/dev/null
# Wait for launchd/systemd to restart it
sleep 2
lsof -i :5433  # verify new process is listening
```

**GCP project access verification:**

The monorepo uses two GCP projects for secrets:

| Project                     | Apps           | Secrets                                                           |
| --------------------------- | -------------- | ----------------------------------------------------------------- |
| `f3-authentication-staging` | api, map, auth | DB creds, API keys, auth JWT, GCS logo bucket, SendGrid           |
| `f3-me-app-staging`         | me             | OAuth client secret, session secret, F3 API key, GCS avatar creds |

Verify access to both:

```bash
gcloud secrets list --project=f3-authentication-staging --limit=1 2>/dev/null
gcloud secrets list --project=f3-me-app-staging --limit=1 2>/dev/null
```

If the second fails, warn: "No access to f3-me-app-staging secrets. The me app .env.local won't be auto-generated. Ask a project owner (tackle@f3nation.com) for Secret Manager Secret Accessor role."

---

## Step 4 — Generate Environment

Check if `.env` and me app env exist:

```bash
test -f .env && echo ".env EXISTS" || echo ".env MISSING"
test -f apps/me/.env.local && echo "me .env.local EXISTS" || echo "me .env.local MISSING"
```

**If either is missing or `reset` mode:** Run `pnpm env:generate` to pull staging secrets from GCP. This will:

- Create root `.env` from `f3-authentication-staging` secrets (shared by api, map, auth via symlinks)
- Create `apps/me/.env.local` from `f3-me-app-staging` secrets (me app has its own OAuth client, session, and GCS config)

**If both exist:** Validate required variables. The root `.env` should have: `DATABASE_URL`, `API_KEY`, `AUTH_SECRET`, `AUTH_JWT_PRIVATE_KEY`. The me `.env.local` should have: `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `SESSION_SECRET`, `F3_API_KEY`, `F3_API_BASE_URL`.

---

## Step 5 — Cloud SQL Proxy

Check proxy status:

```bash
pnpm db:proxy:status
```

**If not running:** Offer two options:

1. `pnpm db:proxy:install` — background daemon (recommended, auto-starts on login)
2. `pnpm db:proxy` — foreground in a terminal tab

If the user hasn't installed the daemon yet, recommend it.

**Verify DB connectivity:**

```bash
pnpm db:studio
```

Or test with a simple query if drizzle-kit is available. If the connection fails, check:

- Is the proxy running? (`lsof -i :5433`)
- Are GCP credentials valid?
- Is the DATABASE_URL correct in `.env`?

---

## Step 6 — Database Migrations

```bash
pnpm db:migrate
```

If migrations fail, diagnose:

- Missing proxy → point to Step 5
- Schema conflicts → suggest `pnpm db:generate` or `pnpm db:reset`

---

## Step 7 — Start Dev Servers

```bash
pnpm dev
```

After startup, verify each app is responding:

| App  | URL                   | Health check                                                           |
| ---- | --------------------- | ---------------------------------------------------------------------- |
| Map  | http://localhost:3000 | `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`         |
| API  | http://localhost:3001 | `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/v1/ping` |
| Me   | http://localhost:3003 | `curl -s -o /dev/null -w "%{http_code}" http://localhost:3003`         |
| Auth | http://localhost:3004 | `curl -s -o /dev/null -w "%{http_code}" http://localhost:3004`         |

Report which apps are up and which aren't.

---

## Status Mode

When called with `status`, check everything without modifying anything:

```
--- DEV ENVIRONMENT STATUS ---
Prerequisites:
  Node.js:           v24.14.1 ✓
  pnpm:              10.33.0 ✓
  gcloud:            512.0.0 ✓
  cloud-sql-proxy:   2.21.2 ✓

GCP Auth:
  Identity:          ✓ (user@example.com)
  App Default:       ✓
  ADC Quota Project: f3-authentication-staging ✓

GCP Projects:
  f3-authentication-staging:  ✓ (secrets accessible)
  f3-me-app-staging:          ✓ (secrets accessible)

Environment:
  .env:              ✓ (generated 2026-04-09)
  Symlinks:          api ✓  map ✓  auth ✓
  me .env.local:     ✓ (generated 2026-04-09, from f3-me-app-staging)

Database:
  Proxy:             ✓ running on :5433 (background daemon)
  Connection:        ✓ connected to f3data-nonprod

Apps:
  API  (3001):       ✓ responding
  Map  (3000):       ✓ responding
  Me   (3003):       ✗ not running
  Auth (3004):       ✓ responding
--- END STATUS ---
```

---

## Fix Mode

When called with `fix`, diagnose and auto-fix issues:

1. Missing prerequisites → install them
2. GCP auth expired → prompt re-auth
3. ADC quota project wrong → `gcloud auth application-default set-quota-project f3-authentication-staging` + restart proxy
4. `.env` missing or incomplete → regenerate via `pnpm env:generate`
5. `apps/me/.env.local` missing → regenerate (requires `f3-me-app-staging` access)
6. Proxy not running → start it (or install daemon)
7. Port conflicts → identify and offer to kill conflicting processes
8. Stale symlinks → recreate

---

## Error Handling

| Condition                   | Action                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| No GCP access               | Print instructions to request access from team lead                                                 |
| Wrong ADC quota project     | Run `gcloud auth application-default set-quota-project f3-authentication-staging` and restart proxy |
| Proxy port conflict         | Identify process, offer to kill or suggest alternate port                                           |
| DB connection reset         | Likely wrong ADC quota project — fix and restart proxy                                              |
| DB connection failed        | Check proxy → check credentials → check DATABASE_URL                                                |
| No f3-me-app-staging access | Warn, skip me .env.local generation, suggest requesting access from tackle@f3nation.com             |
| App won't start             | Check port conflicts, missing env vars, pending migrations                                          |
