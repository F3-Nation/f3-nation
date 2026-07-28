# apps/api Characterization Suite Implementation Plan (Issue #660)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a behavior-pinning test suite for `apps/api` on `main` that exercises the real auth-resolution and HTTP wire layers end-to-end, so every later phase of the Hono migration epic (#644) can be proven behavior-identical against frozen golden files.

**Architecture:** A new `apps/api/characterization/` suite runs under its own Vitest config against a **transport seam** — `type Invoke = (req: Request) => Promise<Response>` — selected by the `CHAR_TEST_TARGET` env var (`next` today, `hono` after #649, `live` for #650's staging gate). The `next` target calls the real Next route handlers in-process with `next/headers` replaced by an AsyncLocalStorage-backed shim, so the genuine `@auth/core` cookie decode, the JWKS JWT path, the DB API-key lookup, and the oRPC handler dispatch all execute unmocked. Responses are normalized to `{ status, selected headers, scrubbed body }` and committed as one golden file per case.

**Tech Stack:** Vitest 4, oRPC 1.14 (`RPCHandler` / `OpenAPIHandler` / `RPCLink`), next-auth 5.0.0-beta.31 + `@auth/core` 0.41.2, `jose` (RS256 keypair + JWKS), Drizzle + Postgres 18 (`TEST_DATABASE_URL`), Turborepo.

## Global Constraints

- Node >= 24.18 (`.nvmrc`), pnpm 11. `pnpm` may not be on `PATH`: prepend `~/.nvm/versions/node/$(node --version)/bin`.
- **This suite characterizes, it does not correct.** Pin what the code _does_, even where that contradicts the docs (e.g. role guards return `401 UNAUTHORIZED` where the OpenAPI description says `403 Forbidden`). Never "fix" production behavior in these PRs.
- **Goldens are frozen for Phases 0a–4.** Any golden diff in #645–#650 is a migration bug or an explicit, called-out sign-off in that PR.
- Never touch `apps/api/vitest.config.ts` coverage `thresholds` beyond adding the `exclude` entry in Task 3. `autoUpdate` stays `true`. Enforced by `scripts/check-vitest-thresholds.mjs` in `pnpm lint`.
- Existing `packages/api` tests must stay byte-identical in behavior: the helper extraction in Task 1 is **re-export-compatible only**.
- Commits follow Conventional Commits with a **required scope** from `commitlint.config.mjs`. Use `test(api):`, `chore(api):`, `ci(ci):`, `docs(repo):`. PR titles must match the same format.
- Never log or commit secrets. The RS256 keypair is generated per run and never written to disk.
- Two-space indent, kebab-case filenames, explicit TypeScript types. Run `pnpm lint` and `pnpm format:fix` before every commit; never `--no-verify`.

---

## Verified Facts (from a working spike — do not re-derive)

A throwaway spike drove real session cookies through the real route handler and passed 7/7. These findings **override** the corresponding statements in issue #660, which were written from source reading rather than execution.

1. **`vi.mock("next/headers")` does NOT work.** next-auth is an externalized dependency; the mock registry never intercepts its `next/headers` import and the real Next `headers()` throws ``headers` was called outside a request scope``. The working mechanism is a **`resolve.alias`** plus `server.deps.inline: ["next-auth", "@auth/core"]` so Vite actually transforms next-auth and the alias applies.
2. **`next/server` must also be aliased** to `next/server.js`. `next-auth/lib/env.js` imports `next/server` at module load and Vite cannot resolve Next's bare `next/server` specifier (`Did you mean to import "next/server.js"?`). Aliasing to the real file keeps genuine `NextResponse` — strictly more faithful than `packages/api`'s `vi.mock("next/server")`.
3. **The seam must synthesize a `host` header.** A hand-built `new Request(url)` carries no `host`. `@auth/core`'s `createActionURL` falls back to `x-forwarded-host ?? host` when `AUTH_URL`/`NEXTAUTH_URL` are unset, and throws inside `new URL()` without one.
4. **`encode()` always clobbers `exp`.** `@auth/core/jwt`'s `encode` unconditionally calls `.setExpirationTime(now() + maxAge)`. An expired-cookie fixture must pass a negative `maxAge`, **not** an `exp` claim in the token payload.
5. **The cookie path needs no database.** `packages/auth/src/config.ts` uses `session: { strategy: "jwt" }` and a **pure** `session` callback that reads roles straight off the token. Cookie cases — including role-gated ones — run with Postgres down. Only API-key and JWT cases need the test DB.
6. **`/docs` and `/docs/openapi.json` are separate Next route files**, not served by `[[...rest]]/route.ts`. Issue #660's "import `GET` from `route.ts`" is insufficient: the `next` target must be a small 3-way path router, or the `/docs` public-access case and the OpenAPI golden are unreachable.
7. Cookie name / `encode` salt is `authjs.session-token` — `COOKIE_NAME` from `@acme/shared/common/constants` with an empty prefix outside prod. The cookie is **encrypted** (JWE), so any byte change is a valid tamper fixture.
8. `route.ts` exports `HEAD/GET/POST/PUT/PATCH/DELETE/OPTIONS`, all bound to the same `handleRequest`. Any one export is a complete seam.
9. **`next.config.js` declares a `/map` → `/` permanent redirect.** This is Next-level config invisible to the in-process seam. It is a real migration risk for #649/#650 that only the `live` target can catch — record it, do not try to test it in-process.
10. `encode` is reachable as `import { encode } from "next-auth/jwt"` (a re-export of `@auth/core/jwt`), so no new dependency is needed for cookie fixtures.

**Delivery decisions made with the maintainer:**

- Ship as **four stacked PRs** (Phases A–D below); #646 unblocks as soon as Phase B lands.
- Build the **three-way `CHAR_TEST_TARGET` union and the `runIf` gating now**, but only exercise `next` in CI. #650 flips `live` on with no test rewrites.

---

## File Structure

```
apps/api/
  characterization/
    transport.ts               # CHAR_TEST_TARGET seam -> Invoke
    targets/next.ts            # in-process Next route dispatch (3-way path router)
    targets/live.ts            # real fetch against CHAR_TEST_BASE_URL
    next-headers-shim.ts       # alias target for `next/headers`
    header-store.ts            # AsyncLocalStorage backing the shim
    global-setup.ts            # RS256 keypair + JWKS http server + env pinning
    fixtures/api-keys.ts       # real apiKeys + rolesXApiKeysXOrg rows
    fixtures/cookies.ts        # @auth/core encode() session cookies
    fixtures/jwt.ts            # sign RS256 tokens against the run's keypair
    fixtures/users.ts          # seeded user/org/role rows for auth subjects
    normalize.ts               # Response -> golden shape, path-rule scrubbing
    rpc-client.ts              # oRPC RPCLink bound to the seam
    auth/api-key.char.test.ts
    auth/client-header.char.test.ts
    auth/cookie.char.test.ts
    auth/jwt.char.test.ts
    auth/jwks-unreachable.char.test.ts   # own file: dead-port JWKS before import
    auth/dev-mock.char.test.ts           # own file: isDevelopment mocked true
    auth/role-guards.char.test.ts
    auth/rate-limit.char.test.ts
    auth/super-admin.char.test.ts
    wire/dispatch.char.test.ts
    wire/cors.char.test.ts
    wire/errors.char.test.ts
    wire/openapi-spec.char.test.ts
    wire/serialization.char.test.ts
    __snapshots__/                       # committed golden files
  vitest.characterization.config.ts
  vitest.config.ts                       # MODIFIED: exclude characterization/
  package.json                           # MODIFIED: test:characterization script + devDeps

packages/api/
  src/testing/index.ts                   # extracted vitest-free helpers
  src/__tests__/test-utils.ts            # MODIFIED: re-exports from ../testing
  package.json                           # MODIFIED: "./testing" export

apps/auth/
  src/lib/jwt.test.ts                    # NEW (Phase D)

turbo.json                               # MODIFIED: test:characterization task
.github/workflows/ci.yml                 # MODIFIED: step in test-coverage job
docs/testing.md                          # MODIFIED: new section
```

**Naming:** every test file ends in `.char.test.ts`. The default `apps/api` suite globs `**/*.test.ts` under jsdom and would otherwise pick these up and break; Task 3 excludes the directory _and_ the suffix gives a second layer of protection.

---

# Phase A — Seam, shims, and fixtures

**PR title:** `test(api): characterization transport seam and fixtures (#660)`

Deliverable: the suite infrastructure plus a handful of smoke tests proving the seam works on all three shim mechanisms. No matrices yet.

---

### Task 1: Extract vitest-free helpers into `@acme/api/testing`

**Files:**

- Create: `packages/api/src/testing/index.ts`
- Modify: `packages/api/src/__tests__/test-utils.ts`
- Modify: `packages/api/package.json`

**Interfaces:**

- Produces: `uniqueId(): string`, `getOrCreateRoles(): Promise<void>`, `getOrCreateF3NationOrg(): Promise<{ id: number; name: string }>`, `createAdminSession(): Promise<Session>`, `createEditorSession(p): Session`, `createUserSession(p): Session`, `createNoPermissionSession(): Session`, `cleanup.{user,event,eventType,location,org,apiKey,updateRequest}`, and `db`. All importable as `@acme/api/testing`.
- Stays behind in `test-utils.ts`: `createTestClient` and `mockAuthWithSession` — both import `vitest`, which must not leak into a non-vitest consumer.

- [ ] **Step 1: Move the vitest-free helpers**

Create `packages/api/src/testing/index.ts` containing, verbatim from `test-utils.ts`, everything **except** `createTestClient` and `mockAuthWithSession`. Its import block drops `createRouterClient`, `vi`, `Client`, and `Header`:

```typescript
/**
 * Framework-agnostic test fixtures for @acme/api.
 *
 * Deliberately free of any `vitest` import so non-vitest consumers (and the
 * apps/api characterization suite, which runs under a different config) can
 * reuse them. Vitest-coupled helpers stay in src/__tests__/test-utils.ts.
 */

import type { Session } from "@acme/auth";
import { eq, schema } from "@acme/db";
import { db } from "@acme/db/client";

export const uniqueId = () =>
  `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ... getOrCreateRoles, getOrCreateF3NationOrg, createAdminSession,
// createEditorSession, createUserSession, createNoPermissionSession,
// cleanup — all copied unchanged from test-utils.ts ...

export { db };
```

- [ ] **Step 2: Turn `test-utils.ts` into a re-export shim**

Replace the moved bodies in `packages/api/src/__tests__/test-utils.ts` with a re-export, keeping the two vitest-coupled helpers:

```typescript
import type { Session } from "@acme/auth";
import { createRouterClient } from "@orpc/server";
import { vi } from "vitest";

import { Client, Header } from "@acme/shared/common/enums";
import { router } from "../index";

// Re-exported so the 20 existing test files need zero changes.
export * from "../testing";

export const createTestClient = () => {
  return createRouterClient(router, {
    context: () => ({
      reqHeaders: new Headers({
        [Header.Client]: Client.ORPC,
      }),
    }),
  });
};

export const mockAuthWithSession = async (session: Session | null) => {
  const { auth } = await import("@acme/auth");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  vi.mocked(auth as any).mockResolvedValue(session);
};
```

- [ ] **Step 3: Add the subpath export**

In `packages/api/package.json`, extend `exports`:

```json
  "exports": {
    ".": "./src/index.ts",
    "./testing": "./src/testing/index.ts",
    "./services/map-request-notification": "./src/services/map-request-notification.ts"
  },
```

- [ ] **Step 4: Prove the extraction changed nothing**

Start Postgres first — `pnpm docker:up` — then:

```bash
pnpm -C packages/api test
```

Expected: the same pass count as on `main` before this task, zero failures. If any test fails, a helper body was altered during the move; diff it against `git show main:packages/api/src/__tests__/test-utils.ts`.

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm typecheck --filter @acme/api && pnpm lint --filter @acme/api
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/testing/index.ts packages/api/src/__tests__/test-utils.ts packages/api/package.json
git commit -m "refactor(api): extract vitest-free test helpers into @acme/api/testing"
```

---

### Task 2: `next/headers` shim and header store

**Files:**

- Create: `apps/api/characterization/header-store.ts`
- Create: `apps/api/characterization/next-headers-shim.ts`

**Interfaces:**

- Produces: `headerStore: AsyncLocalStorage<Headers>`, `withRequestHeaders<T>(headers: Headers, fn: () => T): T`. The shim module exports `headers()`, `cookies()`, `draftMode()` to satisfy anything that imports them.

- [ ] **Step 1: Create the header store**

```typescript
// apps/api/characterization/header-store.ts
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped header store backing the `next/headers` alias shim. Lives in
 * its own module so both the shim and the transport target can reach it
 * without a circular import.
 */
export const headerStore = new AsyncLocalStorage<Headers>();

/** Run `fn` with `headers()` resolving to the given request's headers. */
export function withRequestHeaders<T>(headers: Headers, fn: () => T): T {
  return headerStore.run(headers, fn);
}
```

- [ ] **Step 2: Create the shim**

```typescript
// apps/api/characterization/next-headers-shim.ts
import { headerStore } from "./header-store";

/**
 * Stand-in for `next/headers`, wired in via `resolve.alias` in
 * vitest.characterization.config.ts. next-auth's no-arg `auth()` is
 * `await headers()` -> a plain Request carrying the cookie -> @auth/core
 * `Auth()`, so replacing this one module leaves the real decode path,
 * cookie names, and session callback executing unmocked.
 */
export function headers(): Promise<Headers> {
  return Promise.resolve(headerStore.getStore() ?? new Headers());
}

export function cookies(): never {
  throw new Error("next/headers cookies() is not shimmed");
}

export function draftMode(): never {
  throw new Error("next/headers draftMode() is not shimmed");
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/characterization/header-store.ts apps/api/characterization/next-headers-shim.ts
git commit -m "test(api): add next/headers shim for the characterization suite"
```

---

### Task 3: Vitest config, turbo task, and package script

**Files:**

- Create: `apps/api/vitest.characterization.config.ts`
- Modify: `apps/api/vitest.config.ts`
- Modify: `apps/api/package.json`
- Modify: `turbo.json`

**Interfaces:**

- Consumes: `characterization/next-headers-shim.ts` (Task 2), `characterization/global-setup.ts` (Task 4 — the config references it, so Task 4 must land in the same commit or the suite will not start).
- Produces: `pnpm -C apps/api test:characterization`, turbo task `test:characterization`.

- [ ] **Step 1: Write the characterization Vitest config**

The three mechanisms below are all load-bearing and were each proven necessary by the spike — do not simplify them away.

```typescript
// apps/api/vitest.characterization.config.ts
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const nextHeadersShim = fileURLToPath(
  new URL("./characterization/next-headers-shim.ts", import.meta.url),
);

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: [
      // `vi.mock` cannot reach next-auth's own `next/headers` import, so the
      // shim is wired in by alias instead. Requires the deps.inline below.
      { find: /^next\/headers$/, replacement: nextHeadersShim },
      // next-auth/lib/env.js imports the bare `next/server` specifier, which
      // Vite cannot resolve. Point at the real file — NOT a mock — so genuine
      // NextResponse stays in play.
      { find: /^next\/server$/, replacement: "next/server.js" },
    ],
  },
  test: {
    globals: true,
    environment: "node",
    // The rate limiter and the JWKS module cache are per-worker singletons.
    fileParallelism: false,
    env: { NODE_ENV: "test" },
    include: ["characterization/**/*.char.test.ts"],
    globalSetup: ["./characterization/global-setup.ts"],
    // Vite must transform these for the aliases above to apply.
    server: { deps: { inline: ["next-auth", "@auth/core"] } },
    // No coverage block: this suite characterizes behavior, it does not chase
    // a coverage number. apps/api's thresholds live in vitest.config.ts.
  },
});
```

- [ ] **Step 2: Keep the default suite away from these files**

In `apps/api/vitest.config.ts`, add one entry to the existing `test.exclude` array (change nothing else — the `thresholds` block is off limits):

```typescript
    exclude: [
      "**/tests/**/*.spec.ts", // Exclude Playwright tests
      "characterization/**", // Runs under vitest.characterization.config.ts
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
    ],
```

- [ ] **Step 3: Add the script and dev dependencies**

In `apps/api/package.json`, add to `scripts`:

```json
    "test:characterization": "pnpm with-env vitest --run --config vitest.characterization.config.ts",
```

and to `devDependencies`. `@acme/api` and `@orpc/server` are already runtime deps; these are not. `@orpc/client` is needed for the `RPCLink` in Task 11 — add it now so the install happens once:

```json
    "@acme/db": "workspace:*",
    "@orpc/client": "catalog:",
    "jose": "catalog:",
```

All three already exist in the root `pnpm-workspace.yaml` catalog (`@orpc/client: ^1.14.8`, `jose: ^6.2.3`), so `catalog:` resolves without touching that file.

Then install:

```bash
pnpm install
```

- [ ] **Step 4: Add the turbo task**

In `turbo.json`, add to `tasks` (mirroring the existing `test` task's DB dependencies):

```json
    "test:characterization": {
      "dependsOn": ["^topo", "reset-test-db", "^reset-test-db"],
      "cache": false
    },
```

and add the two new variables to `globalEnv`, after `"SKIP_RESET_TEST_DB"`:

```json
    "CHAR_TEST_TARGET",
    "CHAR_TEST_BASE_URL",
```

- [ ] **Step 5: Verify the config is at least loadable**

The suite has no tests yet, so this only proves the config parses and the globalSetup resolves. Expect a "No test files found" message, **not** a stack trace:

```bash
pnpm -C apps/api test:characterization
```

Expected: `No test files found` (exit code may be 1 — that is fine at this step).

- [ ] **Step 6: Commit**

```bash
git add apps/api/vitest.characterization.config.ts apps/api/vitest.config.ts apps/api/package.json turbo.json pnpm-lock.yaml
git commit -m "chore(api): wire up the characterization vitest config and turbo task"
```

---

### Task 4: Global setup — RS256 keypair and JWKS server

**Files:**

- Create: `apps/api/characterization/global-setup.ts`

**Interfaces:**

- Produces: sets `process.env.NEXT_PUBLIC_AUTH_URL` to the fixture JWKS origin before any worker forks; writes the private key JWK to `process.env.CHAR_TEST_SIGNING_JWK` so `fixtures/jwt.ts` can sign with it inside workers. Exports `setup()` and `teardown()`.

**Why this shape:** `packages/api/src/shared.ts:57-63` reads `NEXT_PUBLIC_AUTH_URL` from `process.env` and builds `createRemoteJWKSet` **at module import time**. Vitest runs `globalSetup` in the main process before workers fork, so the value is baked in before `shared.ts` is ever imported. Passing the key through an env var (rather than a module export) is what makes it survive the fork.

- [ ] **Step 1: Write the global setup**

```typescript
// apps/api/characterization/global-setup.ts
import { createServer } from "node:http";
import type { Server } from "node:http";
import { exportJWK, generateKeyPair } from "jose";

/** Must match the kid apps/auth/src/lib/jwt.ts stamps on real tokens. */
export const FIXTURE_KID = "f3-auth-1";

let server: Server | undefined;

export async function setup() {
  // Generated per run; nothing is ever written to disk or committed.
  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  });

  const publicJwk = await exportJWK(publicKey);
  const jwks = {
    keys: [{ ...publicJwk, alg: "RS256", use: "sig", kid: FIXTURE_KID }],
  };

  server = createServer((req, res) => {
    if (req.url === "/.well-known/jwks.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(jwks));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) {
    throw new Error("JWKS fixture server failed to bind a port");
  }

  const issuer = `http://127.0.0.1:${address.port}`;
  // shared.ts builds createRemoteJWKSet from this at import time; workers fork
  // from this process, so it must be set here and not in a setupFile.
  process.env.NEXT_PUBLIC_AUTH_URL = issuer;
  process.env.CHAR_TEST_SIGNING_JWK = JSON.stringify(
    await exportJWK(privateKey),
  );
}

export async function teardown() {
  await new Promise<void>((resolve, reject) =>
    server ? server.close((e) => (e ? reject(e) : resolve())) : resolve(),
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/characterization/global-setup.ts
git commit -m "test(api): generate an RS256 keypair and JWKS server per characterization run"
```

---

### Task 5: The transport seam

**Files:**

- Create: `apps/api/characterization/transport.ts`
- Create: `apps/api/characterization/targets/next.ts`
- Create: `apps/api/characterization/targets/live.ts`
- Create: `apps/api/characterization/smoke.char.test.ts`

**Interfaces:**

- Consumes: `withRequestHeaders` (Task 2).
- Produces: `type Invoke = (req: Request) => Promise<Response>`; `target: { kind: "next" | "hono" | "live"; invoke: Invoke; baseUrl: string }`; `CHAR_BASE` constant. Every later test imports `target` and calls `target.invoke(...)` — nothing imports a route module directly.

**Why a path router:** `/docs` and `/docs/openapi.json` are separate Next route files, so dispatching everything to `[[...rest]]/route.ts` would make the docs cases and the OpenAPI golden unreachable (Verified Fact 6).

- [ ] **Step 1: Write the `next` target**

```typescript
// apps/api/characterization/targets/next.ts
import { withRequestHeaders } from "../header-store";

/**
 * In-process dispatch mirroring Next's file-system routing. apps/api has three
 * route files, and the catch-all does NOT cover /docs — dispatching everything
 * to it would silently skip the docs and OpenAPI cases.
 */
export async function invokeNext(req: Request): Promise<Response> {
  const headers = new Headers(req.headers);
  // A hand-built Request carries no `host`, but @auth/core's createActionURL
  // needs one (AUTH_URL/NEXTAUTH_URL are unset) or it throws inside new URL().
  if (!headers.has("host")) headers.set("host", new URL(req.url).host);
  const request = new Request(req, { headers });

  const { pathname } = new URL(req.url);

  return withRequestHeaders(headers, async () => {
    if (pathname === "/docs/openapi.json") {
      const { GET } = await import("../../src/app/docs/openapi.json/route");
      return GET(request);
    }
    if (pathname === "/docs") {
      const { GET } = await import("../../src/app/docs/route");
      return GET();
    }
    // All method exports of the catch-all are the same handleRequest.
    const { GET } = await import("../../src/app/[[...rest]]/route");
    return GET(request);
  });
}
```

- [ ] **Step 2: Write the `live` target**

```typescript
// apps/api/characterization/targets/live.ts

/**
 * Black-box target used by #650's staging gate. Only the read-only smoke
 * subset runs here — anything needing DB fixtures or in-process rate-limit
 * state is gated off with `describe.runIf(target.kind !== "live")`.
 */
export function makeLiveInvoke(baseUrl: string) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const target = new URL(url.pathname + url.search, baseUrl);
    return fetch(new Request(target, req), { redirect: "manual" });
  };
}
```

- [ ] **Step 3: Write the seam**

```typescript
// apps/api/characterization/transport.ts
import { makeLiveInvoke } from "./targets/live";
import { invokeNext } from "./targets/next";

export type Invoke = (req: Request) => Promise<Response>;
export type TargetKind = "next" | "hono" | "live";

/** Stable synthetic origin so goldens never encode a real host or port. */
export const CHAR_BASE = "http://api.characterization.test";

function resolveTarget(): {
  kind: TargetKind;
  invoke: Invoke;
  baseUrl: string;
} {
  const kind = (process.env.CHAR_TEST_TARGET ?? "next") as TargetKind;

  if (kind === "next") {
    return { kind, invoke: invokeNext, baseUrl: CHAR_BASE };
  }

  if (kind === "live") {
    const baseUrl = process.env.CHAR_TEST_BASE_URL;
    if (!baseUrl) {
      throw new Error("CHAR_TEST_TARGET=live requires CHAR_TEST_BASE_URL");
    }
    return { kind, invoke: makeLiveInvoke(baseUrl), baseUrl };
  }

  if (kind === "hono") {
    // Filled in by #649, which adds the Hono entry point. Kept as an explicit
    // branch so the union and the runIf gates are already in place.
    throw new Error(
      "CHAR_TEST_TARGET=hono is not wired up until the Hono server lands (#649)",
    );
  }

  throw new Error(`Unknown CHAR_TEST_TARGET: ${String(kind)}`);
}

export const target = resolveTarget();

/** Build a request against the active target's origin. */
export function req(path: string, init?: RequestInit): Request {
  return new Request(new URL(path, target.baseUrl), init);
}
```

- [ ] **Step 4: Write the failing smoke test**

```typescript
// apps/api/characterization/smoke.char.test.ts
import { describe, expect, it } from "vitest";

import { req, target } from "./transport";

describe("transport seam", () => {
  it("serves a public procedure through the seam", async () => {
    const res = await target.invoke(req("/v1/ping"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ alive: true });
  });

  it("serves the docs page unauthenticated", async () => {
    const res = await target.invoke(req("/docs"));
    expect(res.status).toBe(200);
  });

  it("serves the OpenAPI document unauthenticated", async () => {
    const res = await target.invoke(req("/docs/openapi.json"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("returns the exact 404 body for an unknown path", async () => {
    const res = await target.invoke(req("/definitely-not-a-route"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });
});
```

- [ ] **Step 5: Run it**

```bash
pnpm docker:up
pnpm -C apps/api test:characterization
```

Expected: 4 passed. If `/docs` fails on `~/env` validation, add the missing key to `apps/api/.env` from `.env.example` — do not weaken the env schema.

- [ ] **Step 6: Lint, format, commit**

```bash
pnpm lint --filter f3-api && pnpm format:fix
git add apps/api/characterization turbo.json
git commit -m "test(api): add the CHAR_TEST_TARGET transport seam with smoke coverage"
```

---

### Task 6: Fixtures — cookies, JWTs, API keys, users

**Files:**

- Create: `apps/api/characterization/fixtures/cookies.ts`
- Create: `apps/api/characterization/fixtures/jwt.ts`
- Create: `apps/api/characterization/fixtures/users.ts`
- Create: `apps/api/characterization/fixtures/api-keys.ts`

**Interfaces:**

- Consumes: `CHAR_TEST_SIGNING_JWK`, `FIXTURE_KID`, `NEXT_PUBLIC_AUTH_URL` (Task 4); `uniqueId`, `getOrCreateRoles`, `getOrCreateF3NationOrg`, `cleanup`, `db` from `@acme/api/testing` (Task 1).
- Produces:
  - `sessionCookie(opts?: { roles?: RoleRow[]; id?: string; email?: string; name?: string; maxAge?: number }): Promise<string>` — a full `name=value` cookie string.
  - `SESSION_COOKIE_NAME: string`
  - `signFixtureJwt(opts: { sub: number; expiresInSeconds?: number; issuer?: string; kid?: string; key?: CryptoKey }): Promise<string>`
  - `generateForeignKey(): Promise<CryptoKey>` — a second keypair for bad-signature cases.
  - `createFixtureUser(): Promise<{ userId: number; email: string; cleanup: () => Promise<void> }>`
  - `createApiKey(opts: { roles?: { orgId: number; roleName: "editor" | "admin" }[]; revoked?: boolean; expiresAt?: Date | null }): Promise<{ key: string; apiKeyId: number; ownerId: number; cleanup: () => Promise<void> }>`

- [ ] **Step 1: Cookie fixtures**

```typescript
// apps/api/characterization/fixtures/cookies.ts
import { encode } from "next-auth/jwt";

import { COOKIE_NAME } from "@acme/shared/common/constants";

interface RoleRow {
  orgId: number;
  orgName: string;
  roleName: string;
}

/**
 * Non-prod cookie prefix is empty (packages/auth/src/config.ts), and in
 * @auth/core the salt IS the cookie name.
 */
export const SESSION_COOKIE_NAME = `${COOKIE_NAME}.session-token`;

export async function sessionCookie(opts?: {
  id?: string;
  email?: string;
  name?: string;
  roles?: RoleRow[];
  /**
   * encode() ALWAYS sets exp = now + maxAge, clobbering any exp in the token
   * payload, so expired fixtures must come from a negative maxAge here.
   */
  maxAge?: number;
}): Promise<string> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for cookie fixtures");

  const token = await encode({
    salt: SESSION_COOKIE_NAME,
    secret,
    ...(opts?.maxAge === undefined ? {} : { maxAge: opts.maxAge }),
    token: {
      sub: opts?.id ?? "1",
      id: opts?.id ?? "1",
      email: opts?.email ?? "char-cookie@example.com",
      name: opts?.name ?? "Char Cookie User",
      roles: opts?.roles ?? [],
    },
  });

  return `${SESSION_COOKIE_NAME}=${token}`;
}
```

- [ ] **Step 2: JWT fixtures**

```typescript
// apps/api/characterization/fixtures/jwt.ts
import { generateKeyPair, importJWK, SignJWT } from "jose";

import { FIXTURE_KID } from "../global-setup";

let cachedKey: CryptoKey | undefined;

async function signingKey(): Promise<CryptoKey> {
  if (!cachedKey) {
    const jwk = process.env.CHAR_TEST_SIGNING_JWK;
    if (!jwk) throw new Error("global-setup did not publish a signing JWK");
    cachedKey = (await importJWK(JSON.parse(jwk), "RS256")) as CryptoKey;
  }
  return cachedKey;
}

/** A second keypair, for bad-signature cases. */
export async function generateForeignKey(): Promise<CryptoKey> {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  return privateKey;
}

/** Mirrors apps/auth/src/lib/jwt.ts signAccessToken's claim shape exactly. */
export async function signFixtureJwt(opts: {
  sub: number;
  expiresInSeconds?: number;
  issuer?: string;
  kid?: string;
  key?: CryptoKey;
}): Promise<string> {
  const key = opts.key ?? (await signingKey());
  const issuer = opts.issuer ?? process.env.NEXT_PUBLIC_AUTH_URL!;

  return new SignJWT({
    email: "char-jwt@example.com",
    scope: "openid profile",
    client_id: "characterization",
  })
    .setProtectedHeader({ alg: "RS256", kid: opts.kid ?? FIXTURE_KID })
    .setSubject(opts.sub.toString())
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime(`${opts.expiresInSeconds ?? 3600}s`)
    .sign(key);
}
```

- [ ] **Step 3: User and API-key fixtures**

Write `fixtures/users.ts` and `fixtures/api-keys.ts` using `db`, `schema`, `uniqueId`, `getOrCreateRoles`, `getOrCreateF3NationOrg`, and `cleanup` from `@acme/api/testing`. Each factory returns the created ids **and its own `cleanup()`** so tests never guess at teardown order, and so the normalizer in Task 10 can scrub exactly those ids by value.

```typescript
// apps/api/characterization/fixtures/users.ts
import { db, getOrCreateRoles, uniqueId } from "@acme/api/testing";
import { eq, schema } from "@acme/db";

export async function createFixtureUser(): Promise<{
  userId: number;
  email: string;
  cleanup: () => Promise<void>;
}> {
  await getOrCreateRoles();
  const email = `${uniqueId()}@characterization.test`;
  const [user] = await db
    .insert(schema.users)
    .values({ email, f3Name: "Char User" })
    .returning({ id: schema.users.id });
  if (!user) throw new Error("failed to insert fixture user");

  return {
    userId: user.id,
    email,
    cleanup: async () => {
      await db
        .delete(schema.rolesXUsersXOrg)
        .where(eq(schema.rolesXUsersXOrg.userId, user.id));
      await db.delete(schema.users).where(eq(schema.users.id, user.id));
    },
  };
}
```

`fixtures/api-keys.ts` follows the same shape: insert into `schema.apiKeys` with `key: uniqueId()`, `ownerId` from a fixture user, optional `revokedAt` / `expiresAt`; insert any requested `schema.rolesXApiKeysXOrg` rows against `getOrCreateF3NationOrg()`; return `{ key, apiKeyId, ownerId, cleanup }` where `cleanup` deletes the join rows, then the key, then the user.

- [ ] **Step 4: Prove the fixtures round-trip**

Add to `smoke.char.test.ts`:

```typescript
import { sessionCookie } from "./fixtures/cookies";

it("a fixture cookie authenticates a protected procedure", async () => {
  const cookie = await sessionCookie({
    roles: [{ orgId: 1, orgName: "F3 Nation", roleName: "admin" }],
  });
  const res = await target.invoke(
    req("/v1/position/", {
      headers: { cookie, "x-forwarded-for": "10.60.0.1" },
    }),
  );
  expect(res.status).toBe(200);
});
```

- [ ] **Step 5: Run**

```bash
pnpm -C apps/api test:characterization
```

Expected: 5 passed. A 401 here means the shim alias is not applied — re-check `server.deps.inline` in the config. A 500 means Postgres is down; run `pnpm docker:up`.

- [ ] **Step 6: Commit**

```bash
pnpm lint --filter f3-api && pnpm format:fix
git add apps/api/characterization
git commit -m "test(api): add cookie, JWT, user, and API-key fixtures"
```

**Phase A ships here.** Open the PR: `test(api): characterization transport seam and fixtures (#660)`.

---

# Phase B — The auth matrix

**PR title:** `test(api): characterize apps/api auth resolution (#660)`

This is the phase that unblocks #646. Every case drives **real** `getSession` resolution — never an injected session.

---

### Task 7: Cookie, client-header, and precedence cases

**Files:**

- Create: `apps/api/characterization/auth/cookie.char.test.ts`
- Create: `apps/api/characterization/auth/client-header.char.test.ts`

**Interfaces:**

- Consumes: `target`, `req`, `CHAR_BASE` (Task 5); `sessionCookie`, `SESSION_COOKIE_NAME` (Task 6).

Cookie cases need **no database** (Verified Fact 5) — roles come off the token via the pure `session` callback.

| Case                               | Request                            | Pin                                                 |
| ---------------------------------- | ---------------------------------- | --------------------------------------------------- |
| valid cookie                       | `cookie` only                      | 200, roles from the token honored                   |
| tampered cookie                    | valid cookie + `"tamper"` appended | 401, **not** 500                                    |
| expired cookie                     | `sessionCookie({}, maxAge: -60)`   | 401                                                 |
| no cookie                          | none                               | 401                                                 |
| cookie + bearer                    | both                               | **cookie wins** — the precedence #646 must preserve |
| cookie + `Client: orpc-ssg`        | both                               | cookie **ignored** (SSG skip-auth branch) → 401     |
| bearer, no `Client` header         | `Authorization: Bearer x`          | 401 with the exact documented message               |
| `Authorization` vs `authorization` | both casings                       | identical outcome                                   |
| `Bearer` vs `bearer` prefix        | both casings                       | identical outcome                                   |

- [ ] **Step 1: Write the cookie file**

```typescript
// apps/api/characterization/auth/cookie.char.test.ts
import { describe, expect, it } from "vitest";

import { sessionCookie } from "../fixtures/cookies";
import { req, target } from "../transport";

const ADMIN_ROLES = [{ orgId: 1, orgName: "F3 Nation", roleName: "admin" }];

/** Unique per case: the rate limiter is a per-worker in-memory singleton. */
function headersFor(ip: string, extra: Record<string, string> = {}) {
  return { "x-forwarded-for": ip, ...extra };
}

describe.runIf(target.kind !== "live")("cookie auth", () => {
  it("authorizes a protected procedure and honors token roles", async () => {
    const cookie = await sessionCookie({ roles: ADMIN_ROLES });
    const res = await target.invoke(
      req("/v1/position/", { headers: headersFor("10.70.0.1", { cookie }) }),
    );
    expect(res.status).toBe(200);
  });

  it("rejects a tampered cookie with 401, not 500", async () => {
    const cookie = (await sessionCookie({ roles: ADMIN_ROLES })) + "tamper";
    const res = await target.invoke(
      req("/v1/position/", { headers: headersFor("10.70.0.2", { cookie }) }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects an expired cookie", async () => {
    // encode() derives exp from maxAge, so this is the only way to expire one.
    const cookie = await sessionCookie({ roles: ADMIN_ROLES, maxAge: -60 });
    const res = await target.invoke(
      req("/v1/position/", { headers: headersFor("10.70.0.3", { cookie }) }),
    );
    expect(res.status).toBe(401);
  });

  it("prefers the cookie over a bearer token when both are present", async () => {
    const cookie = await sessionCookie({ roles: ADMIN_ROLES });
    const res = await target.invoke(
      req("/v1/position/", {
        headers: headersFor("10.70.0.4", {
          cookie,
          authorization: "Bearer definitely-not-a-real-key",
          client: "characterization",
        }),
      }),
    );
    // Pinned because #646 replaces auth() with getSessionFromHeaders and must
    // preserve this ordering exactly.
    expect(res.status).toBe(200);
  });

  it("ignores the cookie entirely for orpc-ssg requests", async () => {
    const cookie = await sessionCookie({ roles: ADMIN_ROLES });
    const res = await target.invoke(
      req("/v1/position/", {
        headers: headersFor("10.70.0.5", { cookie, client: "orpc-ssg" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it, and treat any surprise as a finding**

```bash
pnpm -C apps/api test:characterization
```

If a case fails, the pin is wrong, not the code. Read the actual behavior, update the expectation to match, and note the discrepancy in the PR description. **Do not change `packages/api` in this PR.**

- [ ] **Step 3: Write the client-header file**

`client-header.char.test.ts` covers the bearer-without-`Client` rule and header-casing equivalence. Snapshot the exact message for both envelopes, because the wording is a documented contract:

```typescript
it("rejects a bearer token sent without a Client header", async () => {
  const res = await target.invoke(
    req("/v1/position/", {
      headers: {
        "x-forwarded-for": "10.71.0.1",
        authorization: "Bearer some-key",
      },
    }),
  );
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({
    message:
      "Invalid or expired bearer token. Or, if using API Key auth, ensure the 'client' header is set.",
  });
});
```

- [ ] **Step 4: Run, lint, commit**

```bash
pnpm -C apps/api test:characterization && pnpm lint --filter f3-api && pnpm format:fix
git add apps/api/characterization/auth
git commit -m "test(api): characterize cookie auth and the Client-header rule"
```

---

### Task 8: API key, super-admin, and JWT cases

**Files:**

- Create: `apps/api/characterization/auth/api-key.char.test.ts`
- Create: `apps/api/characterization/auth/super-admin.char.test.ts`
- Create: `apps/api/characterization/auth/jwt.char.test.ts`
- Create: `apps/api/characterization/auth/jwks-unreachable.char.test.ts`

These need the test DB. Each test creates its own fixtures in `beforeAll` and calls the returned `cleanup()` in `afterAll`.

| Group       | Case                                                               | Pin                                                      |
| ----------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| API key     | valid key + `Client` + role rows                                   | 200                                                      |
| API key     | valid key, **no** role rows                                        | `roles: []` → editor procedure 401                       |
| API key     | `revokedAt` set                                                    | 401                                                      |
| API key     | `expiresAt` in the past (compared against `DB_NOW`, not app clock) | 401                                                      |
| API key     | unknown key                                                        | protected 401, but `/v1/ping` still 200                  |
| API key     | `orpc-ssg` + valid key                                             | 200 (SSG uses key auth)                                  |
| Super-admin | `x-api-key` = `SUPER_ADMIN_API_KEY`                                | revalidate authorized                                    |
| Super-admin | wrong `x-api-key`                                                  | 401                                                      |
| Super-admin | session without nation-admin                                       | exact "You are not authorized to revalidate this Nation" |
| JWT         | valid RS256, seeded `sub`                                          | 200, roles fetched from `rolesXUsersXOrg`                |
| JWT         | expired (`expiresInSeconds: -60`)                                  | 401                                                      |
| JWT         | wrong issuer                                                       | 401                                                      |
| JWT         | bad signature (`generateForeignKey()`)                             | 401                                                      |
| JWT         | valid signature, unknown `sub`                                     | 401                                                      |
| JWT         | **JWKS unreachable**                                               | JWT path fails closed, API-key auth still works          |

- [ ] **Step 1: Write `api-key.char.test.ts`**

```typescript
// apps/api/characterization/auth/api-key.char.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiKey } from "../fixtures/api-keys";
import { req, target } from "../transport";

describe.runIf(target.kind !== "live")("API key auth", () => {
  let adminKey: Awaited<ReturnType<typeof createApiKey>>;
  let rolelessKey: Awaited<ReturnType<typeof createApiKey>>;
  let revokedKey: Awaited<ReturnType<typeof createApiKey>>;

  beforeAll(async () => {
    adminKey = await createApiKey({ roles: [{ orgId: 1, roleName: "admin" }] });
    rolelessKey = await createApiKey({ roles: [] });
    revokedKey = await createApiKey({
      roles: [{ orgId: 1, roleName: "admin" }],
      revoked: true,
    });
  });

  afterAll(async () => {
    await adminKey.cleanup();
    await rolelessKey.cleanup();
    await revokedKey.cleanup();
  });

  it("authorizes with a valid key plus a Client header", async () => {
    const res = await target.invoke(
      req("/v1/position/", {
        headers: {
          "x-forwarded-for": "10.72.0.1",
          authorization: `Bearer ${adminKey.key}`,
          client: "characterization",
        },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("resolves an empty role list for a key with no role rows", async () => {
    const res = await target.invoke(
      req("/v1/position/", {
        method: "POST",
        headers: {
          "x-forwarded-for": "10.72.0.2",
          authorization: `Bearer ${rolelessKey.key}`,
          client: "characterization",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "nope", orgId: 1 }),
      }),
    );
    // editorProcedure requires editor|admin; an empty roles array fails it.
    expect(res.status).toBe(401);
  });

  it("rejects a revoked key", async () => {
    const res = await target.invoke(
      req("/v1/position/", {
        headers: {
          "x-forwarded-for": "10.72.0.3",
          authorization: `Bearer ${revokedKey.key}`,
          client: "characterization",
        },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("leaves public procedures reachable with an unknown key", async () => {
    const res = await target.invoke(
      req("/v1/ping", {
        headers: {
          "x-forwarded-for": "10.72.0.4",
          authorization: "Bearer not-a-real-key",
          client: "characterization",
        },
      }),
    );
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Write `jwt.char.test.ts`** using `signFixtureJwt` and a `createFixtureUser()` subject, one `it` per row in the JWT group above.

- [ ] **Step 3: Write `jwks-unreachable.char.test.ts` as its own file**

The JWKS URL is captured at `shared.ts` import time, so this case needs a fresh module registry. `fileParallelism: false` with the forks pool gives each file its own registry, so setting the env var **before the first import of `../transport`** is sufficient:

```typescript
// apps/api/characterization/auth/jwks-unreachable.char.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Port 1 is guaranteed closed. Must be set BEFORE ../transport is imported,
// because packages/api/src/shared.ts builds createRemoteJWKSet at import time.
const realAuthUrl = process.env.NEXT_PUBLIC_AUTH_URL;
process.env.NEXT_PUBLIC_AUTH_URL = "http://127.0.0.1:1";

const { req, target } = await import("../transport");
const { createApiKey } = await import("../fixtures/api-keys");
const { signFixtureJwt } = await import("../fixtures/jwt");

describe.runIf(target.kind !== "live")("JWKS outage isolation", () => {
  // ... assert the JWT path 401s while a valid API key still returns 200,
  // proving a JWKS outage does not take down key-based auth.
});

afterAll(() => {
  process.env.NEXT_PUBLIC_AUTH_URL = realAuthUrl;
});
```

- [ ] **Step 4: Write `super-admin.char.test.ts`**, pinning the exact `"You are not authorized to revalidate this Nation"` message.

- [ ] **Step 5: Run, lint, commit**

```bash
pnpm -C apps/api test:characterization && pnpm lint --filter f3-api && pnpm format:fix
git add apps/api/characterization/auth
git commit -m "test(api): characterize API key, super-admin, and JWT auth paths"
```

---

### Task 9: Role guards, dev-mock, and rate limiting

**Files:**

- Create: `apps/api/characterization/auth/role-guards.char.test.ts`
- Create: `apps/api/characterization/auth/dev-mock.char.test.ts`
- Create: `apps/api/characterization/auth/rate-limit.char.test.ts`

- [ ] **Step 1: Role guards as a matrix**

A representative procedure per guard × four credential types, asserting status **and** message. Pin what the code does: `packages/api/src/shared.ts` throws `UNAUTHORIZED` (401) where the OpenAPI description promises 403.

```typescript
const PROCEDURES = [
  { guard: "protected", path: "/v1/position/", method: "GET" },
  { guard: "editor", path: "/v1/position/", method: "POST" },
  { guard: "admin", path: "/v1/api-key/", method: "GET" },
  { guard: "nationAdmin", path: "/v1/org-chart/", method: "GET" },
] as const;

const CREDENTIALS = [
  "none",
  "user-role-key",
  "editor-key",
  "admin-key",
  "nation-admin-jwt",
] as const;
```

Drive `for (const p of PROCEDURES) for (const c of CREDENTIALS)` with a unique `x-forwarded-for` per pair, and snapshot `{ status, code, message }`. Correct the exact paths and methods against `packages/api/src/router/*.ts` while writing — the four above are starting points, not verified route strings.

- [ ] **Step 2: Dev-mock branch in its own file**

`isDevelopment` is a module constant in `@acme/shared/common/constants`, so mock the module — and keep `NODE_ENV` at `test` so DB routing still points at `TEST_DATABASE_URL`:

```typescript
vi.mock("@acme/shared/common/constants", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isDevelopment: true,
}));
```

Then assert that a request with **no** credentials resolves the mock admin session (`email: "dev@localhost"`, `roles: []`).

- [ ] **Step 3: Rate limiting**

`RATE_LIMIT_MAX_REQUESTS` is `10000` when `isDevelopment`, else `200`. Under `NODE_ENV=test` it is **200**, so a case needs 201 requests against `/v1/ping` — cheap in-process, but excluded from `live`.

```typescript
describe.runIf(target.kind !== "live")("rate limiting", () => {
  it("returns 429 with the retry message once the window limit is passed", async () => {
    const ip = "10.99.0.1";
    for (let i = 0; i < 200; i++) {
      await target.invoke(
        req("/v1/ping", { headers: { "x-forwarded-for": ip } }),
      );
    }
    const res = await target.invoke(
      req("/v1/ping", { headers: { "x-forwarded-for": ip } }),
    );
    expect(res.status).toBe(429);
    expect((await res.json()).message).toMatch(
      /^Rate limit exceeded\. Try again in \d+s$/,
    );
  });

  it("isolates counters per client IP", async () => {
    const res = await target.invoke(
      req("/v1/ping", { headers: { "x-forwarded-for": "10.99.0.2" } }),
    );
    expect(res.status).toBe(200);
  });

  it("keys off the first IP in an x-forwarded-for chain", async () => {
    // getClientIP takes forwarded.split(",")[0], so the proxy hops are ignored.
    const res = await target.invoke(
      req("/v1/ping", {
        headers: { "x-forwarded-for": "10.99.0.3, 10.0.0.1, 10.0.0.2" },
      }),
    );
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 4: Run, lint, commit**

```bash
pnpm -C apps/api test:characterization && pnpm lint --filter f3-api && pnpm format:fix
git add apps/api/characterization/auth
git commit -m "test(api): characterize role guards, the dev-mock branch, and rate limiting"
```

**Phase B ships here.** PR: `test(api): characterize apps/api auth resolution (#660)`. Call out in the description that this unblocks #646, and list every place the pinned behavior contradicts the documented behavior.

---

# Phase C — Wire matrix, goldens, CI, and docs

**PR title:** `test(api): characterize the apps/api wire layer and gate it in CI (#660)`

---

### Task 10: Response normalizer and golden helper

**Files:**

- Create: `apps/api/characterization/normalize.ts`

**Interfaces:**

- Produces: `normalize(res: Response, opts?: { scrub?: Record<string, string> }): Promise<Golden>` where `Golden = { status: number; headers: Record<string, string>; body: unknown }`; `stableStringify(value: unknown): string`.

Scrubbing is **path-rule based**, not regex-over-blob: fixture ids and timestamps are replaced at known JSON paths so a golden can never silently absorb an unrelated change.

- [ ] **Step 1: Write the normalizer**

```typescript
// apps/api/characterization/normalize.ts

/** Only headers that are part of the contract; everything else is noise. */
const GOLDEN_HEADERS = [
  "content-type",
  "location",
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-max-age",
  "vary",
] as const;

export interface Golden {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/** Deterministic key ordering so goldens diff cleanly. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

export async function normalize(
  res: Response,
  opts?: { scrub?: Record<string, string> },
): Promise<Golden> {
  const headers: Record<string, string> = {};
  for (const name of GOLDEN_HEADERS) {
    const value = res.headers.get(name);
    if (value !== null) headers[name] = value;
  }

  const text = await res.clone().text();
  let body: unknown = text;
  if (headers["content-type"]?.includes("application/json")) {
    body = JSON.parse(text);
  }

  // Exact-value substitution of ids the fixtures actually created.
  if (opts?.scrub) {
    body = substitute(body, opts.scrub);
  }

  return { status: res.status, headers, body };
}

function substitute(value: unknown, scrub: Record<string, string>): unknown {
  if (Array.isArray(value)) return value.map((v) => substitute(v, scrub));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        substitute(v, scrub),
      ]),
    );
  }
  const key = String(value);
  return Object.prototype.hasOwnProperty.call(scrub, key) ? scrub[key] : value;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/characterization/normalize.ts
git commit -m "test(api): add the golden-file response normalizer"
```

---

### Task 11: Handler dispatch, CORS, and error envelopes

**Files:**

- Create: `apps/api/characterization/rpc-client.ts`
- Create: `apps/api/characterization/wire/dispatch.char.test.ts`
- Create: `apps/api/characterization/wire/cors.char.test.ts`
- Create: `apps/api/characterization/wire/errors.char.test.ts`
- Create: `apps/api/characterization/wire/serialization.char.test.ts`

- [ ] **Step 1: Bind a real oRPC client to the seam**

Never hand-roll RPC wire frames — use a real `RPCLink` with `fetch` pointed at the seam, mirroring `apps/map/src/orpc/client.ts:16`:

```typescript
// apps/api/characterization/rpc-client.ts
import type { RouterClient } from "@orpc/server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import type { router } from "@acme/api";
import { API_PREFIX_V1 } from "@acme/shared/app/constants";
import { Client, Header } from "@acme/shared/common/enums";

import { target } from "./transport";

export function createCharClient(
  extraHeaders: Record<string, string> = {},
): RouterClient<typeof router> {
  const link = new RPCLink({
    url: `${target.baseUrl}${API_PREFIX_V1}`,
    headers: { [Header.Client]: Client.ORPC, ...extraHeaders },
    fetch: (input, init) => target.invoke(new Request(input, init)),
  });
  return createORPCClient(link);
}
```

- [ ] **Step 2: Dispatch cases**

Pin that routing is **header-based, not path-based**:

| Case                                  | Pin                                                       |
| ------------------------------------- | --------------------------------------------------------- |
| `Client: orpc` via `RPCLink`          | RPC body shape, golden                                    |
| same procedure via REST `GET`         | OpenAPI body shape, golden — **different from the above** |
| `Client: f3-me`                       | routes to the RPC handler                                 |
| `Client: orpc-ssg`                    | routes to the RPC handler                                 |
| `/v1/...` with **no** `Client` header | falls through to OpenAPI → **404**                        |

- [ ] **Step 3: CORS cases**

This is the group that catches Hono `OPTIONS` wiring:

```typescript
it("echoes the origin on a preflight and allows credentials", async () => {
  const res = await target.invoke(
    req("/v1/ping", {
      method: "OPTIONS",
      headers: {
        origin: "https://map.f3nation.com",
        "access-control-request-method": "GET",
        "x-forwarded-for": "10.80.0.1",
      },
    }),
  );
  await expect(stableStringify(await normalize(res))).toMatchFileSnapshot(
    "../__snapshots__/cors-preflight.golden.json",
  );
});
```

The `CORSPlugin` config in `[[...rest]]/route.ts` sets `origin: (origin) => origin`, `credentials: true`, `maxAge: 600`, and allow-headers `content-type`/`authorization`/`client` — all of which land in the golden.

- [ ] **Step 4: Error envelopes**

Golden the 401/404/422/429 envelope for **both** handlers. The envelope shape is precisely what #649 must not change.

- [ ] **Step 5: Serialization edges**

`/v1/ping` returns `z.date()`; pin how the Date crosses each handler (RPC preserves type via its own codec; OpenAPI emits an ISO string). Add one nullable-field response through both.

- [ ] **Step 6: Run, lint, commit**

```bash
pnpm -C apps/api test:characterization && pnpm lint --filter f3-api && pnpm format:fix
git add apps/api/characterization
git commit -m "test(api): characterize handler dispatch, CORS, and error envelopes"
```

---

### Task 12: The OpenAPI golden

**Files:**

- Create: `apps/api/characterization/wire/openapi-spec.char.test.ts`
- Create: `apps/api/characterization/__snapshots__/openapi.golden.json`

This **supersedes the `jq -S` diff planned in #649** — delete that step from #649 when it comes up.

- [ ] **Step 1: Write it**

```typescript
// apps/api/characterization/wire/openapi-spec.char.test.ts
import { describe, expect, it } from "vitest";

import { stableStringify } from "../normalize";
import { req, target } from "../transport";

describe("OpenAPI document", () => {
  it("matches the committed golden", async () => {
    // NEXT_PUBLIC_API_URL must be unset so `servers` is derived from the
    // fixed host header rather than from whoever's .env is loaded.
    const previous = process.env.NEXT_PUBLIC_API_URL;
    delete process.env.NEXT_PUBLIC_API_URL;
    try {
      const res = await target.invoke(
        req("/docs/openapi.json", {
          headers: { host: "api.characterization.test" },
        }),
      );
      expect(res.status).toBe(200);

      const spec = (await res.json()) as { info: { version: string } };
      // Release Please bumps this every release; the version is not behavior.
      spec.info.version = "0.0.0-characterization";

      await expect(stableStringify(spec)).toMatchFileSnapshot(
        "../__snapshots__/openapi.golden.json",
      );
    } finally {
      if (previous !== undefined) process.env.NEXT_PUBLIC_API_URL = previous;
    }
  });
});
```

- [ ] **Step 2: Generate and review the golden**

```bash
pnpm -C apps/api test:characterization -- -u
git diff --stat apps/api/characterization/__snapshots__/
```

Read the generated spec before committing it. It is large; confirm `servers[0].url` is `http://api.characterization.test`, that `info.version` is the normalized placeholder, and that no local paths or secrets leaked in.

- [ ] **Step 3: Commit**

```bash
git add apps/api/characterization
git commit -m "test(api): pin the OpenAPI document with a committed golden"
```

---

### Task 13: CI step and documentation

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `docs/testing.md`

- [ ] **Step 1: Add the CI step**

In the `test-coverage` job, **after** the existing `- run: pnpm test`. Sequential is required: both suites mutate the same `f3_test` database.

```yaml
- run: pnpm test
# Runs after `pnpm test`, never concurrently: both suites mutate the
# shared f3_test database.
- run: pnpm turbo run test:characterization
```

Do **not** rename the `test-coverage` job — the `main` branch ruleset and the deploy workflows' `check-regexp` both reference it by name.

No new workflow env vars are needed: `AUTH_SECRET`, `SUPER_ADMIN_API_KEY`, and `TEST_DATABASE_URL` are already in the top-level `env:` block, and `NEXT_PUBLIC_AUTH_URL` is set at runtime by `global-setup.ts`.

- [ ] **Step 2: Document the suite**

Add a `## Characterization suite (apps/api)` section to `docs/testing.md` after `## Thresholds`, covering: what the suite is for and why it exists; how to run it (`pnpm docker:up` then `pnpm -C apps/api test:characterization`); the `CHAR_TEST_TARGET` seam and its three values; **the golden-freeze rule** — goldens are frozen for Phases 0a–4 of #644, and any diff is a migration bug or an explicit PR sign-off; and the fact that this suite has no coverage thresholds by design.

- [ ] **Step 3: Verify the full pipeline the way CI will**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm turbo run test:characterization
```

Expected: all green. `pnpm lint` includes `scripts/check-vitest-thresholds.mjs`; if it complains, a coverage threshold was touched — revert that, do not appease it.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml docs/testing.md
git commit -m "ci(ci): run the apps/api characterization suite after pnpm test"
```

**Phase C ships here.** PR: `test(api): characterize the apps/api wire layer and gate it in CI (#660)`.

---

# Phase D — Pin the token producer

**PR title:** `test(auth): unit-test RS256 access token signing (#660)`

The characterization suite pins the token **consumer** (`getSessionFromJWT`). This pins the **producer** to the same contract, so the two cannot drift apart.

---

### Task 14: `apps/auth/src/lib/jwt.test.ts`

**Files:**

- Create: `apps/auth/src/lib/jwt.test.ts`

**Interfaces:**

- Consumes: `signAccessToken`, `getJWKS` from `apps/auth/src/lib/jwt.ts`.

- [ ] **Step 1: Check for an existing config**

```bash
ls apps/auth/vitest.config.ts && grep -n '"test"' apps/auth/package.json
```

If `apps/auth` has no Vitest setup, add one modeled on `packages/api/vitest.config.ts` (node environment, `resolve.tsconfigPaths`) plus a `test` script, and include it in this commit.

- [ ] **Step 2: Write the tests**

Four tests, generating a throwaway PEM into `AUTH_JWT_PRIVATE_KEY` so nothing is committed:

```typescript
// apps/auth/src/lib/jwt.test.ts
import { exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

const ISSUER = "https://auth.characterization.test";

beforeAll(async () => {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  process.env.AUTH_JWT_PRIVATE_KEY = await exportPKCS8(privateKey);
  process.env.NEXT_PUBLIC_AUTH_URL = ISSUER;
});

describe("signAccessToken", () => {
  it("produces a token that verifies against the app's own JWKS", async () => {
    const { getJWKS, signAccessToken } = await import("./jwt");
    const token = await signAccessToken({
      sub: 42,
      email: "producer@example.com",
      scope: "openid",
      clientId: "test-client",
      expiresInSeconds: 3600,
    });

    const { keys } = await getJWKS();
    const { createLocalJWKSet } = await import("jose");
    const { payload, protectedHeader } = await jwtVerify(
      token,
      createLocalJWKSet({ keys }),
      { issuer: ISSUER, algorithms: ["RS256"] },
    );

    expect(protectedHeader.alg).toBe("RS256");
    // The kid the characterization suite's JWKS fixture also serves.
    expect(protectedHeader.kid).toBe("f3-auth-1");
    // getSessionFromJWT does Number(payload.sub) — a numeric STRING is the
    // contract, and a non-numeric sub silently resolves to no session.
    expect(payload.sub).toBe("42");
    expect(payload.iss).toBe(ISSUER);
  });

  it("exposes only public key material in the JWKS", async () => {
    const { getJWKS } = await import("./jwt");
    const { keys } = await getJWKS();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({
      alg: "RS256",
      use: "sig",
      kid: "f3-auth-1",
    });
    // d/p/q are private components and must never be served.
    expect(keys[0]).not.toHaveProperty("d");
    expect(keys[0]).not.toHaveProperty("p");
  });

  it("honors expiresInSeconds", async () => {
    const { signAccessToken } = await import("./jwt");
    const token = await signAccessToken({
      sub: 7,
      email: "e@example.com",
      scope: "openid",
      clientId: "c",
      expiresInSeconds: 60,
    });
    const [, payloadPart] = token.split(".");
    const claims = JSON.parse(
      Buffer.from(payloadPart!, "base64url").toString(),
    ) as { exp: number; iat: number };
    expect(claims.exp - claims.iat).toBe(60);
  });

  it("carries email, scope, and client_id through to the payload", async () => {
    const { signAccessToken } = await import("./jwt");
    const token = await signAccessToken({
      sub: 9,
      email: "claims@example.com",
      scope: "openid profile",
      clientId: "f3-me",
      expiresInSeconds: 300,
    });
    const [, payloadPart] = token.split(".");
    expect(
      JSON.parse(Buffer.from(payloadPart!, "base64url").toString()),
    ).toMatchObject({
      email: "claims@example.com",
      scope: "openid profile",
      client_id: "f3-me",
    });
  });
});
```

- [ ] **Step 3: Run**

```bash
pnpm -C apps/auth test
```

Expected: 4 passed. Note that `jwt.ts` memoizes `_privateKey` and `_jwks` in module scope, which is why `AUTH_JWT_PRIVATE_KEY` is set in `beforeAll` and the module is imported dynamically inside each test.

- [ ] **Step 4: Lint, format, commit**

```bash
pnpm lint --filter f3-auth && pnpm format:fix
git add apps/auth
git commit -m "test(auth): pin RS256 access token signing against getJWKS"
```

**Phase D ships here.** PR: `test(auth): unit-test RS256 access token signing (#660)`.

---

## Acceptance Criteria (from #660)

- [ ] Suite passes locally: `pnpm docker:up && pnpm -C apps/api test:characterization`.
- [ ] Suite passes in CI via the `test-coverage` job.
- [ ] Auth matrix and wire matrix cases from Tasks 7–12 are all present.
- [ ] Golden files committed and reviewable (one file per case, `toMatchFileSnapshot`).
- [ ] Existing `packages/api` tests untouched and green.
- [ ] `docs/testing.md` documents the suite, the `CHAR_TEST_TARGET` seam, and the golden-freeze rule.

## Deliberately Out of Scope

Router business logic (covered by `packages/api`), next-auth login flows (OTP/email — untouched by the migration), Scalar docs HTML beyond a status check, distributed rate limiting, and coverage thresholds for this suite.

## Carry Forward to Later Phases

- **#646** must keep the cookie-over-bearer precedence and the `orpc-ssg` skip-auth branch pinned in Task 7, and should add the transitional test asserting `getSessionFromHeaders(headers)` deep-equals the session `auth()` produced for the same cookie fixture.
- **#649** must fill in the `hono` branch of `resolveTarget()`, run CI twice (`CHAR_TEST_TARGET=next` and `=hono`) against identical goldens, and **drop its planned `jq -S` OpenAPI diff** in favor of Task 12's golden.
- **#649/#650** must reproduce the `/map` → `/` permanent redirect declared in `apps/api/next.config.js`. The in-process seam cannot see Next-level config, so only the `live` target catches its loss.
- **#650**'s staging gate is `CHAR_TEST_TARGET=live CHAR_TEST_BASE_URL=<staging>`, which runs only the un-gated read-only subset.
- If a next-auth bump breaks the `next/headers` alias, demote the cookie cases to the `live` target. The tests themselves do not change — only which target runs them.
