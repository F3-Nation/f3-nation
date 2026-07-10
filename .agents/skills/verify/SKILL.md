---
name: verify
description: Drive a changed API endpoint or app flow end-to-end in this monorepo — build/launch recipe, auth bypass in dev, and local DB seeding for evidence capture
---

# Verifying changes at runtime (f3-nation monorepo)

## Local database

- Tests and local dev both use the **`f3-postgres` Docker container on :5433** (user `f3local`; DBs `f3nation` for dev servers, `f3nation_test` for vitest). Do NOT start the Cloud SQL proxy (`pnpm db:proxy`) for this — it fights over :5433.
- Seed/inspect/clean directly: `docker exec f3-postgres psql -U f3local -d f3nation -c "..."`. Column names are snake_case (`f3_name`), not the Drizzle camelCase.

## Driving the oRPC API (packages/api changes)

- Launch: `pnpm --filter f3-api dev` (Next.js on :3001). Wait for `curl http://localhost:3001/v1/ping` → 200.
- Routers mount at `/v1/<prefix>/<route>` — check `packages/api/src/index.ts` for the prefix (e.g. me router → `/v1/me/users`). Hitting `/v1/<route>` without the prefix 404s.
- **Auth bypass in dev:** with no `Authorization` header, `getSession` returns a mock admin session (`packages/api/src/shared.ts`), so plain `curl` exercises `protectedProcedure`/`adminProcedure` endpoints directly.
- Validation failures return HTTP 400 with `{"code":"BAD_REQUEST","data":{"issues":[...]}}` — assert on the `issues` messages.

## Other app dev servers

`pnpm --filter <pkg> dev`: map=:3000, api=:3001, me=:3003 (`f3-me`), auth=:3004. App package names differ from dir names — check each `package.json`.

## Gotchas

- `pnpm` isn't on PATH in non-interactive shells: `export PATH="$HOME/.nvm/versions/node/$(node --version)/bin:$PATH"` first.
- Clean up seeded rows after (`DELETE ... WHERE email LIKE '<marker>-%@example.com'`) — the dev DB is shared with the user's local sessions.
