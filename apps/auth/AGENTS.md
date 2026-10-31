<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# F3 Auth -- Agent Guide

> Context for AI coding agents and QA-automation agents working with the F3 SSO server.

The two most useful things to know up front:

1. **In local development all outbound mail is caught by [Mailpit](https://mailpit.axllent.org/), started for you by `pnpm docker:up`.** Nothing leaves your machine, no SendGrid credentials are needed, and no real inbox has to be polled. Read messages at `$MAILPIT` (default `http://localhost:8025`) -- web UI for humans, REST API on the same port for agents.
2. **Sign-in completes via NextAuth's standard CSRF + Credentials callback flow.** A `curl` of the magic link does **not** complete sign-in (the verify page is a client component that calls `signIn()` from a `useEffect`). For headless automation, POST `email + code` to `/api/auth/callback/email-mfa` with a CSRF token. See the recipe below.

If you only read this section, you have enough to drive the auth flow programmatically. The rest of this doc is the recipe.

---

## Architecture summary

`apps/auth` is the F3 OAuth 2.0 / OpenID Connect server. Other apps in the monorepo (apps/me, apps/map, pax-vault, the-codex, ...) authenticate users by redirecting to `apps/auth`, which authenticates the user via **email-based MFA** (a 6-digit code plus a magic link, both delivered in the same email), then redirects back with an authorization code that the calling app exchanges for tokens.

The MFA logic lives in `apps/auth/src/lib/email-mfa.ts`. There is **no environment branching in the transport** -- it is a single nodemailer transport built from the `EMAIL_SERVER` connection string, so which mail server receives a message is purely a matter of configuration:

| Environment | `EMAIL_SERVER`                                | Where the mail lands                                               |
| ----------- | --------------------------------------------- | ------------------------------------------------------------------ |
| Local dev   | `smtp://localhost:1025` (from `.env.example`) | Mailpit -- read it at `$MAILPIT` (default `http://localhost:8025`) |
| Production  | SendGrid SMTP credentials                     | The recipient's real inbox                                         |

`smtp://localhost:1025` is the default in `apps/auth/.env.example` (a slotted checkout gets `F3_MAILPIT_SMTP_PORT` instead), and port 1025 is Mailpit's SMTP listener in `docker-compose.yml`. **Nothing is logged when a message is sent** -- retrieve mail from Mailpit, never from the auth server's stdout.

---

## Email contents (deterministic)

The dev email (`apps/auth/src/lib/email-mfa.ts`) renders this HTML:

```html
<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
  <h2>Your verification code</h2>
  <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; ...">
    123456
  </p>
  <p>This code expires in 10 minutes.</p>
  <p>Or click the link below to sign in automatically:</p>
  <p>
    <a href="${authUrl}/login/email/verify?email=...&code=123456"
      >Sign in to F3 Nation</a
    >
  </p>
  <p style="color: #666; font-size: 12px;">
    If you didn't request this, you can safely ignore this email.
  </p>
</div>
```

The two extraction targets for an automation agent are:

1. **6-digit code** -- present twice: in the `<p style="...letter-spacing: 8px;">` element and as the `code=` parameter of the magic link. The `code=` parameter is the easier grep target. Use this for headless flows: feed it to `/api/auth/callback/email-mfa` with a CSRF token (recipe below). **This is the canonical path for autonomous QA.**
2. **Magic link** -- `<a href="${authUrl}/login/email/verify?email=<urlencoded>&code=<6 digits>">...</a>`. The page at that URL is a **client component** -- it calls `signIn("email-mfa", ...)` from a React `useEffect`. A raw `curl` GET only returns HTML and never executes the sign-in. Use this only when driving a JS-capable browser (e.g. CDP).

Both are stable across dev runs. Neither depends on parsing arbitrary email-rendering quirks.

---

## Rate limiting

`/api/verify-email` enforces a 10-requests-per-minute-per-IP cap **in production only**. Under `NODE_ENV !== "production"` (local dev, CI) the limit is bypassed -- with the default `.env.example` config, mail is caught by Mailpit, so there is no real inbox to bomb. The bypass keys on `NODE_ENV`, not on `EMAIL_SERVER`, so it is only safe while `EMAIL_SERVER` points at Mailpit (see [Production safety](#production-safety)). Preview images run with `NODE_ENV=production`, so the cap applies there (see [`docs/PREVIEW_AUTH.md`](../../docs/PREVIEW_AUTH.md)). This bypass is what makes parallel agent QA viable without 429s.

`/api/auth/callback/email-mfa` (the NextAuth Credentials POST endpoint) has no application-level rate limit in any environment.

---

## Recipe -- Autonomous QA against a local SSO flow

This is the canonical recipe for an AI agent (or a CI script) driving an authenticated user-facing flow end to end without a human or a real inbox.

### 0. Bring up the stack

From the monorepo root:

```bash
pnpm dev   # turbo dev --parallel -- starts apps/auth, apps/api, apps/me, apps/map, ...
```

Or run only what you need. For an apps/me QA run you need at least `apps/auth` (default `:3004`) and `apps/api` (default `:3001`) plus a Postgres DB.

Make sure the Docker services are up, since Mailpit is the only place sent mail can be read:

```bash
pnpm docker:up
# Slotted checkout (`local:setup --slot N`)? Load its ports first: set -a; . ./.env; set +a
MAILPIT="http://localhost:${F3_MAILPIT_UI_PORT:-8025}"
AUTH="http://localhost:${F3_AUTH_PORT:-3004}"
ME="http://localhost:${F3_ME_PORT:-3003}"
curl -sf "$MAILPIT"/api/v1/messages >/dev/null && echo "Mailpit is up"
```

### 1. Get a CSRF token

NextAuth requires a CSRF token on every Credentials POST. Fetch it once and reuse the cookie jar:

```bash
CSRF=$(curl -sc /tmp/jar $AUTH/api/auth/csrf | jq -r .csrfToken)
echo "csrfToken: $CSRF"
```

The cookie jar `/tmp/jar` now contains the `next-auth.csrf-token` cookie that pairs with `$CSRF`.

### 2. Trigger the send

Either drive a calling app's login route...

```bash
# example: apps/me
curl -sb /tmp/jar -L "$ME/api/auth/login?returnTo=/profile" >/dev/null
```

...or hit the auth server's `POST /api/verify-email?action=send` endpoint directly with `{ email }` and skip the UI:

```bash
curl -sb /tmp/jar -X POST -H 'Content-Type: application/json' \
  -d '{"email":"qa-bot@f3nation.test"}' \
  "$AUTH/api/verify-email?action=send"
```

Either way, `sendEmailCode()` runs and a new message appears in Mailpit.

### 3. Pull the code from the newest Mailpit message

Mailpit's REST API lists messages newest-first, so read the newest ID and grep the `code=` parameter out of its HTML body:

```bash
ID=$(curl -s "$MAILPIT"/api/v1/messages | jq -r '.messages[0].ID')
CODE=$(curl -s "$MAILPIT/api/v1/message/$ID" \
  | jq -r '.HTML' \
  | grep -oE 'code=[0-9]{6}' | head -1 | cut -d= -f2)
echo "MFA code: $CODE"
```

Codes are single-use, and each new send invalidates the previous code for that address -- so reusing a stale message is the most common silent failure. The cheapest guard is to empty the mailbox before triggering the send, which makes "newest message" unambiguous:

```bash
curl -s -X DELETE "$MAILPIT"/api/v1/messages
```

### 4. POST the code to NextAuth's Credentials callback

```bash
curl -sb /tmp/jar -c /tmp/jar -L -X POST \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "email=qa-bot@f3nation.test" \
  --data-urlencode "code=$CODE" \
  --data-urlencode "callbackUrl=$AUTH/" \
  --data-urlencode "json=true" \
  $AUTH/api/auth/callback/email-mfa
```

NextAuth runs the `email-mfa` provider's `authorize()` callback (see `apps/auth/src/lib/auth-options.ts`), which calls `verifyEmailCode(email, code)`. On success the response sets the session cookie (`next-auth.session-token` in dev) in `/tmp/jar`. The `json=true` form field makes the callback respond with JSON instead of an HTTP redirect, which is easier to assert on.

The session cookie is named `next-auth.session-token` in dev and `__session` in production (see `auth-options.ts`).

### 5. Continue the test

You now have a logged-in session in the cookie jar. Continue any OAuth callback chain on the calling app with the same jar:

```bash
# Follow the calling-app callback to mint that app's session
curl -sb /tmp/jar -c /tmp/jar -L "$ME/api/auth/callback?..." >/dev/null

# Use the session
curl -sb /tmp/jar $ME/api/auth/me
# -> {"user":{"id":...,"email":"qa-bot@f3nation.test",...}}
```

### Form mode -- submit the code through the verify page UI (browser automation / CDP)

When you're driving a real browser and want to exercise the verify form's UI itself:

```bash
# Drive the browser to /login/email, submit the email
browser_navigate "$AUTH/login/email"
browser_fill "[name=email]" "qa-bot@f3nation.test"
browser_click "[type=submit]"

# Pull the code (step 3 above) and submit it to the form
browser_fill "[name=code]" "$CODE"
browser_click "[type=submit]"
```

Or exercise the magic link in a JS-capable browser:

```bash
MAGIC_LINK=$(curl -s "$MAILPIT/api/v1/message/$ID" \
  | jq -r '.HTML' \
  | grep -oE "$AUTH/login/email/verify\?[^\"]+" | head -1)
browser_navigate "$MAGIC_LINK"
# -> page renders, useEffect fires signIn("email-mfa", ...), session cookie is set
```

Form/magic-link modes are slower and only needed if you specifically want to QA the verify-page UI or assert that the magic-link auto-submit still works.

---

## Failure modes worth knowing

- **Mailpit's message list is empty.** Either the send never happened, or the mail went somewhere else. Check that Mailpit is running (`docker ps | grep mailpit`, or `pnpm docker:up`) and that `EMAIL_SERVER` in `apps/auth/.env` is `smtp://localhost:1025` -- a stale value pointed at SendGrid will fail or, worse, deliver to a real address.
- **You extracted a code but it's rejected.** You probably read a stale message. Codes are single-use and each send invalidates the prior one, so `.messages[0]` may be a previous run's email. Empty the mailbox (`curl -s -X DELETE "$MAILPIT"/api/v1/messages`) before triggering the send.
- **CSRF callback returns 200 but no session cookie is set.** `verifyEmailCode()` returned null -- likely the user doesn't exist (new user flow), the code was already consumed, or the code expired. Codes have a 10-minute TTL (`CODE_TTL_MINUTES` in `email-mfa.ts`). Each new send invalidates older codes for the same email. To unblock new-user testing, seed the user before driving the flow.
- **CSRF callback redirects to `/login?error=...`.** Add `--data-urlencode "json=true"` to the curl invocation; without it, NextAuth returns an HTTP redirect instead of JSON, and `curl -L` may follow that redirect into the error page. With JSON mode you can inspect the body directly.
- **Magic link "works" in a browser but `curl` gets HTML and no session.** Expected -- `/login/email/verify` is a client component. Use the CSRF + callback recipe instead. If you must exercise the magic link, drive a real browser.
- **You see emails for the wrong recipient.** Mailpit is a shared local mailbox -- every address delivers into the same inbox, so a parallel agent's message can be `.messages[0]`. Filter by recipient (`/api/v1/search?query=to:qa-bot@f3nation.test`) or use a distinct address per run.

---

## Production safety

Because the transport is just `EMAIL_SERVER`, local safety comes from configuration rather than a code branch: `apps/auth/.env.example` ships `smtp://localhost:1025`, so a default local checkout can only ever deliver into Mailpit. Nothing is logged on send, so no message content or recipient reaches stdout in any environment.

The one thing to be careful about is the inverse of the old risk: a local `.env` that carries real SendGrid credentials **will** send real email to real addresses, because nothing gates it on `NODE_ENV`. Keep `EMAIL_SERVER` pointed at Mailpit locally.

`/api/verify-email` enforces its 10-requests-per-minute-per-IP cap only when `NODE_ENV === "production"`; production traffic remains capped.

---

## Security rules

These apply to `apps/auth`, `packages/auth`, `packages/sso*`, the app
proxies (`proxy.ts`) and session resolution in `packages/api/src/shared.ts`.
All of it is human-owned security work (`docs/AI_GUARDRAILS.md`): assume the
client is hostile.

### Tokens and sessions

- Verify with the shared `verifyAccessToken` (it pins RS256 and the issuer
  and rejects a token with no `exp`), or with `jwtVerify` pinning the
  algorithm and issuer and passing `requiredClaims: ["exp"]` (`jwtVerify`
  alone accepts a token with no `exp`). Never trust a decoded payload or the
  mere presence of a cookie.
- Bearer verifiers check `token_use`: ID tokens share keys and issuer with
  access tokens and are not credentials.
- Never copy roles or other privilege claims from client-supplied data
  (session `update()` payloads, cookies, headers) into a token; re-read them
  from the DB. A fix for forged or over-privileged tokens also invalidates
  tokens already issued.
- Fail closed when the user is missing or a lookup throws. A JWKS or
  auth-server outage never authenticates a request, but it is
  non-destructive: no forced logout and no cookie clearing on a transient
  error.
- Each trusted issuer's `iss` and JWKS location match what relying parties
  compute (that issuer's bare origin and `/.well-known/jwks.json`), pinned by
  a test that verifies a real token.
- Classify `jose` errors by `err.code`, not `name` or message (minification
  breaks names).

### One-time secrets and codes

- Generate codes and secrets with `crypto.randomInt` / `randomBytes`, never
  `Math.random`. `randomInt`'s max is exclusive: a 6-digit code is
  `randomInt(100000, 1000000)`.
- Consume codes, auth codes and refresh tokens in one atomic statement
  (`UPDATE … WHERE <used>_at IS NULL RETURNING`, or `DELETE … RETURNING`) and
  reject an empty result.
- Reusing a rotated refresh token revokes every refresh token for that user
  and client, including the replacement just issued; there is no grace
  window. Issued access tokens stay valid until they expire. Clients must
  serialize refresh calls for a token, or concurrent refreshes force a
  re-login.
- Attempt budgets are shared by every entry point that accepts a code. In
  Better Auth (`src/lib/better-auth.ts`), a new endpoint that checks an
  emailed code joins `OTP_VERIFYING_PATHS`. Its plugin order (`emailOTP`,
  `jwt`, `oauthProvider`, the claim-shape plugin, then `bearer`) is
  load-bearing.
- Compare secrets in constant time (`constantTimeEqual`, or `timingSafeEqual`
  behind a length check). Store OAuth client secrets and email OTP codes
  hashed, and show a generated secret once.
- Normalize emails identically at store and lookup (`trim().toLowerCase()`).

### Requests

- Validate redirect targets (`callbackUrl`, `returnTo`, `redirect_uri`,
  `post_logout_redirect_uri`): accept a same-origin relative path (`/x`, not
  `//x`) or a match against the client's registered URIs or origins, and
  re-validate wherever the target is consumed. `NextResponse.redirect` needs
  an absolute URL.
- Rate-limit keys use the proxy-appended (rightmost) `X-Forwarded-For` hop,
  never the leftmost, which the caller controls. In-memory limiters are
  per-instance. Better Auth's built-in limiter doesn't use our helper; it needs
  `advanced.ipAddress` (`trustedProxies` or `ipAddressHeaders`) to key on the
  real client IP.
- Unauthenticated endpoints that accept credentials, codes or identifiers are
  rate-limited or attempt-budgeted (see the attempt-budget rule above), return
  generic errors that never echo `err.message`, and never reveal whether an
  account exists (`/api/check-user` is the one deliberate, rate-limited
  exception).
- Parse request bodies in `try`/`catch` (400 on bad JSON), then `safeParse`
  with Zod; no `as` casts on bodies.
- Encode every dynamic URL part with `encodeURIComponent`, and test with
  values containing `&`, `#` and `+`.
- Never log codes, tokens, emails, magic links or query strings. Keep tokens,
  codes, phone numbers and emergency contacts out of browser storage.

### Proxies and gates

- Use `proxy.ts`, not `middleware.ts`. Next finds it only beside the `app`
  directory (`src/proxy.ts` when the app is `src/app`); a misplaced file is
  silently never loaded.
- Dead-session paths (invalid token, failed refresh) return 401 or a
  redirect, never `NextResponse.next()`. The exception is a JWKS outage, which
  passes through to the point-of-use verifier.
- New public endpoints (health, status) join the proxy's public paths, with a
  test.
- Enforce on the server anything the UI gates; a disabled button is not a
  control.
- Dev-only auth (a dev sign-in provider, the API's mock session) is gated on
  the server by a channel allowlist that fails closed, never by a
  `NEXT_PUBLIC_*` value alone: Next.js freezes one into the bundle when it is
  set at build. Next.js-only code reads `F3_CHANNEL`. `packages/api/src/shared.ts`
  also runs in `apps/api`, which has no `F3_CHANNEL`, so it reads
  `NEXT_PUBLIC_CHANNEL` and also requires `NODE_ENV === "development"`, which
  no deployed build has.

### Tests

- Registration stays non-submittable after confirmed account creation, including
  while successful navigation leaves the form mounted. Preserve pre-creation
  retries and post-creation sign-in recovery; test clicks and native form
  submission for both auth backends.
- Deny-path tests discriminate: wrong value **and** missing value, a
  same-length wrong key, revoked **and** expired, a replayed token, and each
  branch of an allowlist.
- Don't mock away `jose` or `@f3nation/sso` in the only test of a verifier.

---

## See also

- [`apps/auth/README.md`](README.md) -- full architecture, deployment, OAuth client registration
- [`docs/LOCAL_DEV_DOCKER.md`](../../docs/LOCAL_DEV_DOCKER.md) -- bringing up Mailpit and the rest of the Docker stack
- [`apps/auth/src/lib/email-mfa.ts`](src/lib/email-mfa.ts) -- the source of truth for what gets emailed
- [`apps/auth/src/lib/auth-options.ts`](src/lib/auth-options.ts) -- the NextAuth Credentials provider that the callback flow drives
