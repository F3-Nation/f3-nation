# apps/api Wire Matrix — Phase C Design (Issue #660)

**Status:** approved 2026-07-26
**Parent plan:** [`docs/superpowers/plans/2026-07-22-api-characterization-suite.md`](../plans/2026-07-22-api-characterization-suite.md)
**Predecessors:** Phase A (PR #713, merged `fecddf15`), Phase B (PR #715, merged `743c6927`)

## Purpose

Phase C completes the HTTP-wire half of the `apps/api` characterization suite: the
handler-dispatch rule, CORS, error envelopes, response serialization, and the
OpenAPI document. Together with Phase B's auth matrix this is the parity gate that
#645–#650 run against, so the Hono port can be proven behavior-identical rather
than argued to be.

The suite **characterizes, it does not correct.** Every case pins what the code
does today, including where that contradicts the docs. Never change production
behavior in this PR.

## What Phase A and B already delivered

Phase C builds on merged infrastructure and must not re-create it:

- `characterization/transport.ts` — the `CHAR_TEST_TARGET` seam exposing
  `target.invoke`, `target.baseUrl`, `target.inProcess`, and `req(path, init)`.
- `characterization/targets/next.ts` — a three-way path router that already models
  Next's pre-handler layers: the implicit trailing-slash 308, the `next.config.js`
  redirect table, the docs route's synthesized 405 and auto-OPTIONS, and HEAD
  body-stripping. The wire matrix can assume a faithful seam.
- `characterization/global-setup.ts` — per-run RS256 keypair and JWKS server.
- `characterization/fixtures/{api-keys,cookies,jwt,users}.ts`.
- `characterization/auth/verdict.ts` — `expectAuthorized` / `expectUnauthorized`.
- `turbo.json` `test:characterization` task, the `apps/api` package script, the
  knip declarations, and the `globalEnv` entries.
- **The CI step.** `.github/workflows/ci.yml` already runs
  `pnpm turbo run test:characterization` in `test-coverage`, sequentially after
  `pnpm test`. Task 13 Step 1 of the parent plan is a no-op — do not re-add it.

## Scope

**In scope**

1. `characterization/normalize.ts` — response → golden shape, with path-rule scrubbing.
2. `characterization/rpc-client.ts` — a real oRPC `RPCLink` bound to the seam.
3. Five `characterization/wire/*.char.test.ts` files (~22 cases).
4. The `__snapshots__/` golden files those cases produce (~14 files).
5. The `Client: orpc-ssg` skip-auth case deferred out of Phase B.
6. A `## Characterization suite (apps/api)` section in `docs/testing.md`.

**Out of scope**

- The CI step (merged).
- Phase D (`apps/auth/src/lib/jwt.test.ts`) — ships as its own PR under a
  `test(auth):` scope.
- Router business logic (covered by `packages/api`), Scalar docs HTML content,
  coverage thresholds for this suite.
- Any edit to production source.

## Branch and delivery

Branch `test/660-wire-matrix`, PR title
`test(api): characterize the apps/api wire layer (#660)`.

Phases are squash-merged, so `main` carries one commit whose content equals the
prior branch's N commits with no shared ancestry. **Never `git merge origin/main`
into a phase branch** — it conflicts in every predecessor file for no real reason.
Replant instead:

```bash
git rebase --onto origin/main 743c6927 test/660-wire-matrix
```

## Component: `normalize.ts`

```ts
interface Golden {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

normalize(res: Response, opts?: NormalizeOptions): Promise<Golden>;
stableStringify(value: unknown): string;
```

`headers` is an allow-list — `content-type`, `location`, the five
`access-control-*` headers, and `vary`. Everything else is noise that would make
goldens churn on unrelated infrastructure changes.

`stableStringify` sorts object keys recursively and indents by two, so a golden
diff reflects a behavior change rather than a key-ordering change.

### Scrubbing is path-rule based

The parent plan's `normalize.ts` sketch documents path rules but implements
exact-value substitution (`scrub[String(value)]`). That cannot handle
`/v1/ping`, whose `timestamp` is a `z.date()` filled from `Date.now()` — a value
the test does not know in advance, so every ping golden would churn on every run.

Phase C implements two distinct options:

```ts
interface NormalizeOptions {
  /** Replace at known JSON paths. Dotted, with `[]` for array elements. */
  paths?: Record<string, string>;
  /** Replace by exact value. For fixture ids the test itself created. */
  values?: Record<string, string>;
}
```

**A `paths` rule that matches nothing throws.** This is the load-bearing
property: a golden must never silently stop scrubbing a field that moved or was
renamed, because that is precisely how golden suites rot into
rubber-stamping. A rule that stops matching is a signal, not a no-op.

## Component: `rpc-client.ts`

```ts
rpcResponse(
  call: (client: RouterClient<typeof router>) => Promise<unknown>,
  extraHeaders?: Record<string, string>,
): Promise<Response>;
```

A real `RPCLink` whose `fetch` is bound to the seam
(`fetch: (input, init) => target.invoke(new Request(input, init))`), mirroring
[`apps/map/src/orpc/client.ts:16`](../../../apps/map/src/orpc/client.ts). URL is
`${target.baseUrl}${API_PREFIX_V1}`; default headers carry `Header.Client:
Client.ORPC`.

Hand-rolled RPC wire frames are banned. The `orpc-ssg` skip-auth case is carried
over from Phase B specifically because Phase B could not produce a valid frame
without this client.

The typed client throws an `ORPCError` on any non-2xx, which discards exactly
the envelope the error goldens exist to pin. So the link's custom `fetch`
captures the `Response` on its way through and `rpcResponse` returns it,
swallowing the throw. That is the module's only export — a `createCharClient`
returning the bare typed client would have no importer and would fail knip.

## The case matrix

### `wire/dispatch.char.test.ts`

The dispatch rule in `apps/api/src/app/[[...rest]]/route.ts` selects a handler by
the **`Client` header, not the path**. `API_PREFIX_V1` is only the RPC handler's
prefix once that handler has been chosen. A port that routes by path would pass
casual testing and break SSG, so this group pins the rule directly.

| Case                                        | Pin                                                             |
| ------------------------------------------- | --------------------------------------------------------------- |
| `Client: orpc` via `createCharClient`       | RPC body shape — golden                                         |
| Same procedure via REST `GET`               | OpenAPI body shape, different from the above — golden           |
| `Client: f3-me`                             | routes to the RPC handler — inline                              |
| `Client: orpc-ssg`                          | routes to the RPC handler — inline                              |
| `/v1/ping` with **no** `Client` header      | falls through to OpenAPI → 404 — inline                         |
| `Client: orpc-ssg` + a valid session cookie | cookie **ignored** (skip-auth branch) — inline via `verdict.ts` |

The final case is the Phase B carry-over. Phase B established that `orpc-ssg` plus
a REST request 404s before auth ever runs, which is why the skip-auth semantics
were unreachable without a real RPC frame.

### `wire/cors.char.test.ts`

The group that catches Hono `OPTIONS` wiring. `CORSPlugin` is configured with
`origin: (origin) => origin`, `credentials: true`, `maxAge: 600`, and allow-headers
`content-type` / `authorization` / `client`, all of which land in the golden.

- `OPTIONS` + `Origin` + `access-control-request-method` → preflight golden.
- CORS headers present on an actual 200 response → golden.

### `wire/errors.char.test.ts`

The error envelope shape is exactly what #649 must not change. Golden the envelope
for each reachable status across **both** handlers — 401, 404, the
input-validation status, and 429.

The parent plan assumed input validation surfaces as **422**. `verdict.ts` already
documents it as **400**. Determine the real status when writing the test and pin
that; do not presume either. Characterize what is.

### `wire/serialization.char.test.ts`

- `/v1/ping` returns `{ alive: boolean, timestamp: z.date() }`. Pin how the Date
  crosses each handler — the RPC codec preserves the type, OpenAPI emits an ISO
  string. `timestamp` is path-scrubbed.
- One nullable-field response through both handlers.

### `wire/openapi-spec.char.test.ts`

One golden for `/docs/openapi.json`, fetched with a fixed `host` header and
`NEXT_PUBLIC_API_URL` deleted for the duration of the call (restored in a
`finally`) so `servers` derives from the synthetic host rather than from whoever's
`.env` is loaded. `info.version` is normalized to `0.0.0-characterization` because
Release Please bumps it every release and the version is not behavior.

This **supersedes the `jq -S` spec diff planned in #649** — remove that step when
#649 is picked up.

### Rate-limit discipline

The limiter is a per-worker module singleton. Every wire request sends a unique
`x-forwarded-for`, the same discipline `auth/rate-limit.char.test.ts` follows.
Without it the 429 golden case poisons its neighbors, and the failure presents as
an unrelated test flaking.

## Golden files

One file per case at
`apps/api/characterization/__snapshots__/<area>-<case>.golden.json`, written with
`toMatchFileSnapshot` so PR diffs are reviewable. Roughly 14 files.

Goldens are used where the **whole shape** is the contract — the OpenAPI document,
the error envelopes, the CORS preflight, the RPC-vs-REST body shapes, the
serialization edges. Status-only pins stay as inline assertions, matching the
style Phase A and B established in `smoke.char.test.ts`. Turning a
`status === 404` check into a file would force a reviewer to open a file to learn
what a test pins.

Generate with `-u`, then **read every golden before committing**. For the OpenAPI
document specifically, confirm `servers[0].url` is the synthetic host, that
`info.version` is the placeholder, and that no local filesystem paths or secrets
leaked in.

**Goldens are frozen for Phases 0a–4 of #644.** Any golden diff in #645–#650 is a
migration bug or an explicit, called-out sign-off in that PR.

## Documentation

Add `## Characterization suite (apps/api)` to `docs/testing.md` after
`## Thresholds`, covering: what the suite is for and why it exists; how to run it
(`pnpm docker:up`, then `pnpm -C apps/api test:characterization`); the
`CHAR_TEST_TARGET` seam and its three values; the golden-freeze rule; and the fact
that the suite carries no coverage thresholds by design.

## Verification

```bash
pnpm -C apps/api test:characterization
pnpm typecheck
pnpm lint --filter f3-api
pnpm exec knip
```

Root `pnpm lint` currently dies on a pre-existing sherif warning
(`packages/db-python` has no `package.json`) that masks later steps including
knip, so run knip directly from the root.

`pnpm lint` includes `scripts/check-vitest-thresholds.mjs`. If it complains, a
coverage threshold was touched — revert that; do not appease it. Never
`--no-verify`.

## Risks

- **OpenAPI golden churn.** Any router change in any PR touching `packages/api`
  now updates this file. Mitigated by normalizing `info.version`; accepted
  otherwise, because that churn is the signal the golden exists to produce.
- **Validation status.** 400 vs 422 is unresolved by design — resolve it by
  execution when writing `wire/errors.char.test.ts`.
- **`orpc-ssg` skip-auth may differ from the code reading.** If a real RPC frame
  produces behavior other than "cookie ignored", the golden records reality and
  the finding goes in the PR body as input to #646.
- **Golden review fatigue.** ~14 new files, one very large. Reviewers will be
  tempted to skim. The PR body should call out which goldens encode a
  non-obvious contract (dispatch, CORS preflight, error envelopes) and which are
  mechanical.

## Acceptance criteria

- All wire-matrix cases above are present and green locally with docker Postgres,
  and green in CI.
- Golden files committed, individually reviewed, and reviewable in the PR diff.
- Phase A and B tests untouched and green; total suite around 78 tests.
- `docs/testing.md` documents the suite, the seam, and the golden-freeze rule.
- No production source file is modified.
