---
name: verify
description: Drive a changed API endpoint or app flow end-to-end in this monorepo — build/launch recipe, dev auth (mock session, seeded API keys), and local DB seeding for evidence capture
---

# Verifying changes at runtime (f3-nation monorepo)

## Local database

- Tests and local dev both use the **`f3-postgres` Docker container on :5433** (a slotted checkout's is `f3-wtN-postgres` on `F3_POSTGRES_PORT`; run the `docker compose` commands from the repo root and they pick the right one) (user `f3local`; DBs `f3nation` for dev servers, `f3nation_test` for vitest).
- Seed/inspect/clean directly: `docker compose exec postgres psql -U f3local -d f3nation -c "..."`. Column names are snake_case (`f3_name`), not the Drizzle camelCase.

## Driving the oRPC API (packages/api changes)

- Launch: `pnpm --filter f3-api dev` (on :3001). Wait for `curl http://localhost:3001/v1/ping` → 200.
- Routers mount at `/v1/<prefix>/<route>` — check `packages/api/src/index.ts` for the prefix (e.g. me router → `/v1/me/users`). Hitting `/v1/<route>` without the prefix 404s.
- **Auth in dev:** with no bearer token, `protectedProcedure` falls back to a dev mock session (`packages/api/src/shared.ts`), which needs `NEXT_PUBLIC_CHANNEL=local` in `apps/api/.env` (as `.env.example` sets it; the `dev` script sets only `ALLOW_DEV_MOCK_SESSION`), so plain `curl` reaches routes that only need a signed-in caller. The mock session has no roles and is not a person, so any route that checks a role or acts on the caller's own account rejects it with 401; the [procedure tiers](../../../docs/AI_DEVELOPMENT_GUIDE.md#api-authorization) and their definitions in `shared.ts` say which credential each route accepts. For a role check, seed an API key with that role and send it as `authorization: Bearer <key>` with a non-empty `client` header; [`pr-local-test/reference.md` § `apps/api` directly](../pr-local-test/reference.md#appsapi-directly) has the SQL to adapt. A route that rejects API keys needs a real user session or Auth access token: sign in with the recipe in [`apps/auth/AGENTS.md`](../../../apps/auth/AGENTS.md).
- Validation failures return HTTP 400 with `{"code":"BAD_REQUEST","data":{"issues":[...]}}` — assert on the `issues` messages.

## Other app dev servers

`pnpm --filter <pkg> dev`: map=:3000, api=:3001, me=:3003 (`f3-me`), auth=:3004. App package names differ from dir names — check each `package.json`.

## Gotchas

- `pnpm` isn't on PATH in non-interactive shells: `export PATH="$HOME/.nvm/versions/node/$(node --version)/bin:$PATH"` first.
- Clean up seeded rows after (`DELETE ... WHERE email LIKE '<marker>-%@example.com'`) — the dev DB is shared with the user's local sessions.
