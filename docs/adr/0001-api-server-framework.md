# ADR 0001: Migrate `apps/api` off Next.js to Hono on Node

- **Status:** Accepted (implementation tracked in epic
  [#644](https://github.com/F3-Nation/f3-nation/issues/644))
- **Date:** 2026-07-09
- **Deciders:** F3 Nation maintainers

> This is the repository's first Architecture Decision Record. ADRs live in
> `docs/adr/` and record significant, hard-to-reverse technical decisions with
> their context and rejected alternatives. Feature behavior specs belong in
> `/specs`; decisions about _how the system is built_ belong here.

## Context

`apps/api` (`f3-api`, https://api.f3nation.com) is the organization's central
API server. It runs on Next.js 16 — not because the API needs Next.js, but
because the app skeleton was copied from `apps/map` when the service was
created. No decision record exists for that choice; this ADR is partly a
correction of that gap.

A July 2026 architectural assessment established the following.

### What the service actually is

A pure [oRPC](https://orpc.unnoq.com/) server. The entire Next.js surface is
three route files:

| File                                 | Role                                                                                                                                                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/[[...rest]]/route.ts`       | Optional catch-all. One `handleRequest(request: Request)` exported for all seven HTTP methods; dispatches on the `Client` header to oRPC's `RPCHandler` (`/v1`, fetch adapter) or `OpenAPIHandler`; CORS via oRPC's `CORSPlugin`; redirects `/` → `/docs`. |
| `src/app/docs/route.ts`              | Scalar API-reference UI.                                                                                                                                                                                                                                   |
| `src/app/docs/openapi.json/route.ts` | Runtime OpenAPI 3 generation from the router, with post-processing that injects the required `Client` header parameter.                                                                                                                                    |

All real routing, method dispatch, CORS, authentication, authorization, rate
limiting, and OpenAPI generation live in `packages/api` (oRPC procedures and
middleware). The route handlers use **zero** Next.js APIs — no
`NextRequest`/`NextResponse`, no `next/headers`, no ISR/revalidate, no edge
runtime. Tests already invoke the handlers with plain `new Request(...)`.
Next.js contributes only: `route.ts` file discovery, `output: "standalone"`
for the Docker image, `transpilePackages` for the monorepo, the
`instrumentation.ts` hook, and `@sentry/nextjs`.

### What Next.js costs here

**Build workarounds fighting the bundler:**

- `outputFileTracingIncludes` glob forcing `@img/sharp-libvips-*` into the
  standalone trace (Turbopack drops the dlopen'd libvips `.so`), guarded by a
  `find libvips-cpp*` assertion in the Dockerfile because the glob silently
  no-ops when it stops matching (see PR #556/#558 history).
- `serverExternalPackages: ["pino", "pino-pretty", "thread-stream"]` because
  Next tries to bundle worker-thread code.
- A pnpm `verifyDepsBeforeRun: false` injection in the Dockerfile to reconcile
  `turbo prune` catalog drift with `next build`.

**Dead map-app skeleton carried along:** inert next-auth edge middleware
(`proxy.ts` + `middleware/with-{admin,editor}.ts`, matching `/admin/*` routes
that do not exist), a React `global-error.tsx`, browser Sentry session replay
(`instrumentation-client.ts`), `images.remotePatterns`, a `/map` redirect, a
Sentry `tunnelRoute`, and a README describing the map app. The `next-auth`,
`react`, and `react-dom` dependencies exist almost entirely for this dead
code, and the test setup requires jsdom/React tooling for one dead component.

**Ongoing tax:** the Next.js major-upgrade treadmill on the org's most
load-bearing service, and — significant for an AI-agent-heavy contribution
model — an architecture that misleads readers into treating this as a web app.

### What actually couples the code to Next.js (verified)

1. **Cookie sessions are load-bearing.** `getSession()` in
   `packages/api/src/shared.ts` tries next-auth's no-arg `auth()` _first_.
   The session cookie domain is deliberately `.f3nation.com`
   (`packages/auth/src/config.ts`), and the map app's oRPC proxy forwards the
   browser's `cookie` header, so logged-in map editors authenticate to the API
   via next-auth cookies. The no-arg `auth()` depends on Next's
   AsyncLocalStorage and cannot run elsewhere.
2. **`revalidatePath` in `packages/api` is vestigial.** The two `next/cache`
   call sites (`lib/webhook-events.ts`, `router/map/index.ts`) only touch the
   API app's own (page-less) cache — their own comments say so. The real
   mechanism is `triggerMapAppRevalidation()`, an HTTP POST to the map app's
   `/api/revalidate`, which already exists and is already the load-bearing
   path. These are the only `next` imports in packages bundled into the API.
3. Straight swaps: `@t3-oss/env-nextjs` → `@t3-oss/env-core`,
   `@sentry/nextjs` → `@sentry/node`, `@scalar/nextjs-api-reference` → the
   framework-agnostic Scalar variant.
4. `sharp` is genuinely required (`packages/storage/src/resize.ts`), but the
   libvips hack is purely a Next-standalone-tracing artifact; a plain Node
   deployment with real production `node_modules` (or an esbuild bundle with
   `sharp` external) eliminates it.
5. `apps/map`'s in-process router usage (`src/orpc/client.server.ts`) is
   unaffected — it constructs the router inside the map's own Next process.

## Decision

Migrate `apps/api` to **Hono running on Node** (`@hono/node-server`), in
independently shippable phases (epic
[#644](https://github.com/F3-Nation/f3-nation/issues/644)):

- **Phase 0** — decouple shared packages while still on Next.js, zero behavior
  change: delete the vestigial `revalidatePath` calls
  ([#645](https://github.com/F3-Nation/f3-nation/issues/645)); replace the
  no-arg `auth()` with explicit header-based session resolution via
  `@auth/core`'s `Auth()` against the same shared `authConfig`
  ([#646](https://github.com/F3-Nation/f3-nation/issues/646) — the
  highest-risk change, deliberately first so it soaks in production);
  swap to `@t3-oss/env-core`
  ([#647](https://github.com/F3-Nation/f3-nation/issues/647)).
- **Phase 1** — delete the dead map-app skeleton; valuable even if the
  migration stops here
  ([#648](https://github.com/F3-Nation/f3-nation/issues/648)).
- **Phase 2** — Hono app + server entry. `handleRequest` and the OpenAPI
  generator move **verbatim** to framework-neutral modules; `/health` adopts
  the Health Contract (#634); `hono/compress` preserves the response
  compression Next standalone provides today (Cloud Run does not compress);
  CI gains an OpenAPI byte-diff parity gate
  ([#649](https://github.com/F3-Nation/f3-nation/issues/649)).
- **Phase 3+4** — esbuild bundle (sharp/pino external), Dockerfile shed of all
  three Next-era hacks (replaced by functional smoke checks), unchanged Cloud
  Run service/workflows, prod cutover via `--no-traffic` revision + traffic
  splitting with instant rollback to the Next revision, then the final
  deletion of every Next/React dependency
  ([#650](https://github.com/F3-Nation/f3-nation/issues/650)).

## Alternatives considered

- **Stay on Next.js and clean house.** Fixes the dead code but keeps every
  build hack and the upgrade treadmill permanently, and leaves the
  architecture misleading. Rejected — though its cleanup half survives as
  Phases 0–1, which are pure wins regardless.
- **Plain `node:http` + `@orpc/server/node`** (the option hinted at by the
  comment in `route.ts:1`). Close second. Rejected because "no framework"
  means ~100–150 lines of bespoke bootstrap (routing for `/docs`, `/health`,
  static assets, compression, graceful shutdown) — exactly the kind of
  undocumented custom code that rots in an all-volunteer org and that AI
  agents mishandle. Hono replaces it with ~30 lines of conventional,
  zero-dependency, well-documented, fetch-native code, and the existing
  handlers mount verbatim: `app.all("*", (c) => handleRequest(c.req.raw))`.
- **Express or Fastify.** The conventional choice, but their req/res model
  mismatches the existing fetch handlers, and oRPC already owns routing — a
  heavier rewrite for no benefit. Rejected.

## Consequences

**Positive:** the three build hacks disappear; `next`, `react`, `react-dom`,
`next-auth`, and the React test toolchain leave the API's dependency tree;
builds get faster and the image smaller; the codebase says what it is; the
session-resolution work (#646) is a stepping stone for the auth-provider
efforts (#576, #598).

**Negative / accepted risks:**

- Hono is a new (if tiny) framework in a Next-only TypeScript team.
- Cookie-session parity is the top migration risk; mitigated by reusing the
  exact shared `authConfig` through `@auth/core`, an optional dual-path
  log-compare release, and a staging end-to-end gate before any framework
  change ships.
- Response compression and graceful shutdown become our explicit
  responsibility (`hono/compress`, SIGTERM handling) instead of Next
  defaults; both are called out as acceptance criteria in #649.
- Sentry span shapes change (`@sentry/node` vs Next instrumentation);
  verified on staging before cutover.
- Known carry-overs move verbatim and are _not_ addressed by the migration:
  reflective CORS (#361), per-instance rate limiter (#359), Sentry config
  hardening (#355).

**Rollback:** at every stage before Phase 4, the previous Next.js revision
remains deployed on the same Cloud Run service; rollback is an instant
traffic shift. Phase 0 changes are framework-neutral and stand on their own.
