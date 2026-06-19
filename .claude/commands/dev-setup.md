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

## Step 3 — Check GCP Authentication

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

---

## Step 4 — Generate Environment

Check if `.env` exists at the repo root:

```bash
test -f .env && echo "EXISTS" || echo "MISSING"
```

**If missing or `reset` mode:** Run `pnpm env:generate` to pull staging secrets from GCP and create `.env` with symlinks.

**If exists:** Validate it has the required variables by cross-referencing with `packages/env/src/index.ts`. Report any missing vars.

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
  Node.js:           v24.17.0 ✓
  pnpm:              11.6.0 ✓
  gcloud:            512.0.0 ✓
  cloud-sql-proxy:   2.21.2 ✓

GCP Auth:
  Identity:          ✓ (user@example.com)
  App Default:       ✓

Environment:
  .env:              ✓ (generated 2026-04-09)
  Symlinks:          api ✓  map ✓  auth ✓

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
3. `.env` missing or incomplete → regenerate
4. Proxy not running → start it (or install daemon)
5. Port conflicts → identify and offer to kill conflicting processes
6. Stale symlinks → recreate

---

## Error Handling

| Condition            | Action                                                     |
| -------------------- | ---------------------------------------------------------- |
| No GCP access        | Print instructions to request access from team lead        |
| Proxy port conflict  | Identify process, offer to kill or suggest alternate port  |
| DB connection failed | Check proxy → check credentials → check DATABASE_URL       |
| App won't start      | Check port conflicts, missing env vars, pending migrations |
