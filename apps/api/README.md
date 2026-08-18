# F3 Nation API

The F3 Nation API server — an [oRPC](https://orpc.unnoq.com/) server exposing both a typed RPC surface and a REST/OpenAPI surface over the same [`packages/api`](../../packages/api) router.

**Live URL**: [api.f3nation.com](https://api.f3nation.com)

## What This Is

apps/api is a pure API service: every route handler returns a raw `Response`, there are no pages, no layouts, and no client-rendered UI. Two consumer surfaces are served from the same router:

- **RPC** (`/v1/*`) — typed procedure calls for first-party clients (the map app, F3 Me, internal tooling), matched by the `Client` header.
- **REST/OpenAPI** (`/v1/*`, spec at `/docs/openapi.json`) — plain HTTP for external/third-party clients and `curl`.

Interactive API docs (via [`@scalar/nextjs-api-reference`](https://github.com/scalar/scalar)) are served at [`/docs`](https://api.f3nation.com/docs); the root path (`/`) redirects there.

## Tech Stack

| Layer     | Choice                                    |
| --------- | ----------------------------------------- |
| Framework | Next.js (App Router, Route Handlers only) |
| RPC/REST  | oRPC (`@orpc/server`, `@orpc/openapi`)    |
| API Docs  | Scalar (`@scalar/nextjs-api-reference`)   |
| Database  | Drizzle ORM (via `@acme/db`)              |
| Hosting   | GCP Cloud Run (via GitHub Actions)        |

## Authentication

Every endpoint is protected except `/v1/ping`, `/v1/status`, `/docs`, and `/docs/openapi.json`. Protected endpoints accept any of:

- A session cookie, for browser clients already signed in via [`apps/auth`](../auth)
- A verified JWT bearer token, for first-party clients (the map app, F3 Me)
- A Bearer API key plus a `Client` header identifying the calling app, for third-party/external clients:

```bash
curl -X GET "https://api.f3nation.com/v1/org" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Client: my-app"
```

API keys inherit the roles and permissions of their owner (**Editor** or **Admin**). Generate and manage keys at `admin.f3nation.com/api-keys` if you're an admin on a region or the F3 Nation organization. See `/docs` for the full auth contract, error responses, and rate limits.

## Local Development

### Setup

```bash
# From the monorepo root
cd apps/api

# Copy and populate env file
cp .env.example .env
# Edit .env with actual values (get from team via Slack, or use local defaults for Docker dev)

# Install dependencies (from monorepo root)
cd ../..
pnpm install

# Run the dev server
pnpm dev --filter f3-api
# Or from apps/api:
cd apps/api
pnpm dev
```

Open [http://localhost:3001/docs](http://localhost:3001/docs) to browse the interactive API reference.

See [docs/LOCAL_DEV_DOCKER.md](../../docs/LOCAL_DEV_DOCKER.md) for the full local Docker setup (Postgres, GCS emulator, Mailpit).

## Testing

```bash
# Run all tests (coverage always collected)
pnpm test

# Run tests in watch mode (no coverage)
pnpm test:watch

# Run the characterization suite (Hono-migration parity gate)
pnpm test:characterization
```

The characterization suite in `characterization/` pins the current Next.js implementation's request/response behavior end-to-end (auth, rate limiting, error shapes) so it can be diffed against the in-progress Hono rewrite.

## Deployment

Deployed to GCP Cloud Run via tag-based deploys (tag `api@X.Y.Z` on `main` triggers `.github/workflows/deploy-api.yml`), same pattern as [`apps/me`](../me/README.md#deployment). Staging and production deploy the same Cloud Run service (`f3-api`) into separate GCP projects (`f3-api-app-staging`, `f3-api-app`).

## Related Documentation

- [Main Monorepo README](../../README.md) — overview of the entire monorepo structure
- [API Package AGENTS.md](../../packages/api/AGENTS.md) — router/procedure implementation
- [ADR 0001](../../docs/adr/0001-api-server-framework.md) — apps/api → Hono migration rationale (epic [#644](https://github.com/F3-Nation/f3-nation/issues/644))

## License

AGPL-3.0-or-later — see the repository [LICENSE](../../LICENSE).
