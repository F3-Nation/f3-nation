# better-auth-spike

**Throwaway, isolated proof-of-concept for #876 Phase 1 — not wired into any real app, not deployed, no real traffic.**

## Purpose

Issue #876 ("migrate apps/auth's hand-rolled OAuth2/OIDC server to Better Auth")
Phase 1 asks: can Better Auth's `@better-auth/oauth-provider` + `jwt` plugins issue
an access token whose claim shape exactly satisfies
[`packages/sso/src/token-verification.ts`](../sso/src/token-verification.ts)'s
`AccessTokenPayload`, and does the frozen golden-file shape pinned by
[`apps/api/characterization/auth/jwt.char.test.ts`](../../apps/api/characterization/auth/jwt.char.test.ts)
survive unchanged?

This package answers exactly that, in isolation:

- `src/auth-instance.ts` configures a `betterAuth()` instance using the
  in-memory adapter (no real database, no `@acme/db`, no `drizzle-orm` —
  deliberately, to keep this package's dependency graph from ever touching
  the real apps' shared `drizzle-orm` pin) with the OAuth provider plugin and
  a `jwt` plugin configured to shape its payload to match
  `signAccessToken`'s exact claim set.
- `src/auth-instance.test.ts` drives a real authorization-code + PKCE flow
  against that instance, decodes the resulting access token, and asserts its
  claim set / header / `sub` encoding against the same expectations
  `jwt.char.test.ts`'s "fixture token shape" tests pin — without touching or
  importing that file, so there is zero risk of silently loosening the real
  golden file.

## Why a separate package instead of adding this to `apps/auth`

`apps/auth` is the real, running production auth service. Better Auth's
adapter packages pull in a `drizzle-orm` version that doesn't match the
version the rest of the monorepo is pinned to via the shared catalog —
installing it directly into `apps/auth`'s manifest broke typecheck
repo-wide. Isolating the spike here means a bad dependency resolution can
only ever break this package's own typecheck, never the real auth service
or anything else in the repo. Nothing here imports from or is imported by
`apps/auth`.

## What happens to this package

Once Phase 1's parity question is answered, this package is deleted. It is
not a step toward the eventual Phase 3 integration point (which lives inside
`apps/auth` once claim parity is proven and Phases 2–4 get human sign-off
per `docs/AI_GUARDRAILS.md`) — it exists only to answer the parity question
safely.
