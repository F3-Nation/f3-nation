# apps/api Wire Matrix Implementation Plan (Issue #660, Phase C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin the `apps/api` HTTP wire layer — handler dispatch, CORS, error envelopes, response serialization, and the OpenAPI document — with committed golden files, so the Hono port (#645–#650) can be proven behavior-identical.

**Architecture:** Five new test files under the existing `apps/api/characterization/` suite, driven through the already-merged `CHAR_TEST_TARGET` transport seam. Two new helpers support them: `normalize.ts` turns a `Response` into a deterministic `{ status, headers, body }` golden shape with path-rule scrubbing, and `rpc-client.ts` binds a real oRPC `RPCLink` to the seam so RPC-protocol cases use genuine wire frames rather than hand-rolled ones. Goldens are written with `toMatchFileSnapshot` into `characterization/__snapshots__/`.

**Tech Stack:** Vitest 4, oRPC 1.14 (`RPCLink`, `RPCHandler`, `OpenAPIHandler`, `CORSPlugin`), Zod, next-auth 5.0.0-beta.31 + `@auth/core` 0.41.3, Drizzle + Postgres 18.

**Spec:** [`docs/superpowers/specs/2026-07-26-api-wire-matrix-design.md`](../specs/2026-07-26-api-wire-matrix-design.md)

## Global Constraints

- Node >= 24.18 (`.nvmrc`), pnpm 11. `pnpm` may not be on `PATH`: prepend `~/.nvm/versions/node/$(node --version)/bin`.
- **This suite characterizes, it does not correct.** Pin what the code _does_, even where that contradicts the docs or this plan's expectations. Never modify a file under `apps/api/src/` or `packages/` in this PR.
- **When reality disagrees with this plan, reality wins.** Several assertions below are best-effort predictions. If a test fails because the real behavior differs, change the test to match the real behavior and record the finding in the PR body. Do not change production code to satisfy the plan.
- **Goldens are frozen for Phases 0a–4 of #644.** Any golden diff in #645–#650 is a migration bug or an explicit sign-off in that PR.
- Branch: `test/660-wire-matrix` (already created off `main` at `743c6927`). If it needs updating from `main` later, replant — `git rebase --onto origin/main 743c6927 test/660-wire-matrix` — never `git merge origin/main`, which conflicts in every Phase A/B file because phases are squash-merged.
- **Every request in this suite must carry a unique `x-forwarded-for`.** The rate limiter is a per-worker in-memory singleton keyed by client IP with a 200-request / 60s window under `NODE_ENV=test`. A repeated IP causes an unrelated test to flake as a 429. Each file below is assigned its own `10.9x.*` block.
- Commits follow Conventional Commits with a **required** scope: `test(api):`, `docs(repo):`. PR title must match the same format.
- Two-space indent, kebab-case filenames, explicit TypeScript types. Never `--no-verify`.
- Never `console.*` — but note the suite is test code and does not need `@acme/logger`.
- Do not touch `apps/api/vitest.config.ts` coverage thresholds. `autoUpdate` stays `true`.

---

## Verified Facts (do not re-derive)

Established by Phases A and B and by reading the merged code. These override any contrary assumption.

1. **Dispatch is by header, not path.** `apps/api/src/app/[[...rest]]/route.ts` picks the RPC handler when `Header.Client` is one of `orpc`, `orpc-ssg`, `f3-me`; otherwise the OpenAPI handler with `prefix: "/"`. `API_PREFIX_V1` (`"/v1"`) is only the RPC handler's prefix _after_ that choice.
2. **The CI step already exists** at `.github/workflows/ci.yml:336`. Do not add it again.
3. **`ping` is the only `publicProcedure`** and it takes no input, returning `{ alive: boolean, timestamp: z.date() }`. Any input-validation case therefore needs an authenticated request.
4. **Cookie auth touches no database.** `packages/auth/src/config.ts` uses `session: { strategy: "jwt" }` with a pure session callback; roles ride on the token. Cookie-authorized cases run with Postgres down.
5. **The rate limiter runs before auth**, at the `base` procedure in `packages/api/src/shared.ts:85`. So 429 is reachable on the public `ping`.
6. **`eventTag.byOrgId`** is a `protectedProcedure`, `GET /event-tag/org/{orgId}`, input `z.object({ orgId: z.coerce.number(), isActive: z.coerce.boolean().optional() })`, returning `{ eventTags: EventTag[] | null }`. It is this plan's vehicle for both the validation-error case (`orgId` that will not coerce) and the nullable-field serialization case.
7. **The seam already models Next's pre-handler layers** (`characterization/targets/next.ts`): trailing-slash 308, the `next.config.js` `/map` → `/` 308, docs-route 405/auto-OPTIONS, HEAD body-stripping. Do not re-test those; Phase A's `smoke.char.test.ts` already pins them.
8. **`sessionCookie({ roles })`** from `characterization/fixtures/cookies.ts` returns a ready `name=value` cookie string. Admin roles are `[{ orgId: 1, orgName: "F3 Nation", roleName: "admin" }]`.
9. **`verdict.ts`** exports `expectAuthorized(res, { allow? })` and `expectUnauthorized(res, message?)`. Its own comment records that post-auth input validation surfaces as **400**, not the 422 the original issue assumed.
10. **`describe.runIf(target.inProcess)`** gates anything needing DB fixtures, in-process module state, or the `next` target specifically. Pure black-box cases stay ungated so `CHAR_TEST_TARGET=live` can run them in #650.

---

## File Structure

```
apps/api/characterization/
  normalize.ts                          # NEW  Response -> Golden, path-rule scrubbing
  normalize.char.test.ts                # NEW  unit tests for the helper itself
  rpc-client.ts                         # NEW  real RPCLink bound to the seam + response capture
  wire/dispatch.char.test.ts            # NEW  header-based handler selection
  wire/cors.char.test.ts                # NEW  preflight + response CORS headers
  wire/errors.char.test.ts              # NEW  401 / 404 / validation / 429 x both handlers
  wire/serialization.char.test.ts       # NEW  Date + nullable field x both handlers
  wire/openapi-spec.char.test.ts        # NEW  the OpenAPI document golden
  __snapshots__/                        # NEW  committed goldens (~14 files)
docs/testing.md                         # MODIFIED  new "Characterization suite (apps/api)" section
```

### IP block allocation

Assigned so no two files can collide on the limiter, and so a 429 case cannot poison its neighbors.

| File                              | Block                              |
| --------------------------------- | ---------------------------------- |
| `wire/dispatch.char.test.ts`      | `10.90.*`                          |
| `wire/cors.char.test.ts`          | `10.91.*`                          |
| `wire/errors.char.test.ts`        | `10.92.*` (warm-up IP `10.92.9.9`) |
| `wire/serialization.char.test.ts` | `10.93.*`                          |
| `wire/openapi-spec.char.test.ts`  | `10.94.*`                          |

---

## Task 1: The response normalizer

**Files:**

- Create: `apps/api/characterization/normalize.ts`
- Test: `apps/api/characterization/normalize.char.test.ts`

**Interfaces:**

- Produces, relied on by every later task:
  - `interface Golden { status: number; headers: Record<string, string>; body: unknown }`
  - `interface NormalizeOptions { paths?: Record<string, string>; values?: Record<string, string> }`
  - `normalize(res: Response, opts?: NormalizeOptions): Promise<Golden>`
  - `stableStringify(value: unknown): string`

**Why a unit test for a test helper:** the "unmatched path rule throws" behavior is the property that stops goldens from rotting into rubber-stamps. If it silently no-ops, a renamed field stops being scrubbed and the golden churns — or worse, absorbs a real change. That property deserves its own test.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/characterization/normalize.char.test.ts
import { describe, expect, it } from "vitest";

import { normalize, stableStringify } from "./normalize";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-noise": "ignored" },
  });
}

describe("normalize", () => {
  it("keeps only allow-listed headers", async () => {
    const golden = await normalize(jsonResponse({ ok: true }));
    expect(golden.headers).toEqual({ "content-type": "application/json" });
  });

  it("parses a JSON body and passes text through unchanged", async () => {
    expect((await normalize(jsonResponse({ ok: true }))).body).toEqual({
      ok: true,
    });

    const text = new Response("Not found", { status: 404 });
    const golden = await normalize(text);
    expect(golden).toMatchObject({ status: 404, body: "Not found" });
  });

  it("replaces values at dotted paths, including through arrays", async () => {
    const golden = await normalize(
      jsonResponse({
        timestamp: "2026-07-26T00:00:00.000Z",
        items: [{ id: 11 }, { id: 12 }],
      }),
      { paths: { timestamp: "<TIMESTAMP>", "items[].id": "<ID>" } },
    );

    expect(golden.body).toEqual({
      timestamp: "<TIMESTAMP>",
      items: [{ id: "<ID>" }, { id: "<ID>" }],
    });
  });

  it("throws when a path rule matches nothing", async () => {
    await expect(
      normalize(jsonResponse({ ok: true }), { paths: { missing: "<X>" } }),
    ).rejects.toThrow(/scrub path "missing" matched nothing/);
  });

  it("replaces known values anywhere in the body", async () => {
    const golden = await normalize(
      jsonResponse({ nested: { key: "abc123" } }),
      {
        values: { abc123: "<KEY>" },
      },
    );
    expect(golden.body).toEqual({ nested: { key: "<KEY>" } });
  });

  it("does not throw for an unused value rule", async () => {
    // Unlike path rules, value rules are opportunistic: a fixture id that
    // simply does not appear in this response is not a defect.
    await expect(
      normalize(jsonResponse({ ok: true }), { values: { nope: "<X>" } }),
    ).resolves.toMatchObject({ body: { ok: true } });
  });
});

describe("stableStringify", () => {
  it("sorts keys recursively so goldens diff on behavior, not ordering", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
    expect(stableStringify({ b: 1, a: 2 })).toBe('{\n  "a": 2,\n  "b": 1\n}');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
pnpm -C apps/api test:characterization -- normalize
```

Expected: FAIL — `Failed to resolve import "./normalize"`.

- [ ] **Step 3: Implement the normalizer**

```typescript
// apps/api/characterization/normalize.ts

/**
 * Only headers that are part of the contract. Everything else — dates, content
 * lengths, framework fingerprints — is noise that would churn goldens on
 * changes that are not behavior.
 */
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

export interface NormalizeOptions {
  /**
   * Replace at known JSON paths: dotted, with `[]` for every element of an
   * array. A rule that matches nothing THROWS — a golden must never silently
   * stop scrubbing a field that moved, because that is how golden suites decay
   * into rubber stamps.
   */
  paths?: Record<string, string>;
  /** Replace by exact value, anywhere. For fixture ids the test itself created. */
  values?: Record<string, string>;
}

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
  opts: NormalizeOptions = {},
): Promise<Golden> {
  const headers: Record<string, string> = {};
  for (const name of GOLDEN_HEADERS) {
    const value = res.headers.get(name);
    if (value !== null) headers[name] = value;
  }

  const text = await res.clone().text();
  let body: unknown =
    headers["content-type"]?.includes("json") && text.length > 0
      ? (JSON.parse(text) as unknown)
      : text;

  if (opts.paths) body = applyPaths(body, opts.paths);
  if (opts.values) body = applyValues(body, opts.values);

  return { status: res.status, headers, body };
}

function applyPaths(body: unknown, rules: Record<string, string>): unknown {
  let result = body;
  for (const [path, replacement] of Object.entries(rules)) {
    const { value, matched } = replaceAtPath(
      result,
      path.split("."),
      replacement,
    );
    if (!matched) {
      throw new Error(
        `normalize: scrub path "${path}" matched nothing. The field was ` +
          `renamed or removed — update the rule rather than deleting it.`,
      );
    }
    result = value;
  }
  return result;
}

/** Walks one dotted segment at a time; `foo[]` fans out over an array. */
function replaceAtPath(
  node: unknown,
  segments: string[],
  replacement: string,
): { value: unknown; matched: boolean } {
  const [head, ...rest] = segments;
  if (head === undefined) return { value: replacement, matched: true };

  const isArraySegment = head.endsWith("[]");
  const key = isArraySegment ? head.slice(0, -2) : head;

  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return { value: node, matched: false };
  }
  const record = node as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return { value: node, matched: false };
  }

  const child = record[key];

  if (isArraySegment) {
    if (!Array.isArray(child)) return { value: node, matched: false };
    // An empty array is a match with nothing to do: the field exists and the
    // rule is still correct, so this must not throw.
    let matched = true;
    const items = child.map((item) => {
      const outcome = replaceAtPath(item, rest, replacement);
      matched = matched && outcome.matched;
      return outcome.value;
    });
    return { value: { ...record, [key]: items }, matched };
  }

  const outcome = replaceAtPath(child, rest, replacement);
  return {
    value: { ...record, [key]: outcome.value },
    matched: outcome.matched,
  };
}

function applyValues(node: unknown, values: Record<string, string>): unknown {
  if (Array.isArray(node)) return node.map((v) => applyValues(v, values));
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>).map(([k, v]) => [
        k,
        applyValues(v, values),
      ]),
    );
  }
  const key = String(node);
  return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : node;
}
```

Note the two deliberate asymmetries, both load-bearing:

- `replaceAtPath` on a **leaf** (`segments` exhausted) returns `matched: true` regardless of the value, so scrubbing an explicit `null` works.
- An `items[]` rule over an **empty array** counts as matched. The field exists and the rule is still correct; throwing there would make an empty-result golden impossible to write.

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
pnpm -C apps/api test:characterization -- normalize
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/characterization/normalize.ts apps/api/characterization/normalize.char.test.ts
git commit -m "test(api): add the golden-file response normalizer"
```

---

## Task 2: The oRPC client and handler dispatch

**Files:**

- Create: `apps/api/characterization/rpc-client.ts`
- Create: `apps/api/characterization/wire/dispatch.char.test.ts`
- Create (generated): `apps/api/characterization/__snapshots__/dispatch-*.golden.json`

**Interfaces:**

- Consumes: `normalize`, `stableStringify` (Task 1); `target`, `req` (`../transport`); `sessionCookie` (`../fixtures/cookies`).
- Produces, relied on by Tasks 3 and 4:
  - `rpcResponse(call: (client: RouterClient<typeof router>) => Promise<unknown>, headers?: Record<string, string>): Promise<Response>`

`rpcResponse` is the module's **only** export. A separate `createCharClient` that returns the typed client looks natural, but every case in this plan needs the raw wire `Response`, so nothing would import it — and knip would flag it as an unused export in `pnpm lint`. Add it only if a later case genuinely needs a client whose throw is the assertion.

**Why `rpcResponse` exists:** `RPCLink` gives you a typed client that _throws_ an `ORPCError` on a non-2xx. The error envelope goldens in Task 3 need the raw `Response`. So the link's custom `fetch` captures the response on its way through, and `rpcResponse` returns it while swallowing whatever the client then throws. That way RPC cases use genuine wire frames — which the `orpc-ssg` skip-auth case specifically requires — without losing access to the wire response.

- [ ] **Step 1: Write the client**

```typescript
// apps/api/characterization/rpc-client.ts
import type { RouterClient } from "@orpc/server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import type { router } from "@acme/api";
import { API_PREFIX_V1 } from "@acme/shared/app/constants";
import { Client, Header } from "@acme/shared/common/enums";

import { target } from "./transport";

/**
 * Invoke a procedure through a real oRPC client and return the raw wire
 * Response.
 *
 * Never hand-roll RPC wire frames: the encoding is the client library's
 * business, and a hand-rolled frame pins the test author's guess rather than
 * the protocol. But the typed client throws on non-2xx, which discards exactly
 * the envelope the error goldens exist to pin — so capture the response inside
 * the link's fetch and hand it back.
 */
export async function rpcResponse(
  call: (client: RouterClient<typeof router>) => Promise<unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const { link, captured } = buildLink(extraHeaders);
  const client: RouterClient<typeof router> = createORPCClient(link);
  try {
    await call(client);
  } catch {
    // Expected for every non-2xx case; the response is already captured.
  }
  const response = captured.value;
  if (!response) {
    throw new Error("rpcResponse: the link never issued a request");
  }
  return response;
}

// Return type inferred deliberately: RPCLink is generic over its client
// context, and spelling that parameter out here would pin a guess.
function buildLink(extraHeaders: Record<string, string>) {
  const captured: { value?: Response } = {};
  const link = new RPCLink({
    url: `${target.baseUrl}${API_PREFIX_V1}`,
    headers: { [Header.Client]: Client.ORPC, ...extraHeaders },
    fetch: async (input, init) => {
      const response = await target.invoke(new Request(input, init));
      // Clone: the client consumes the body, and the caller needs it too.
      captured.value = response.clone();
      return response;
    },
  });
  return { link, captured };
}
```

- [ ] **Step 2: Write the dispatch tests**

```typescript
// apps/api/characterization/wire/dispatch.char.test.ts
import { describe, expect, it } from "vitest";

import { Client, Header } from "@acme/shared/common/enums";

import { expectUnauthorized } from "../auth/verdict";
import { sessionCookie } from "../fixtures/cookies";
import { normalize, stableStringify } from "../normalize";
import { rpcResponse } from "../rpc-client";
import { req, target } from "../transport";

/**
 * Dispatch in `[[...rest]]/route.ts` selects a handler by the `Client` HEADER,
 * not by the path. `/v1` is only the RPC handler's prefix once that handler has
 * already been chosen. A port that routes by path would pass casual testing and
 * silently break SSG and the map client, so pin the rule itself.
 */
describe("handler dispatch", () => {
  it("returns the RPC body shape for a real oRPC client", async () => {
    const res = await rpcResponse((client) => client.ping(), {
      "x-forwarded-for": "10.90.0.1",
    });
    expect(res.status).toBe(200);
    await expect(
      stableStringify(
        await normalize(res, { paths: { "json.timestamp": "<TIMESTAMP>" } }),
      ),
    ).toMatchFileSnapshot("../__snapshots__/dispatch-rpc-ping.golden.json");
  });

  it("returns the OpenAPI body shape for the same procedure over REST", async () => {
    const res = await target.invoke(
      req("/v1/ping", { headers: { "x-forwarded-for": "10.90.0.2" } }),
    );
    expect(res.status).toBe(200);
    await expect(
      stableStringify(
        await normalize(res, { paths: { timestamp: "<TIMESTAMP>" } }),
      ),
    ).toMatchFileSnapshot("../__snapshots__/dispatch-rest-ping.golden.json");
  });

  it.each([
    ["f3-me", Client.F3_ME],
    ["orpc-ssg", Client.ORPC_SSG],
  ])("routes %s to the RPC handler", async (_label, clientHeader) => {
    // A bare REST-shaped GET reaching the RPC handler cannot match a procedure,
    // so a 404 here IS the proof it went to the RPC handler: the OpenAPI
    // handler would have served /v1/ping with a 200.
    const res = await target.invoke(
      req("/v1/ping", {
        headers: {
          [Header.Client]: clientHeader,
          "x-forwarded-for": `10.90.1.${clientHeader.length}`,
        },
      }),
    );
    expect(res.status).toBe(404);
  });

  it("falls through to the OpenAPI handler when no Client header is sent", async () => {
    const res = await target.invoke(
      req("/v1/ping", { headers: { "x-forwarded-for": "10.90.2.1" } }),
    );
    // The OpenAPI handler mounts at prefix "/", so /v1/ping resolves for it.
    expect(res.status).toBe(200);
  });

  it("404s an unknown path under /v1 without a Client header", async () => {
    const res = await target.invoke(
      req("/v1/not-a-procedure", {
        headers: { "x-forwarded-for": "10.90.2.2" },
      }),
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });
});

/**
 * Carried over from Phase B, which could not reach this branch: `orpc-ssg` plus
 * a REST-shaped request 404s at the RPC handler BEFORE auth runs, so the
 * skip-auth semantics were unreachable without a real RPC frame. This is the
 * precedence rule #646 must preserve.
 */
describe.runIf(target.inProcess)("orpc-ssg skip-auth", () => {
  it("ignores a valid session cookie on an SSG request", async () => {
    const cookie = await sessionCookie({
      roles: [{ orgId: 1, orgName: "F3 Nation", roleName: "admin" }],
    });
    const res = await rpcResponse((client) => client.apiKey.all({}), {
      [Header.Client]: Client.ORPC_SSG,
      cookie,
      "x-forwarded-for": "10.90.3.1",
    });
    // The cookie is not consulted on the SSG path, so an admin procedure that
    // succeeds WITH this cookie under Client: orpc must fail without it here.
    await expectUnauthorized(res);
  });

  it("authorizes the same SSG request with an API key", async () => {
    // Proves the previous case is about the cookie specifically, not about SSG
    // rejecting everything.
    const cookie = await sessionCookie({
      roles: [{ orgId: 1, orgName: "F3 Nation", roleName: "admin" }],
    });
    const res = await rpcResponse((client) => client.apiKey.all({}), {
      [Header.Client]: Client.ORPC,
      cookie,
      "x-forwarded-for": "10.90.3.2",
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 3: Run and reconcile with reality**

```bash
pnpm docker:up
pnpm -C apps/api test:characterization -- dispatch
```

Three predictions in this file are best-effort and may be wrong. For each, **change the test to match observed behavior and note it in the PR body** — do not change production code:

- `client.apiKey.all({})` — confirm the procedure name and input shape against `packages/api/src/router/api-key.ts`. The typed client will fail `pnpm typecheck` if wrong; fix the call, not the router.
- The `f3-me` / `orpc-ssg` 404 prediction. If the RPC handler resolves a bare REST GET instead, the case still distinguishes the handlers — reassert on whatever actually distinguishes them and say so in a comment.
- The SSG skip-auth verdict. If the cookie is honored rather than ignored, that is a **finding**: pin it and flag it in the PR body as direct input to #646.

- [ ] **Step 4: Generate and review the goldens**

```bash
pnpm -C apps/api test:characterization -- dispatch -u
git diff --stat apps/api/characterization/__snapshots__/
cat apps/api/characterization/__snapshots__/dispatch-rpc-ping.golden.json
cat apps/api/characterization/__snapshots__/dispatch-rest-ping.golden.json
```

Read both. **The two bodies must differ** — that difference is the entire point of the pair. The RPC codec preserves the `Date` type (expect a wrapper such as `{"json":…,"meta":…}`), while OpenAPI emits a plain ISO string. If they are identical, the RPC case did not actually reach the RPC handler.

The `paths` rule in each test is written for the shape this plan predicts. If the RPC envelope nests differently, the normalizer will **throw** `scrub path "json.timestamp" matched nothing` — that is the safety net working. Correct the path to the real one.

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint --filter f3-api && pnpm format:fix
git add apps/api/characterization
git commit -m "test(api): characterize header-based handler dispatch"
```

---

## Task 3: CORS and error envelopes

**Files:**

- Create: `apps/api/characterization/wire/cors.char.test.ts`
- Create: `apps/api/characterization/wire/errors.char.test.ts`
- Create (generated): `apps/api/characterization/__snapshots__/cors-*.golden.json`, `__snapshots__/errors-*.golden.json`

**Interfaces:**

- Consumes: `normalize`, `stableStringify` (Task 1); `rpcResponse` (Task 2); `req`, `target`; `sessionCookie`.

- [ ] **Step 1: Write the CORS tests**

```typescript
// apps/api/characterization/wire/cors.char.test.ts
import { describe, expect, it } from "vitest";

import { normalize, stableStringify } from "../normalize";
import { req, target } from "../transport";

/**
 * The `CORSPlugin` in `[[...rest]]/route.ts` is configured with
 * `origin: (origin) => origin`, `credentials: true`, `maxAge: 600`, and
 * allow-headers content-type / authorization / client. All of it lands in these
 * goldens. This is the group that catches a Hono port wiring OPTIONS wrong —
 * the failure mode there is a preflight that 404s or omits the credentials
 * header, which browsers surface as an opaque CORS error rather than a 500.
 */
describe("CORS", () => {
  it("echoes the origin on a preflight and allows credentials", async () => {
    const res = await target.invoke(
      req("/v1/ping", {
        method: "OPTIONS",
        headers: {
          origin: "https://map.f3nation.com",
          "access-control-request-method": "GET",
          "access-control-request-headers": "content-type,client",
          "x-forwarded-for": "10.91.0.1",
        },
      }),
    );
    await expect(stableStringify(await normalize(res))).toMatchFileSnapshot(
      "../__snapshots__/cors-preflight.golden.json",
    );
  });

  it("carries CORS headers on an actual response, not just the preflight", async () => {
    const res = await target.invoke(
      req("/v1/ping", {
        headers: {
          origin: "https://map.f3nation.com",
          "x-forwarded-for": "10.91.0.2",
        },
      }),
    );
    expect(res.status).toBe(200);
    await expect(
      stableStringify(
        await normalize(res, { paths: { timestamp: "<TIMESTAMP>" } }),
      ),
    ).toMatchFileSnapshot("../__snapshots__/cors-actual-response.golden.json");
  });

  it("echoes a different origin verbatim rather than a fixed allow-list", async () => {
    // `origin: (origin) => origin` reflects whatever is asked for. Pinning a
    // second origin makes that reflection explicit, so a port that hardcodes
    // one production origin fails here instead of in a browser.
    const res = await target.invoke(
      req("/v1/ping", {
        method: "OPTIONS",
        headers: {
          origin: "https://example.invalid",
          "access-control-request-method": "GET",
          "x-forwarded-for": "10.91.0.3",
        },
      }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://example.invalid",
    );
  });
});
```

- [ ] **Step 2: Write the error-envelope tests**

```typescript
// apps/api/characterization/wire/errors.char.test.ts
import { beforeAll, describe, expect, it } from "vitest";

import { sessionCookie } from "../fixtures/cookies";
import { normalize, stableStringify } from "../normalize";
import { rpcResponse } from "../rpc-client";
import { req, target } from "../transport";

/**
 * The error envelope shape is precisely what #649 must not change: every client
 * in the monorepo branches on `code` and surfaces `message`. Golden it for both
 * handlers.
 */

/** Driven to its limit in beforeAll; only the 429 cases use it. */
const EXHAUSTED_IP = "10.92.9.9";
const LIMIT = 200;

describe("error envelopes", () => {
  it("goldens the 401 envelope on both handlers", async () => {
    const rest = await target.invoke(
      req("/event-tag/org/1", { headers: { "x-forwarded-for": "10.92.0.1" } }),
    );
    expect(rest.status).toBe(401);
    await expect(stableStringify(await normalize(rest))).toMatchFileSnapshot(
      "../__snapshots__/errors-401-openapi.golden.json",
    );

    const rpc = await rpcResponse(
      (client) => client.eventTag.byOrgId({ orgId: 1 }),
      { "x-forwarded-for": "10.92.0.2" },
    );
    expect(rpc.status).toBe(401);
    await expect(stableStringify(await normalize(rpc))).toMatchFileSnapshot(
      "../__snapshots__/errors-401-rpc.golden.json",
    );
  });

  it("goldens the 404 envelope on both handlers", async () => {
    const rest = await target.invoke(
      req("/no-such-route", { headers: { "x-forwarded-for": "10.92.1.1" } }),
    );
    expect(rest.status).toBe(404);
    await expect(stableStringify(await normalize(rest))).toMatchFileSnapshot(
      "../__snapshots__/errors-404-openapi.golden.json",
    );

    // The RPC handler resolves procedures by path under /v1; an unknown one
    // cannot go through the typed client, so issue it directly.
    const rpc = await target.invoke(
      req("/v1/no-such-procedure", {
        method: "POST",
        headers: {
          client: "orpc",
          "content-type": "application/json",
          "x-forwarded-for": "10.92.1.2",
        },
        body: "{}",
      }),
    );
    expect(rpc.status).toBe(404);
    await expect(stableStringify(await normalize(rpc))).toMatchFileSnapshot(
      "../__snapshots__/errors-404-rpc.golden.json",
    );
  });

  it("goldens the input-validation envelope on both handlers", async () => {
    // Validation runs AFTER the auth middleware, so an unauthenticated request
    // 401s before it ever gets there. Authorize with a cookie (no DB needed),
    // then send an orgId that z.coerce.number() cannot coerce.
    const cookie = await sessionCookie({
      roles: [{ orgId: 1, orgName: "F3 Nation", roleName: "user" }],
    });

    const rest = await target.invoke(
      req("/event-tag/org/not-a-number", {
        headers: { cookie, "x-forwarded-for": "10.92.2.1" },
      }),
    );
    // verdict.ts records this as 400, NOT the 422 issue #660 assumed. Pin what
    // the code returns; if it is neither, pin that and say so in the PR body.
    expect(rest.status).toBe(400);
    await expect(stableStringify(await normalize(rest))).toMatchFileSnapshot(
      "../__snapshots__/errors-validation-openapi.golden.json",
    );

    const rpc = await rpcResponse(
      (client) =>
        // The client is typed against the router, so an intentionally invalid
        // input has to be forced past the compiler.
        client.eventTag.byOrgId({
          orgId: "not-a-number",
        } as unknown as { orgId: number }),
      { cookie, "x-forwarded-for": "10.92.2.2" },
    );
    expect(rpc.status).toBe(400);
    await expect(stableStringify(await normalize(rpc))).toMatchFileSnapshot(
      "../__snapshots__/errors-validation-rpc.golden.json",
    );
  });
});

/**
 * Separate describe with its own warm-up so no case above pays the ~4s cost or
 * risks inheriting an exhausted counter. The limiter is a per-worker singleton
 * and this file has its own instance (forks pool, fileParallelism: false), so
 * exhausting one IP here cannot affect another file.
 */
describe.runIf(target.inProcess)("429 envelope", () => {
  beforeAll(async () => {
    const started = Date.now();
    for (let i = 0; i < LIMIT; i++) {
      const res = await target.invoke(
        req("/v1/ping", { headers: { "x-forwarded-for": EXHAUSTED_IP } }),
      );
      expect(res.status).toBe(200);
    }
    const elapsed = Date.now() - started;
    // The window slides: if the warm-up itself outran 30s, early requests are
    // already evicted and the cases below would read as "expected 200 to be
    // 429" — a slow runner masquerading as a limiter regression.
    expect(
      elapsed,
      `warm-up took ${elapsed}ms; the 60s sliding window already evicted early requests`,
    ).toBeLessThan(30_000);
  }, 60_000);

  it("goldens the 429 envelope on both handlers", async () => {
    const rest = await target.invoke(
      req("/v1/ping", { headers: { "x-forwarded-for": EXHAUSTED_IP } }),
    );
    expect(rest.status).toBe(429);
    await expect(
      stableStringify(
        // The retry seconds count down within the window, so scrub the message.
        await normalize(rest, { paths: { message: "<RATE_LIMIT_MESSAGE>" } }),
      ),
    ).toMatchFileSnapshot("../__snapshots__/errors-429-openapi.golden.json");

    const rpc = await rpcResponse((client) => client.ping(), {
      "x-forwarded-for": EXHAUSTED_IP,
    });
    expect(rpc.status).toBe(429);
    await expect(
      stableStringify(
        await normalize(rpc, { paths: { message: "<RATE_LIMIT_MESSAGE>" } }),
      ),
    ).toMatchFileSnapshot("../__snapshots__/errors-429-rpc.golden.json");
  });

  it("pins the retry-message wording separately from the envelope", async () => {
    const res = await target.invoke(
      req("/v1/ping", { headers: { "x-forwarded-for": EXHAUSTED_IP } }),
    );
    const body = (await res.json()) as { message: string };
    expect(body.message).toMatch(/^Rate limit exceeded\. Try again in \d+s$/);
  });
});
```

- [ ] **Step 3: Run and reconcile**

```bash
pnpm -C apps/api test:characterization -- cors errors
```

Reconcile against reality, changing tests rather than production code:

- **The validation status.** 400 is `verdict.ts`'s recorded observation, but confirm it for both handlers — they may differ from each other, which is itself worth pinning and calling out.
- **The RPC 404 path.** If a POST to an unknown `/v1` procedure does not 404, find what it does return and pin that.
- **The `message` scrub path** in the 429 goldens. If the RPC envelope nests the message (e.g. under `json`), the normalizer throws with the exact path that failed — correct the rule.
- `client.eventTag.byOrgId` must typecheck. If the procedure is named differently, correct the call.

- [ ] **Step 4: Generate and review the goldens**

```bash
pnpm -C apps/api test:characterization -- cors errors -u
for f in apps/api/characterization/__snapshots__/cors-*.golden.json apps/api/characterization/__snapshots__/errors-*.golden.json; do echo "--- $f"; cat "$f"; done
```

Check specifically that `cors-preflight.golden.json` contains `access-control-allow-credentials: true`, `access-control-max-age: 600`, an allow-methods list including `OPTIONS`, and the echoed origin. Those four are the Hono `OPTIONS` tripwire.

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint --filter f3-api && pnpm format:fix
git add apps/api/characterization
git commit -m "test(api): characterize CORS and error envelopes"
```

---

## Task 4: Serialization edges and the OpenAPI document

**Files:**

- Create: `apps/api/characterization/wire/serialization.char.test.ts`
- Create: `apps/api/characterization/wire/openapi-spec.char.test.ts`
- Create (generated): `apps/api/characterization/__snapshots__/serialization-*.golden.json`, `__snapshots__/openapi.golden.json`

**Interfaces:**

- Consumes: `normalize`, `stableStringify` (Task 1); `rpcResponse` (Task 2); `req`, `target`; `sessionCookie`.

- [ ] **Step 1: Write the serialization tests**

```typescript
// apps/api/characterization/wire/serialization.char.test.ts
import { describe, expect, it } from "vitest";

import { sessionCookie } from "../fixtures/cookies";
import { normalize, stableStringify } from "../normalize";
import { rpcResponse } from "../rpc-client";
import { req, target } from "../transport";

/**
 * The two handlers serialize the same handler return value differently, and
 * both shapes are load-bearing contracts for their clients. A port that routes
 * every request through one handler would pass the auth matrix and silently
 * change every date and null on the wire.
 */
describe("serialization", () => {
  it("preserves the Date type over RPC and emits ISO-8601 over REST", async () => {
    // `ping` returns { alive: boolean, timestamp: z.date() }.
    const rpc = await rpcResponse((client) => client.ping(), {
      "x-forwarded-for": "10.93.0.1",
    });
    await expect(
      stableStringify(
        await normalize(rpc, { paths: { "json.timestamp": "<TIMESTAMP>" } }),
      ),
    ).toMatchFileSnapshot(
      "../__snapshots__/serialization-date-rpc.golden.json",
    );

    const rest = await target.invoke(
      req("/v1/ping", { headers: { "x-forwarded-for": "10.93.0.2" } }),
    );
    const restBody = (await rest.clone().json()) as { timestamp: string };
    // Pin the FORMAT before scrubbing the value; a golden alone would hide a
    // switch from ISO-8601 to an epoch number behind the <TIMESTAMP> token.
    expect(restBody.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    await expect(
      stableStringify(
        await normalize(rest, { paths: { timestamp: "<TIMESTAMP>" } }),
      ),
    ).toMatchFileSnapshot(
      "../__snapshots__/serialization-date-openapi.golden.json",
    );
  });

  it("carries a nullable field through both handlers", async () => {
    // eventTag.byOrgId returns { eventTags: EventTag[] | null }. An org id with
    // no tags exercises the empty/nullable branch without seeding anything.
    const cookie = await sessionCookie({
      roles: [{ orgId: 1, orgName: "F3 Nation", roleName: "user" }],
    });

    const rest = await target.invoke(
      req("/event-tag/org/999999", {
        headers: { cookie, "x-forwarded-for": "10.93.1.1" },
      }),
    );
    expect(rest.status).toBe(200);
    await expect(stableStringify(await normalize(rest))).toMatchFileSnapshot(
      "../__snapshots__/serialization-nullable-openapi.golden.json",
    );

    const rpc = await rpcResponse(
      (client) => client.eventTag.byOrgId({ orgId: 999999 }),
      { cookie, "x-forwarded-for": "10.93.1.2" },
    );
    expect(rpc.status).toBe(200);
    await expect(stableStringify(await normalize(rpc))).toMatchFileSnapshot(
      "../__snapshots__/serialization-nullable-rpc.golden.json",
    );
  });
});
```

This second case reads the database, so if it proves flaky against seeded data, wrap the describe in `describe.runIf(target.inProcess)` and pick an org id the seed cannot contain.

- [ ] **Step 2: Write the OpenAPI golden test**

```typescript
// apps/api/characterization/wire/openapi-spec.char.test.ts
import { describe, expect, it } from "vitest";

import { stableStringify } from "../normalize";
import { req, target } from "../transport";

describe("OpenAPI document", () => {
  it("matches the committed golden", async () => {
    // NEXT_PUBLIC_API_URL must be unset so `servers` derives from the fixed
    // host header rather than from whoever's .env happens to be loaded.
    const previous = process.env.NEXT_PUBLIC_API_URL;
    delete process.env.NEXT_PUBLIC_API_URL;
    try {
      const res = await target.invoke(
        req("/docs/openapi.json", {
          headers: {
            host: "api.characterization.test",
            "x-forwarded-for": "10.94.0.1",
          },
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

  it("serves the document with no credentials", async () => {
    // #660's ADR follow-up: "the docs stay public" becomes CI-enforced on both
    // transports rather than a promise.
    const res = await target.invoke(
      req("/docs/openapi.json", {
        headers: { "x-forwarded-for": "10.94.0.2" },
      }),
    );
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 3: Run and generate**

```bash
pnpm -C apps/api test:characterization -- serialization openapi -u
```

- [ ] **Step 4: Review the goldens — the OpenAPI one line by line**

```bash
cat apps/api/characterization/__snapshots__/serialization-date-rpc.golden.json
cat apps/api/characterization/__snapshots__/serialization-date-openapi.golden.json
wc -l apps/api/characterization/__snapshots__/openapi.golden.json
grep -n '"url"' apps/api/characterization/__snapshots__/openapi.golden.json
grep -n '"version"' apps/api/characterization/__snapshots__/openapi.golden.json
```

This golden is large and committed forever. Before staging it, confirm:

- `servers[0].url` is derived from `api.characterization.test`, not `localhost`, not a real deployment.
- `info.version` is exactly `0.0.0-characterization`.
- No absolute filesystem paths (`/Users/…`, `/home/…`) appear anywhere.
- No credential-shaped strings appear. Grep for it:

```bash
grep -niE 'secret|password|api[-_]?key["\x27]?\s*:\s*["\x27][^"\x27]{8,}|/Users/|/home/' \
  apps/api/characterization/__snapshots__/openapi.golden.json
```

Expected: no output, or only schema **field names** like `apiKey` with no value attached. Anything else is a leak — stop and report it rather than committing.

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint --filter f3-api && pnpm format:fix
git add apps/api/characterization
git commit -m "test(api): pin response serialization and the OpenAPI document"
```

---

## Task 5: Documentation and full-pipeline verification

**Files:**

- Modify: `docs/testing.md` (insert after the `## Thresholds` section, before `## Driving auth-bounded flows`)

- [ ] **Step 1: Add the documentation section**

Insert verbatim after the `### `autoUpdate` is not optional` subsection:

````markdown
## Characterization suite (apps/api)

`apps/api/characterization/` is a behavior-pinning suite separate from the unit
tests. It exists for one reason: the Hono migration (epic #644) replaces the
framework underneath `apps/api`, and the code with the largest blast radius —
auth resolution and the HTTP wire layer — had no end-to-end tests at all. The
suite fires real HTTP requests through the real route handlers with nothing
mocked, so a port can be proven behavior-identical instead of argued to be.

The framework decision itself is recorded in
[ADR 0001](adr/0001-api-server-framework.md).

### Running it

```bash
pnpm docker:up
pnpm -C apps/api test:characterization
```

CI runs it in the `test-coverage` job, sequentially after `pnpm test` — both
suites mutate the shared `f3_test` database and must never run concurrently.

### The transport seam

Every test is written against `type Invoke = (req: Request) => Promise<Response>`,
selected by `CHAR_TEST_TARGET`:

| Value            | Dispatch                                  | Used by                                              |
| ---------------- | ----------------------------------------- | ---------------------------------------------------- |
| `next` (default) | the real Next route handlers, in-process  | today, and CI                                        |
| `hono`           | the Hono app's `fetch`                    | #649, run alongside `next` against identical goldens |
| `live`           | real `fetch` against `CHAR_TEST_BASE_URL` | #650's staging gate                                  |

Cases needing DB fixtures or in-process module state are gated behind
`describe.runIf(target.inProcess)`, so the `live` target runs the black-box
subset without any test rewrites.

### Golden files are frozen

`characterization/__snapshots__/` holds one committed golden per case. **They are
frozen for Phases 0a–4 of #644.** A golden diff in #645–#650 means one of two
things: a migration bug, or a deliberate behavior change that must be called out
and signed off in that PR's description. Never regenerate goldens with `-u` to
make a red build green.

### It has no coverage thresholds, by design

The suite characterizes behavior; it does not chase a coverage number.
`apps/api`'s thresholds live in `vitest.config.ts`, which excludes this
directory. Do not add a `coverage` block to `vitest.characterization.config.ts`.
````

The ADR link is relative to `docs/testing.md`'s own directory, so `adr/0001-api-server-framework.md` — not `docs/adr/…`.

- [ ] **Step 2: Run the whole pipeline the way CI will**

```bash
pnpm docker:up
pnpm typecheck
pnpm test
pnpm turbo run test:characterization
```

Expected: all green. The characterization suite should report roughly 78 tests (Phase A+B's 56, plus this plan's ~22).

- [ ] **Step 3: Run the lint gates**

```bash
pnpm lint --filter f3-api
pnpm format:fix
pnpm exec knip
```

Two known local quirks:

- Root `pnpm lint` fails on a **pre-existing** sherif warning (`packages/db-python` has no `package.json`) that masks later steps including knip. Run `pnpm exec knip` from the root directly, as above.
- `f3-slackbot` lint fails locally with `ruff_args[@]: unbound variable` (no `uv` installed). If that is the only failure, lint is passing.

If knip flags any new file as unused: `normalize.ts`, `rpc-client.ts`, and the `wire/*.char.test.ts` files are all reachable from `vitest.characterization.config.ts`'s `include` glob, which `knip.config.ts` already declares for the `apps/api` workspace. A new flag means the file is genuinely unreferenced — check the import, do not add a knip ignore.

`pnpm lint` also runs `scripts/check-vitest-thresholds.mjs`. If it complains, a coverage threshold was touched — revert that change; do not appease it.

- [ ] **Step 4: Commit the docs**

```bash
git add docs/testing.md
git commit -m "docs(repo): document the apps/api characterization suite"
```

- [ ] **Step 5: Open the PR**

```bash
git push -u origin test/660-wire-matrix
```

Then open the PR with title `test(api): characterize the apps/api wire layer (#660)`. The body must cover:

- What Phase C adds and that it closes the wire half of #660 (Phase D, the `apps/auth` JWT producer test, is the remaining piece).
- **A golden-file reading guide.** ~14 new files is enough to induce skimming. Say explicitly which encode a non-obvious contract and deserve real attention — `dispatch-rpc-ping` vs `dispatch-rest-ping` (the shapes must differ), `cors-preflight` (the Hono `OPTIONS` tripwire), the four `errors-*` envelopes — and which are mechanical.
- **Every place reality contradicted the plan**, especially: the actual input-validation status, the actual `orpc-ssg` skip-auth verdict, and any RPC envelope nesting that changed a scrub path. The SSG finding in particular is direct input to #646.
- The `openapi.golden.json` churn warning: any `packages/api` router change now updates that file, and that churn is the intended signal.
- Commands run and their results.

---

## Self-Review Notes

Checked against the spec:

- Every in-scope item maps to a task: `normalize.ts` → 1, `rpc-client.ts` + dispatch → 2, CORS + errors → 3, serialization + OpenAPI → 4, docs → 5. The `orpc-ssg` skip-auth carry-over is in Task 2.
- The spec's "CI step already merged" is honored — no task touches `.github/workflows/ci.yml`.
- Names are consistent across tasks: `normalize` / `stableStringify` / `Golden` / `NormalizeOptions` (Task 1) and `createCharClient` / `rpcResponse` (Task 2) are used with those exact signatures in Tasks 3 and 4.
- The 400-vs-422 ambiguity is deliberately left to execution, as the spec requires, with explicit instructions to pin whatever is observed.
