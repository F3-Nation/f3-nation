---
applyTo: "apps/auth/**,packages/auth/**,packages/sso/**,packages/sso-next/**,apps/*/proxy.ts,apps/*/src/proxy.ts,apps/*/src/lib/auth/**,packages/api/src/shared.ts"
---

# Auth, sessions, SSO, tokens

Any change here is human-owned security work (`docs/AI_GUARDRAILS.md`). Review
it adversarially and assume the client is hostile.

## Tokens and sessions

- Verify signatures with `jwtVerify`, pinning the algorithm and issuer.
  Never trust a decoded payload or the mere presence of a cookie or `exp`.
- Require the `exp` claim.
- Treat claims from `decodeJwt` as `unknown` until type-checked.
- Bearer verifiers must check the token type claim. ID tokens share keys
  with access tokens and are not credentials.
- Never copy roles or other privilege claims from client-supplied data
  (session `update()` payloads, cookies, headers) into a token. Re-read them
  from the DB.
- A fix for forged or over-privileged tokens must also invalidate tokens
  already issued.
- Fail closed when the user is missing or a lookup throws.
- A JWKS or auth-server outage fails closed but is **non-destructive**: no
  forced logout and no cookie clearing on a transient error. Log which issuer
  failed.
- The issuer and JWKS location must match what relying parties compute (the
  bare auth origin and `/.well-known/jwks.json`). Pin that contract with a
  test that verifies a real token.
- Classify `jose` errors by `err.code`, not `name` or message (minification
  breaks names).

## One-time secrets and codes

- Generate codes and secrets with `crypto.randomInt` / `randomBytes`, never
  `Math.random`. `randomInt`'s max is exclusive; a 6-digit range is
  `randomInt(100000, 1000000)`.
- Consume codes, auth codes and refresh tokens with one conditional
  statement (`… WHERE consumed_at IS NULL RETURNING`), and reject an empty
  result.
- Refresh-token reuse revokes the whole family. There is no grace window.
- Attempt budgets are shared by every entry point that accepts a code.
- Compare secrets with the constant-time helpers (`constantTimeEqual`,
  `timingSafeEqual` with a length guard).
- Store client secrets and API keys hashed, and show the plaintext once.
- Normalize emails identically at store and lookup (`trim().toLowerCase()`).

## Requests

- Validate redirect targets (`callbackUrl`, `returnTo`, `redirect_uri`,
  `post_logout_redirect_uri`):
  - Accept a same-origin relative path (`/x`, not `//x`), or an exact match
    against the client's registered URIs.
  - Re-validate wherever the target is consumed.
  - Never use a relative URL with `NextResponse.redirect`.
- Rate-limit keys use the proxy-appended (rightmost) `X-Forwarded-For` hop,
  never the leftmost, which the caller controls. In-memory limiters are
  per-instance.
- Unauthenticated endpoints:
  - Rate-limit them.
  - Return generic errors that never echo `err.message`.
  - Never reveal whether an account exists.
- Parse request bodies in `try`/`catch` (400 on bad JSON), then `safeParse`
  with Zod. Never use `as` casts on bodies.
- Encode every dynamic URL part with `encodeURIComponent`. Test with values
  containing `&`, `#` and `+`.
- Log fixed event names with numeric ids only. Never log codes, tokens,
  emails, magic links, or query strings.
- Never write PII to `sessionStorage` or `localStorage`.

## Proxies and gates

- Next middleware must be `proxy.ts`, where Next discovers it (`src/` when the
  app uses `src/app`). A misplaced file is silently never loaded.
- Every dead-session path returns 401 or a redirect, never
  `NextResponse.next()`.
- New public endpoints (health, status) are added to the proxy's public paths,
  with a test.
- Server-side checks enforce anything the UI gates. A disabled button is not
  a control.
- Dev-only providers and mock sessions are gated by a server-side runtime
  allowlist (`F3_CHANNEL`) that fails closed, never by a `NEXT_PUBLIC_*`
  build-time value.

## Tests

- Every auth change ships deny-path tests that discriminate:
  - Wrong value **and** missing value.
  - Same-length wrong key.
  - Revoked **and** expired.
  - Replayed token.
  - Each branch of the allowlist.
- Assert the specific error code.
- Do not mock away `jose`/`@acme/sso` in the only test of a verifier.
