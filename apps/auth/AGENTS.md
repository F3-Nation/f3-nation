# F3 Auth -- Agent Guide

> Context for AI coding agents and QA-automation agents working with the F3 SSO server.

The two most useful things to know up front:

1. **In local development the auth server already uses [Ethereal](https://ethereal.email/) -- a free, no-auth SMTP relay that publishes a public preview URL for every message.** No real inbox is involved, no SendGrid credentials are needed, and no email account has to be polled.
2. **Sign-in completes via NextAuth's standard CSRF + Credentials callback flow.** A `curl` of the magic link does **not** complete sign-in (the verify page is a client component that calls `signIn()` from a `useEffect`). For headless automation, POST `email + code` to `/api/auth/callback/credentials` with a CSRF token. See the recipe below.

If you only read this section, you have enough to drive the auth flow programmatically. The rest of this doc is the recipe.

---

## Architecture summary

`apps/auth` is the F3 OAuth 2.0 / OpenID Connect server. Other apps in the monorepo (apps/me, apps/map, pax-vault, the-codex, ...) authenticate users by redirecting to `apps/auth`, which authenticates the user via **email-based MFA** (a 6-digit code plus a magic link, both delivered in the same email), then redirects back with an authorization code that the calling app exchanges for tokens.

The MFA logic lives in `apps/auth/src/lib/email-mfa.ts`. The transport switches on `NODE_ENV`:

| `NODE_ENV`    | SMTP transport                                                       | Preview URL?             | Real inbox involved? |
| ------------- | -------------------------------------------------------------------- | ------------------------ | -------------------- |
| `production`  | `smtp.sendgrid.net:587` (SendGrid)                                   | No                       | Yes                  |
| anything else | `smtp.ethereal.email:587` (Ethereal test account, fresh per process) | Yes -- printed to stdout | No                   |

In dev, every send is followed by:

```ts
console.log("Preview email:", previewUrl);
```

...where `previewUrl` is something like `https://ethereal.email/message/abc123...`. That URL is **publicly accessible without authentication**, returns the email's HTML body, and contains both the 6-digit code and the magic link.

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

1. **6-digit code** -- the `<p style="...letter-spacing: 8px;">` element. Use this for headless flows: feed it to `/api/auth/callback/credentials` with a CSRF token (recipe below). **This is the canonical path for autonomous QA.**
2. **Magic link** -- `<a href="${authUrl}/login/email/verify?email=<urlencoded>&code=<6 digits>">...</a>`. The page at that URL is a **client component** -- it calls `signIn("email-mfa", ...)` from a React `useEffect`. A raw `curl` GET only returns HTML and never executes the sign-in. Use this only when driving a JS-capable browser (Playwright, CDP).

Both are stable across dev runs. Neither depends on parsing arbitrary email-rendering quirks.

---

## Rate limiting

`/api/verify-email` enforces a 10-requests-per-minute-per-IP cap **in production only**. Under `NODE_ENV !== "production"` (local dev, CI, preview environments) the limit is bypassed -- the email transport is Ethereal, so there is no real inbox to bomb. This bypass is what makes parallel agent QA viable without 429s.

`/api/auth/callback/credentials` (the NextAuth Credentials POST endpoint) has no application-level rate limit in any environment.

---

## Recipe -- Autonomous QA against a local SSO flow

This is the canonical recipe for an AI agent (or a CI script) driving an authenticated user-facing flow end to end without a human or a real inbox.

### 0. Bring up the stack

From the monorepo root:

```bash
pnpm dev   # turbo dev --parallel -- starts apps/auth, apps/api, apps/me, apps/map, ...
```

Or run only what you need (see `docs/LOCAL_DEV_SETUP.md` for the minimum stack per app). For an apps/me QA run you need at least `apps/auth` (`:3004`) and `apps/api` (`:3001`) plus a Postgres DB.

Capture `apps/auth`'s stdout to a file you can grep later:

```bash
pnpm --filter f3-auth dev > /tmp/f3-auth.log 2>&1 &
echo $! > /tmp/f3-auth.pid
```

### 1. Get a CSRF token

NextAuth requires a CSRF token on every Credentials POST. Fetch it once and reuse the cookie jar:

```bash
CSRF=$(curl -sc /tmp/jar http://localhost:3004/api/auth/csrf | jq -r .csrfToken)
echo "csrfToken: $CSRF"
```

The cookie jar `/tmp/jar` now contains the `next-auth.csrf-token` cookie that pairs with `$CSRF`.

### 2. Trigger the send

Either drive a calling app's login route...

```bash
# example: apps/me
curl -sb /tmp/jar -L 'http://localhost:3003/api/auth/login?returnTo=/profile' >/dev/null
```

...or hit the auth server's `POST /api/verify-email?action=send` endpoint directly with `{ email }` and skip the UI:

```bash
curl -sb /tmp/jar -X POST -H 'Content-Type: application/json' \
  -d '{"email":"qa-bot@f3nation.test"}' \
  'http://localhost:3004/api/verify-email?action=send'
```

Either way, `sendEmailCode()` runs and the auth log gets a new `Preview email:` line.

### 3. Pull the code from the latest preview email

```bash
CODE=$(scripts/qa/extract-mfa-link.sh --code)
echo "MFA code: $CODE"
```

The helper enforces consume-once semantics by default: if the latest preview URL matches the one it returned last time (i.e., no fresh send happened), it exits non-zero with a clear error. That catches the most common silent failure mode -- retries that quietly reuse already-consumed codes. Pass `--allow-reuse` if you really want the same URL twice (rare).

### 4. POST the code to NextAuth's Credentials callback

```bash
curl -sb /tmp/jar -c /tmp/jar -L -X POST \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "email=qa-bot@f3nation.test" \
  --data-urlencode "code=$CODE" \
  --data-urlencode "callbackUrl=http://localhost:3004/" \
  --data-urlencode "json=true" \
  http://localhost:3004/api/auth/callback/credentials
```

NextAuth runs the `email-mfa` provider's `authorize()` callback (see `apps/auth/src/lib/auth-options.ts`), which calls `verifyEmailCode(email, code)`. On success the response sets the `next-auth.session-token` cookie in `/tmp/jar`. The `json=true` query param makes the callback respond with JSON instead of an HTTP redirect, which is easier to assert on.

The session cookie is named `next-auth.session-token` in dev and `__session` in production (see `auth-options.ts`).

### 5. Continue the test

You now have a logged-in session in the cookie jar. Continue any OAuth callback chain on the calling app with the same jar:

```bash
# Follow the calling-app callback to mint that app's session
curl -sb /tmp/jar -c /tmp/jar -L 'http://localhost:3003/api/auth/callback?...' >/dev/null

# Use the session
curl -sb /tmp/jar http://localhost:3003/api/auth/me
# -> {"user":{"id":...,"email":"qa-bot@f3nation.test",...}}
```

### Form mode -- submit the code through the verify page UI (Playwright/CDP)

When you're driving a real browser and want to exercise the verify form's UI itself:

```bash
# Drive the browser to /login/email, submit the email
playwright_navigate "http://localhost:3004/login/email"
playwright_fill "[name=email]" "qa-bot@f3nation.test"
playwright_click "[type=submit]"

# Pull the code and submit it to the form
CODE=$(scripts/qa/extract-mfa-link.sh --code)
playwright_fill "[name=code]" "$CODE"
playwright_click "[type=submit]"
```

Or exercise the magic link in a JS-capable browser:

```bash
MAGIC_LINK=$(scripts/qa/extract-mfa-link.sh)
playwright_navigate "$MAGIC_LINK"
# -> page renders, useEffect fires signIn("email-mfa", ...), session cookie is set
```

Form/magic-link modes are slower and only needed if you specifically want to QA the verify-page UI or assert that the magic-link auto-submit still works.

---

## Helper script

A ready-made wrapper lives at `scripts/qa/extract-mfa-link.sh`. It reads a captured auth log (default `/tmp/f3-auth.log`), fetches the latest Ethereal preview URL, and prints the magic link (default) or the 6-digit code (`--code`). See `--help`.

```bash
# Just the code -- the canonical input to the headless callback recipe
scripts/qa/extract-mfa-link.sh --code
# -> 482719

# Magic link (only useful for browser-driven flows)
scripts/qa/extract-mfa-link.sh
# -> http://localhost:3004/login/email/verify?email=qa-bot%40f3nation.test&code=482719

# Read a different log
scripts/qa/extract-mfa-link.sh --log /tmp/turbo.log --code

# Skip the consume-once check (rare)
scripts/qa/extract-mfa-link.sh --code --allow-reuse
```

---

## Failure modes worth knowing

- **`grep` returns no preview URL.** Either the auth server hasn't been started yet (check `tail /tmp/f3-auth.log`), or `NODE_ENV=production` is leaking into local dev (the SendGrid branch wouldn't print a preview URL). Verify with `pnpm --filter f3-auth exec env | grep NODE_ENV`.
- **`extract-mfa-link.sh` exits with "stale URL".** This is the consume-once guard. The latest preview URL in your log is the one the script already returned -- meaning no fresh email arrived since the last call. Trigger another send and retry, or pass `--allow-reuse` if you really want the same URL.
- **CSRF callback returns 200 but no session cookie is set.** `verifyEmailCode()` returned null -- likely the user doesn't exist (new user flow), the code was already consumed, or the code expired. Codes have a 10-minute TTL (`CODE_TTL_MINUTES` in `email-mfa.ts`). Each new send invalidates older codes for the same email. To unblock new-user testing, seed the user before driving the flow.
- **CSRF callback redirects to `/login?error=...`.** Add `--data-urlencode "json=true"` to the curl invocation; without it, NextAuth returns an HTTP redirect instead of JSON, and `curl -L` may follow that redirect into the error page. With JSON mode you can inspect the body directly.
- **Magic link "works" in a browser but `curl` gets HTML and no session.** Expected -- `/login/email/verify` is a client component. Use the CSRF + callback recipe instead. If you must exercise the magic link, drive a real browser.
- **Ethereal preview URL works but the page is blank in your browser.** Ethereal renders the raw email HTML; it doesn't run JS. `curl` against the same URL returns the same body -- that's what the recipe relies on.
- **You see emails for the wrong recipient.** Each `nodemailer.createTestAccount()` call returns a fresh Ethereal user, but the **preview URLs are global** -- anyone who happens to have the URL can see the email content. That's fine for ephemeral CI emails. Don't put real PII in test emails.

---

## Production safety

The Ethereal branch only runs when `NODE_ENV !== "production"`. There's no way to accidentally route a production email through Ethereal unless `NODE_ENV` is misconfigured, in which case the auth server has bigger problems (SendGrid creds wouldn't be available either).

The dev preview-URL log line (`console.log("Preview email:", previewUrl)`) is also gated by `NODE_ENV !== "production"` and never fires in prod, so log scrapers/SIEMs won't see a phantom Ethereal URL pattern in production audit logs.

The `/api/verify-email` rate-limit bypass is gated by the same `NODE_ENV !== "production"` check; production traffic remains capped at 10 requests per minute per IP.

---

## See also

- [`apps/auth/README.md`](README.md) -- full architecture, deployment, OAuth client registration
- [`docs/LOCAL_DEV_SETUP.md`](../../docs/LOCAL_DEV_SETUP.md) -- monorepo-wide environment and credential bootstrap
- [`docs/QA_LOCAL_AUTH.md`](../../docs/QA_LOCAL_AUTH.md) -- the recipe above in a more cookbook format, cross-referenced from every consuming app
- [`apps/auth/src/lib/email-mfa.ts`](src/lib/email-mfa.ts) -- the source of truth for what gets emailed
- [`apps/auth/src/lib/auth-options.ts`](src/lib/auth-options.ts) -- the NextAuth Credentials provider that the callback flow drives
