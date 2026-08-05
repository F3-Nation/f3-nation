# AI-Assisted Development Guide

> Guidance for AI coding agents (Claude, Copilot, Cursor, and others) and the
> developers driving them. The goal is to encode the conventions and secure
> patterns of this monorepo so AI-generated code is correct, safe, and consistent
> — and so we stop reintroducing the same classes of bugs.
>
> This is the **deep reference**. The canonical short-form entry point is the
> root [`AGENTS.md`](../AGENTS.md); each tool's pointer file (see
> [§ How AI tools load this guidance](#how-ai-tools-load-this-guidance)) routes
> here.

---

## How AI tools load this guidance

Different developers use different assistants. To keep one source of truth, this
repo uses the **`AGENTS.md` standard** as canonical and adds thin pointer files
so each tool resolves to the same content:

| Tool                     | Entry point it reads                         | What it contains                   |
| ------------------------ | -------------------------------------------- | ---------------------------------- |
| **All / standard**       | [`AGENTS.md`](../AGENTS.md) (root + per-app) | Canonical conventions              |
| **Claude** (Claude Code) | `CLAUDE.md`                                  | Pointer → `AGENTS.md` + this guide |
| **GitHub Copilot**       | `.github/copilot-instructions.md`            | Pointer → `AGENTS.md` + this guide |
| **Cursor**               | `.cursor/rules/*.mdc`                        | Pointer → `AGENTS.md` + this guide |

**Rule of thumb:** put durable guidance in `AGENTS.md` (or, for deep topics, in
`docs/` and link it). Keep the tool-specific pointer files thin so they never
drift. Per-app specifics live in that app's `AGENTS.md`
(e.g. [`apps/me/AGENTS.md`](../apps/me/AGENTS.md),
[`apps/auth/AGENTS.md`](../apps/auth/AGENTS.md)).

---

## Golden rules

1. **Authorize every endpoint, not just authenticate it.** "Is a user logged in"
   is not authorization. See [API authorization](#api-authorization).
2. **Never trust an ID from the request body.** Scope to the session subject or
   verify a role on the target resource.
3. **Credentials come from a CSPRNG, never `Math.random()`.**
4. **Never log or bake in secrets or PII.** Not to stdout, not into Docker
   layers, not into the repo.
5. **Assume multi-instance.** No in-memory rate limiters/locks/caches as the
   source of truth in production.
6. **Anything `NEXT_PUBLIC_*` is public.** It ships in the browser bundle.
7. **Validate at the boundary, then trust internally.** Zod-validate all
   external input; don't add defensive checks for impossible internal states.
8. **Make the smallest correct change.** Match existing patterns; don't refactor
   or add abstractions beyond what the task needs.

---

## API authorization

The API (`packages/api`, served via oRPC) defines procedure tiers in
[`packages/api/src/shared.ts`](../packages/api/src/shared.ts). Choose the
**most restrictive** tier that fits, and remember what each one actually
guarantees:

| Procedure                 | Guarantee                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `publicProcedure`         | No auth. Rate-limited only. Safe for truly public, read-only data.                                                                   |
| `protectedProcedure`      | A valid session/credential exists. **Does _not_ check what that user may touch.**                                                    |
| `editorProcedure`         | Caller has editor or admin role on **any** org. Resource-scoped auth (`checkHasRoleOnOrg`) is still required for specific resources. |
| `adminProcedure`          | Caller has admin role on **any** org. Resource-scoped auth still required.                                                           |
| `nationAdminProcedure`    | Caller has the nation-level admin role specifically.                                                                                 |
| `revalidateAuthProcedure` | Accepts either a valid `SUPER_ADMIN_API_KEY` header or a nation admin session. Used for cache revalidation.                          |
| `apiKeyProcedure`         | Accepts a valid API key (`x-api-key` header), either the super-admin key or a DB-registered key.                                     |

### The critical pitfall: `protectedProcedure` ≠ authorized

`protectedProcedure` only proves _someone_ is authenticated. It does **not**
prove the caller may act on the resource named in the input. If a handler takes a
`userId`, `orgId`, `eventId`, etc. from the input and acts on it without an
ownership or role check, **any** authenticated caller can act on **anyone's**
data (IDOR, CWE-639; PII exposure, CWE-200).

```ts
// ❌ WRONG — authenticated but not authorized.
// Any logged-in caller can write attendance for an arbitrary user.
createActual: protectedProcedure
  .input(z.object({ eventInstanceId: z.number(), userId: z.number() }))
  .handler(async ({ context: ctx, input }) => {
    await ctx.db.insert(schema.attendance).values({
      eventInstanceId: input.eventInstanceId,
      userId: input.userId, // <-- caller-supplied target, never verified
    });
  });
```

Fix with one of these, depending on intent:

```ts
// ✅ Self-only: ignore body userId, use the session subject.
const userId = ctx.session!.id;

// ✅ Or require a role on the target resource (resolve the org first).
const { success } = await checkHasRoleOnOrg({
  session: ctx.session,
  orgId: targetOrgId,
  roleName: "editor",
  db: ctx.db,
});
if (!success) throw new ORPCError("UNAUTHORIZED");
```

Use [`checkHasRoleOnOrg`](../packages/api/src/check-has-role-on-org.ts) — it
walks the org hierarchy (AO → region → … → nation) so a region admin is
authorized for its AOs. When you call it in a loop over many orgs, batch where
possible to avoid N+1 queries.

### Reads expose PII too

A `protectedProcedure` that returns `users.email`, `f3Name`, or other personal
data must scope to the session subject or a role on the org — otherwise any
authenticated caller can enumerate everyone's data. Treat read authorization with
the same rigor as writes.

### Public data without a browser credential

If a surface is genuinely public (e.g. the map), prefer making the specific read
endpoints `publicProcedure` over shipping an API key to the browser. A
`NEXT_PUBLIC_*` API key is extractable from the bundle and, because an API-key
session passes every `protectedProcedure`, it grants far more than the public
surface intends. Scope public access at the endpoint, not via a shared public
credential.

---

## Error handling

The rule lives in
[`AGENTS.md` § API Error Handling](../AGENTS.md#api-error-handling), which is
the canonical source and where any change to it belongs. This section is the
rationale and code-selection guidance that rule points back at.

Why it matters: oRPC only preserves the code, status, and message of a typed
[`ORPCError`](https://orpc.unnoq.com/docs/error-handling). Any other thrown
value (including a plain `throw new Error("...")`) is masked as an opaque 500
`INTERNAL_SERVER_ERROR`, and the original message is dropped before it reaches
the client. Concretely, this means:

- **Clients can't distinguish their own mistake from a server bug.** A
  missing required field and a database outage both come back as the same
  generic 500, so retry logic can't tell which errors are worth retrying.
- **The HTTP status code is wrong.** A validation failure should be a 4xx,
  not a 500 — 5xx rates are typically used as a server-health signal, and
  masked client errors pollute that signal with noise that isn't actionable.

```ts
// WRONG — becomes an opaque 500, message is dropped.
if (!input.regionId) throw new Error("Region is required");

// Client error — pick the code that matches why the request failed.
if (!input.regionId) {
  throw new ORPCError("BAD_REQUEST", { message: "Region is required" });
}
```

Pick the code by what actually went wrong, not by what's convenient:

| Situation                                             | Code                    | Status |
| ----------------------------------------------------- | ----------------------- | ------ |
| Missing/invalid input                                 | `BAD_REQUEST`           | 400    |
| Not signed in, or signed in without the required role | `UNAUTHORIZED`          | 401    |
| A referenced resource doesn't exist                   | `NOT_FOUND`             | 404    |
| An upstream/external call failed                      | `BAD_GATEWAY`           | 502    |
| Truly unexpected server state (should be unreachable) | `INTERNAL_SERVER_ERROR` | 500    |

Full list of codes and status mappings:
[oRPC error handling](https://orpc.dev/docs/openapi/error-handling).

**A missing row is only `NOT_FOUND` if the caller could have caused it.** Ask
where the lookup key came from. A caller-supplied id that matches nothing is
`NOT_FOUND` (e.g. `updateAO` in `packages/api/src/lib/ao-handlers.ts`). But when
the key is constrained at the boundary — a `z.enum`, a literal, a value derived
from the session — the caller cannot produce a miss, so a miss means our own data
is wrong and it is `INTERNAL_SERVER_ERROR`. The role lookup in
[`packages/api/src/router/api-key.ts`](../packages/api/src/router/api-key.ts) is
the reference case: `roleName` is `z.enum(["editor", "admin"])`, so an unresolved
role means the `roles` table is missing its seeded rows, not that the client
asked for something that doesn't exist. Returning 404 there would blame the
caller for a seeding failure.

**On `UNAUTHORIZED` vs `FORBIDDEN`.** Strict HTTP semantics reserve 401 for
"unauthenticated" and 403 for "authenticated but not permitted". This codebase
does not split them that way: `UNAUTHORIZED` covers both. Every procedure
wrapper in [`packages/api/src/shared.ts`](../packages/api/src/shared.ts)
(`protectedProcedure`, `editorProcedure`, `adminProcedure`,
`nationAdminProcedure`, `revalidateAuthProcedure`) throws `UNAUTHORIZED` on a
role failure, and handler-level permission checks match — e.g. the region and
approval gates in `packages/api/src/router/request.ts`. Raw `UNAUTHORIZED`
throws outnumber `FORBIDDEN` by more than an order of magnitude.

Follow that convention in new code so clients need only one branch for "you
can't do this". **Matching the surrounding code here is not a finding** — do not
file or "fix" an `UNAUTHORIZED` permission check as a miscoded error. If the
split is ever worth adopting, it is a deliberate repo-wide migration (every
wrapper, plus the clients that branch on the code), not a per-PR cleanup.

A lint failure from the enforcing rule means the error needs a real
`ORPCError` code — not a suppression.

### Never bare-rethrow in a `catch`

`throw error` is an `Identifier`, so no AST rule can see whether the value is an
`ORPCError` — the lint rule cannot catch this one. A raw DB or driver fault
rethrown that way reaches oRPC untyped and is masked as an opaque 500 with its
cause lost. Guard, log, then wrap:

```ts
} catch (error) {
  if (error instanceof ORPCError) throw error; // already typed and client-safe
  logError("api.<area>.<outcome>", { ...safeCtx }, error);
  throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Generic message" });
}
```

The `instanceof` guard is load-bearing wherever the same `try` block throws its
own `ORPCError`s — without it, wrapping downgrades a typed 4xx into a generic 500. Keep the wrapped message generic (never interpolate the caught error, which
can carry table names, constraint names, or PII) and keep PII out of the log
context. Where classifiable, map the specific cause first: a duplicate-email
violation is a `BAD_REQUEST`, not a 500.

## Authentication & tokens

- **CSPRNG only** for OTPs, verification tokens, session tokens, nonces, API
  keys: `crypto.randomInt`, `crypto.randomBytes`, `crypto.getRandomValues`.
  Never `Math.random()`.
- **Verify JWTs, don't just decode them.** Validate signature with the
  algorithm allow-list (`RS256`), `issuer`, and `audience`/`client_id` against
  the JWKS. Decoding the payload (e.g. `parseAccessTokenPayload`) is for reading
  claims _after_ verification — never as the trust boundary. Avoid designs where
  a single middleware is the _only_ verifier for many handlers; if you rely on
  that, make the coupling explicit and tested.
- **OAuth/OIDC:** enforce PKCE and reject `plain`; validate `state`/`nonce`;
  allow-list redirect URIs (no open redirect); rate-limit `revoke`/`userinfo`.
- **Refresh-token rotation:** if the server single-uses (delete-on-use) refresh
  tokens, the client must **not** refresh concurrently per-request, or
  simultaneous requests at expiry will race, redeem the same token, and force
  logouts. Either give rotation a short grace window with chain-linking on the
  server, or single-flight the refresh on the client. See
  [`apps/auth/AGENTS.md`](../apps/auth/AGENTS.md) and the `me`/`admin` middleware.
- **MFA / email codes in local dev** are captured by Mailpit / Ethereal — see
  [`docs/QA_LOCAL_AUTH.md`](QA_LOCAL_AUTH.md). Don't disable verification to make
  flows pass; drive them properly.

---

## Secrets & sensitive data

- **Never log** tokens, passwords, OTPs, full `Authorization` headers, raw OAuth
  account objects, or PII. On Cloud Run, stdout goes to Cloud Logging (CWE-532).
  Avoid hardcoded `LOG = true` debug flags; gate verbose logging behind an env
  var and keep credentials out of it entirely.
- **Never bake secrets into Docker images.** Don't `COPY` a populated `.env` into
  the runner stage and don't `echo` token values during the build. Use build
  secrets / runtime injection (GCP Secret Manager surfaced via Cloud Run env vars, not baked layers).
- **No real PII in the repo** — seed scripts, fixtures, and tests use synthetic
  data (e.g. `dev-admin@f3local.dev`), never real members' emails. The repo is
  public.
- **Env access:** read configuration through the validated env schema
  (`@acme/env`), not raw `process.env`, so missing/invalid config fails fast.
  Store secrets in per-directory `.env` files; never commit them.

---

## Web / HTTP security

- **Set security headers** in each app's `next.config.*` (or middleware): CSP,
  HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
  `Permissions-Policy`, and framing controls. Use `X-Frame-Options: DENY` /
  `frame-ancestors 'none'` for auth/admin surfaces; the map is intentionally
  embeddable and needs a `frame-ancestors` **allow-list**, not a blanket deny.
  Disable `poweredByHeader`.
- **Sanitize untrusted HTML.** `dangerouslySetInnerHTML` must run through
  DOMPurify; escape all user input interpolated into email templates.
- **File uploads:** authenticate the endpoint, enforce a size cap (don't
  `await file.arrayBuffer()` on unbounded input), derive Content-Type/extension
  from a server-side allow-list (not attacker-controlled `file.type`), and encode
  object paths to prevent overwrite/traversal. The admin upload path is the
  reference implementation.

---

## Data layer

- **Connection pooling for Cloud Run.** The shared client lives in
  [`packages/db/src/utils/functions.ts`](../packages/db/src/utils/functions.ts).
  Configure bounded `max`, plus `connect_timeout` and `idle_timeout`, sized so
  `instances × max` stays under the Postgres/PgBouncer ceiling. Match the driver
  to the pooler: with **PgBouncer transaction pooling**, set `prepare: false`
  (prepared statements break in that mode). Make SSL behavior explicit and
  environment-aware.
- **Migrations** (Drizzle, `packages/db`): generate and commit migrations; keep
  the journal consistent; run migrations as a **deploy step**, not during
  `docker build`. Use `pnpm db:pull` / `db:push` and `reset-test-db` per
  [`AGENTS.md`](../AGENTS.md).
- **Indexes & N+1:** add indexes for hot lookups and join foreign keys
  (especially role/permission tables). Avoid per-row queries inside `for await`
  loops — batch them.
- **Raw SQL** must be parameterized (Drizzle `sql` tagged templates bind
  params); never string-concatenate user input.

---

## Reliability in a multi-instance world

- Cloud Run autoscales. Anything kept in process memory — rate limiters, caches,
  locks, counters — is **per-instance**. For correctness across instances use a
  shared store (Redis/Upstash) or a DB-backed mechanism. In-memory is acceptable
  only as a best-effort optimization, and must be documented as such.
- Add timeouts to outbound calls; make webhook/handlers idempotent; paginate or
  bound any "return all" query.

---

## Pre-flight checklist for AI-generated changes

Before proposing a diff, confirm:

- [ ] New/!changed endpoints use the correct procedure tier and **authorize the
      specific resource** (no trusting body IDs).
- [ ] No `Math.random()` for anything credential-like.
- [ ] No secrets/PII added to logs, images, fixtures, or the repo.
- [ ] No `NEXT_PUBLIC_*` value grants server privileges.
- [ ] External input is Zod-validated; raw SQL is parameterized.
- [ ] No new in-memory-only state assumed to be global in production.
- [ ] Untrusted HTML sanitized; uploads bounded and typed server-side.
- [ ] Matches existing patterns; smallest reasonable change; no unrequested
      refactors, comments, or abstractions.
- [ ] `pnpm lint`, `pnpm typecheck`, and relevant tests pass; commit message has
      a valid scope.

---

## See also

- [`AGENTS.md`](../AGENTS.md) — canonical repo conventions.
- [`docs/AI_AUDIT_PLAYBOOK.md`](AI_AUDIT_PLAYBOOK.md) — how to audit the repo.
- [`apps/auth/AGENTS.md`](../apps/auth/AGENTS.md) — auth app specifics & local QA.
- [`apps/me/AGENTS.md`](../apps/me/AGENTS.md) — token-scoped client app pattern.
- [`docs/QA_LOCAL_AUTH.md`](QA_LOCAL_AUTH.md) — driving auth flows in local dev.
- [`docs/LOCAL_DEV_DOCKER.md`](LOCAL_DEV_DOCKER.md) — local environment setup.
