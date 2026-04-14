# @acme/runtime

Multi-tenant redirect runtime for the F3 redirect platform (R5).

This is the Cloud Run service that terminates tenant traffic after
DNS cutover. It replaces the per-region `apps/web` and `apps/stats`
services from the `f3-redirect` repo, which were each deployed once
per region with hard-coded `REGION_SLUG` / `REGION_ID` env vars.
Instead, this service:

1. Receives all traffic through the shared Load Balancer
2. Looks up the incoming `Host` header in an in-memory cache
   (refreshed from Neon every 60 seconds)
3. Issues a `307` redirect to either `https://regions.f3nation.com/<slug>`
   (apex) or `https://pax-vault.f3nation.com/stats/region/<id>`
   (the `stats.` subdomain)

## How it fits into R5

| Old (f3-redirect, per-region)                                              | New (f3-nation, multi-tenant)                                                      |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `apps/web` — one Cloud Run service per region, reads `REGION_SLUG` at boot | this runtime — one Cloud Run service, reads Host header per request                |
| `apps/stats` — same, but for `stats.` subdomain                            | same runtime — stats disambiguated by `stats.` prefix                              |
| `packages/redirects` — env-var URL builder                                 | `src/lib/redirect-resolver.ts` — pure function taking `(hostname, path, cacheGet)` |
| Region env at deploy time                                                  | Tenant rows in `region_custom_domains` resolved at request time                    |

The `f3-redirect` apps stay in their repo — they're still running for
the Muletown and Marshall legacy deployments. R5 Phase 2 is the
cutover that moves regions over to the new runtime.

See the full design in
[`f3-redirect/docs/plans/2026-04-14-multi-tenant-saas-refactor.md`](../../../f3-redirect/docs/plans/2026-04-14-multi-tenant-saas-refactor.md),
especially **Decision 3** (runtime + 60s cache) and **Decision 4** (the
SNI probe that drives `/health`).

## `/health` and the SNI probe (critical)

`GET /health` returns `200 OK` with header `x-redirect-platform: ok`
**regardless of the Host header**. This is not a bug. It is the
explicit contract with the reconciler's SNI probe (F3R5_010).

The probe dials the LB static IP directly with SNI and Host header
set to the tenant hostname. If the TLS handshake succeeds, the cert
is proven attached. The HTTP `GET /health` that follows is **liveness
only** — the identity question is already settled by TLS. So
`/health` deliberately does **not** consult the hostname cache,
doesn't import env validation, and doesn't touch the DB at all.

If you're debugging "why does `/health` return 200 for any Host
header?" — read R5 Decision 4. TL;DR: gating `/health` on Host
would break the probe, because the probe runs before the row reaches
`active` state (the only state the runtime caches).

`/health` is a static route segment, so Next.js App Router resolves
it before the `[[...catchall]]` handler — no special routing config
required.

## Local development

```bash
# From the monorepo root
pnpm install

# You'll need a Neon connection string for the redirect_runtime role.
# In local dev, point at a Neon dev branch or a local PgBouncer proxy.
export REDIRECT_PLATFORM_DATABASE_URL='postgres://redirect_runtime:...@localhost/platform?sslmode=disable'

# Optional — defaults to https://redirect.f3nation.com/not-provisioned
export RUNTIME_FALLBACK_REDIRECT_URL='http://localhost:3000/not-provisioned'

pnpm --filter @acme/runtime dev
# Runtime listens on http://localhost:3005
```

### Faking a tenant host

```bash
curl -H 'host: f3marshall.com' -i http://localhost:3005/
# HTTP/1.1 307 Temporary Redirect
# location: https://regions.f3nation.com/f3marshall
```

### Exercising `/health`

```bash
curl -H 'host: anything.you.want' -i http://localhost:3005/health
# HTTP/1.1 200 OK
# x-redirect-platform: ok
# ok
```

## Tests

```bash
pnpm --filter @acme/runtime test
```

Covers the pure `redirect-resolver` function and the cache refresh /
atomic-swap / fail-open behavior with an injected fake scheduler.
Tests intentionally do **not** stand up a Postgres client — the cache
accepts a fetcher function so tests can feed it fixture entries.

## Deploy

Deferred to F3R5_004 (shared-platform Terraform). The `Dockerfile`
here is the production build image; the Terraform module wires it to
a Cloud Run service with `min_instance_count: 1` (to avoid cold-start
cache-load latency on every probe) and mounts the Neon connection
string from Secret Manager secret `neon-redirect-runtime-url`.
