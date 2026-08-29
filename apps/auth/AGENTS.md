<!-- BEGIN:nextjs-agent-rules -->

# Next.js: ALWAYS read docs before coding

Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

<!-- END:nextjs-agent-rules -->

# F3 Auth -- Agent Guide

> Context for AI coding agents and QA-automation agents working with the F3 SSO server.

The two most useful things to know up front:

1. **In local development all outbound mail is caught by [Mailpit](https://mailpit.axllent.org/), started for you by `pnpm docker:up`.** Nothing leaves your machine, no SendGrid credentials are needed, and no real inbox has to be polled. Read messages at `http://localhost:8025` -- web UI for humans, REST API on the same port for agents.
2. **Sign-in completes via NextAuth's standard CSRF + Credentials callback flow.** A `curl` of the magic link does **not** complete sign-in (the verify page is a client component that calls `signIn()` from a `useEffect`). For headless automation, POST `email + code` to `/api/auth/callback/credentials` with a CSRF token. See the recipe below.

If you only read this section, you have enough to drive the auth flow programmatically. The rest of this doc is the recipe.

---

## Architecture summary

`apps/auth` is the F3 OAuth 2.0 / OpenID Connect server. Other apps in the monorepo (apps/me, apps/map, pax-vault, the-codex, ...) authenticate users by redirecting to `apps/auth`, which authenticates the user via **email-based MFA** (a 6-digit code plus a magic link, both delivered in the same email), then redirects back with an authorization code that the calling app exchanges for tokens.

The MFA logic lives in `apps/auth/src/lib/email-mfa.ts`. There is **no environment branching in the transport** -- it is a single nodemailer transport built from the `EMAIL_SERVER` connection string, so which mail server receives a message is purely a matter of configuration:

| Environment | `EMAIL_SERVER`                    | Where the mail lands                          |
| ----------- | --------------------------------- | --------------------------------------------- |
| Local dev   | `smtp://localhost:1025` (default) | Mailpit -- read it at `http://localhost:8025` |
| Production  | SendGrid SMTP credentials         | The recipient's real inbox                    |

`smtp://localhost:1025` is the default in `apps/auth/.env.example`, and port 1025 is Mailpit's SMTP listener in `docker-compose.yml`. **Nothing is logged when a message is sent** -- retrieve mail from Mailpit, never from the auth server's stdout.

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

1. **6-digit code** -- present twice: in the `<p style="...letter-spacing: 8px;">` element and as the `code=` parameter of the magic link. The `code=` parameter is the easier grep target. Use this for headless flows: feed it to `/api/auth/callback/credentials` with a CSRF token (recipe below). **This is the canonical path for autonomous QA.**
2. **Magic link** -- `<a href="${authUrl}/login/email/verify?email=<urlencoded>&code=<6 digits>">...</a>`. The page at that URL is a **client component** -- it calls `signIn("email-mfa", ...)` from a React `useEffect`. A raw `curl` GET only returns HTML and never executes the sign-in. Use this only when driving a JS-capable browser (e.g. CDP).

Both are stable across dev runs. Neither depends on parsing arbitrary email-rendering quirks.

---

## Rate limiting

`/api/verify-email` enforces a 10-requests-per-minute-per-IP cap **in production only**. Under `NODE_ENV !== "production"` (local dev, CI, preview environments) the limit is bypassed -- mail is caught by Mailpit, so there is no real inbox to bomb. This bypass is what makes parallel agent QA viable without 429s.

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

Make sure the Docker services are up, since Mailpit is the only place sent mail can be read:

```bash
pnpm docker:up
curl -sf http://localhost:8025/api/v1/messages >/dev/null && echo "Mailpit is up"
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

Either way, `sendEmailCode()` runs and a new message appears in Mailpit.

### 3. Pull the code from the newest Mailpit message

Mailpit's REST API lists messages newest-first, so read the newest ID and grep the `code=` parameter out of its HTML body:

```bash
ID=$(curl -s http://localhost:8025/api/v1/messages | jq -r '.messages[0].ID')
CODE=$(curl -s "http://localhost:8025/api/v1/message/$ID" \
  | jq -r '.HTML' \
  | grep -oE 'code=[0-9]{6}' | head -1 | cut -d= -f2)
echo "MFA code: $CODE"
```

Codes are single-use, and each new send invalidates the previous code for that address -- so reusing a stale message is the most common silent failure. The cheapest guard is to empty the mailbox before triggering the send, which makes "newest message" unambiguous:

```bash
curl -s -X DELETE http://localhost:8025/api/v1/messages
```

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

### Form mode -- submit the code through the verify page UI (browser automation / CDP)

When you're driving a real browser and want to exercise the verify form's UI itself:

```bash
# Drive the browser to /login/email, submit the email
browser_navigate "http://localhost:3004/login/email"
browser_fill "[name=email]" "qa-bot@f3nation.test"
browser_click "[type=submit]"

# Pull the code (step 3 above) and submit it to the form
browser_fill "[name=code]" "$CODE"
browser_click "[type=submit]"
```

Or exercise the magic link in a JS-capable browser:

```bash
MAGIC_LINK=$(curl -s "http://localhost:8025/api/v1/message/$ID" \
  | jq -r '.HTML' \
  | grep -oE 'http://localhost:3004/login/email/verify\?[^"]+' | head -1)
browser_navigate "$MAGIC_LINK"
# -> page renders, useEffect fires signIn("email-mfa", ...), session cookie is set
```

Form/magic-link modes are slower and only needed if you specifically want to QA the verify-page UI or assert that the magic-link auto-submit still works.

---

## Helper script

> **Do not use `scripts/qa/extract-mfa-link.sh`.** It scrapes an Ethereal preview URL out of a captured auth log, and the auth server no longer uses Ethereal or logs anything on send -- so it can only ever find nothing. Use the Mailpit `curl` in step 3 instead.

---

## Failure modes worth knowing

- **Mailpit's message list is empty.** Either the send never happened, or the mail went somewhere else. Check that Mailpit is running (`docker ps | grep f3-mailpit`, or `pnpm docker:up`) and that `EMAIL_SERVER` in `apps/auth/.env` is `smtp://localhost:1025` -- a stale value pointed at SendGrid will fail or, worse, deliver to a real address.
- **You extracted a code but it's rejected.** You probably read a stale message. Codes are single-use and each send invalidates the prior one, so `.messages[0]` may be a previous run's email. Empty the mailbox (`curl -s -X DELETE http://localhost:8025/api/v1/messages`) before triggering the send.
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

## See also

- [`apps/auth/README.md`](README.md) -- full architecture, deployment, OAuth client registration
- [`docs/LOCAL_DEV_SETUP.md`](../../docs/LOCAL_DEV_SETUP.md) -- monorepo-wide environment and credential bootstrap
- [`docs/LOCAL_DEV_DOCKER.md`](../../docs/LOCAL_DEV_DOCKER.md) -- bringing up Mailpit and the rest of the Docker stack
- [`apps/auth/src/lib/email-mfa.ts`](src/lib/email-mfa.ts) -- the source of truth for what gets emailed
- [`apps/auth/src/lib/auth-options.ts`](src/lib/auth-options.ts) -- the NextAuth Credentials provider that the callback flow drives
