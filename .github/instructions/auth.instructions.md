---
applyTo: "apps/auth/**,packages/auth/**,packages/sso/**,packages/sso-next/**,apps/*/proxy.ts,apps/*/src/proxy.ts,apps/*/src/lib/auth/**,packages/api/src/shared.ts"
---

# Auth, sessions, SSO, tokens

Human-owned security work (`docs/AI_GUARDRAILS.md`). Review adversarially and
assume the client is hostile.

## Tokens and sessions

- Verify with `jwtVerify` (or the shared `verifyAccessToken`), pinning the
  algorithm and issuer. Never trust a decoded payload or the mere presence of
  a cookie or `exp`. `jwtVerify` accepts a token with no `exp`; pass
  `requiredClaims: ["exp"]`.
- Bearer verifiers must check `token_use`. ID tokens share keys and issuer
  with access tokens and are not credentials.
- Never copy roles or other privilege claims from client-supplied data
  (session `update()` payloads, cookies, headers) into a token. Re-read them
  from the DB.
- A fix for forged or over-privileged tokens must also invalidate tokens
  already issued.
- Fail closed when the user is missing or a lookup throws.
- A JWKS or auth-server outage never authenticates a request, but it is
  **non-destructive**: no forced logout and no cookie clearing on a transient
  error.
- The issuer and JWKS location must match what relying parties compute (the
  bare auth origin and `/.well-known/jwks.json`). Pin that with a test that
  verifies a real token.
- Classify `jose` errors by `err.code`, not `name` or message (minification
  breaks names).

## One-time secrets and codes

- Generate codes and secrets with `crypto.randomInt` / `randomBytes`, never
  `Math.random`. `randomInt`'s max is exclusive: a 6-digit code is
  `randomInt(100000, 1000000)`.
- Consume codes, auth codes and refresh tokens in one atomic statement
  (`UPDATE … WHERE <used>_at IS NULL RETURNING`, or `DELETE … RETURNING`) and
  reject an empty result.
- Reusing a rotated refresh token revokes every refresh token for that user
  and client. There is no grace window. Issued access tokens stay valid until
  they expire.
- Attempt budgets are shared by every entry point that accepts a code.
- Compare secrets in constant time (`constantTimeEqual`, or `timingSafeEqual`
  behind a length check).
- Store OAuth client secrets and codes hashed; show a generated secret once.
- Normalize emails identically at store and lookup (`trim().toLowerCase()`).

## Requests

- Validate redirect targets (`callbackUrl`, `returnTo`, `redirect_uri`,
  `post_logout_redirect_uri`):
  - Accept a same-origin relative path (`/x`, not `//x`), or a match against
    the client's registered URIs or origins.
  - Re-validate wherever the target is consumed.
  - `NextResponse.redirect` needs an absolute URL.
- Rate-limit keys use the proxy-appended (rightmost) `X-Forwarded-For` hop,
  never the leftmost, which the caller controls. In-memory limiters are
  per-instance.
- Unauthenticated endpoints that accept credentials, codes or identifiers:
  - Rate-limit them.
  - Return generic errors that never echo `err.message`.
  - Never reveal whether an account exists (`/api/check-user` is the one
    deliberate, rate-limited exception).
- Parse request bodies in `try`/`catch` (400 on bad JSON), then `safeParse`
  with Zod. No `as` casts on bodies.
- Encode every dynamic URL part with `encodeURIComponent`. Test with values
  containing `&`, `#` and `+`.
- Never log codes, tokens, emails, magic links or query strings.
- Browser storage is plaintext. Keep tokens, codes, phone numbers and
  emergency contacts out of it.

## Proxies and gates

- Use `proxy.ts`, not `middleware.ts`. Next finds it only beside the `app`
  directory (`src/proxy.ts` when the app is `src/app`); a misplaced file is
  silently never loaded.
- Dead-session paths (invalid token, failed refresh) return 401 or a
  redirect, never `NextResponse.next()`. The exception is a JWKS outage, which
  passes through to the point-of-use verifier.
- New public endpoints (health, status) are added to the proxy's public paths,
  with a test.
- Server-side checks enforce anything the UI gates. A disabled button is not
  a control.
- Dev-only auth providers are gated by a server-side runtime allowlist
  (`F3_CHANNEL`) that fails closed, never by a `NEXT_PUBLIC_*` build-time
  value.

## Tests

- Deny-path tests must discriminate:
  - Wrong value **and** missing value.
  - Same-length wrong key.
  - Revoked **and** expired.
  - Replayed token.
  - Each branch of the allowlist.
- Do not mock away `jose` or `@f3nation/sso` in the only test of a verifier.
