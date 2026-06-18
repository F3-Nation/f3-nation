# Local QA Cookbook -- Driving the Auth Flow Without a Real Inbox

> Audience: humans and AI agents writing automated end-to-end tests, screenshot smoke checks, or `/pst:qa`-style verification flows against any monorepo app that requires sign-in.

The F3 monorepo's auth server (`apps/auth`) routes email through [Ethereal](https://ethereal.email/) when `NODE_ENV !== "production"`. Ethereal is a free SMTP relay that publishes every message at a public, no-auth preview URL. Combined with NextAuth's standard CSRF + Credentials callback flow, this makes the email-MFA path **fully scriptable in local dev** -- no real inbox, no human, no Twilio-style mock-server setup.

This doc is the cookbook. The source of truth for behavior is [`apps/auth/src/lib/email-mfa.ts`](../apps/auth/src/lib/email-mfa.ts) and [`apps/auth/src/lib/auth-options.ts`](../apps/auth/src/lib/auth-options.ts); the agent-facing reference is [`apps/auth/AGENTS.md`](../apps/auth/AGENTS.md).

---

## TL;DR

```bash
# 0. Capture the auth dev log
pnpm --filter f3-auth dev > /tmp/f3-auth.log 2>&1 &

# 1. Get a CSRF token + cookie (NextAuth requires this)
CSRF=$(curl -sc /tmp/jar http://localhost:3004/api/auth/csrf | jq -r .csrfToken)

# 2. Trigger an MFA send via the calling app or directly
curl -sb /tmp/jar -X POST -H 'Content-Type: application/json' \
  -d '{"email":"qa-bot@f3nation.test"}' \
  'http://localhost:3004/api/verify-email?action=send'

# 3. Pull the 6-digit code from the latest preview email
CODE=$(scripts/qa/extract-mfa-link.sh --code)

# 4. POST email + code to NextAuth's Credentials callback
curl -sb /tmp/jar -c /tmp/jar -L -X POST \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "email=qa-bot@f3nation.test" \
  --data-urlencode "code=$CODE" \
  --data-urlencode "callbackUrl=http://localhost:3004/" \
  --data-urlencode "json=true" \
  http://localhost:3004/api/auth/callback/credentials
```

The cookie jar now holds an authenticated session token against the auth server. Continue any OAuth callback chain with the same jar to complete sign-in on the calling app.

> ### Why not just GET the magic link?
>
> The magic link in the email points at `/login/email/verify?email=...&code=...`. That page is a **client component** -- it runs `signIn("email-mfa", ...)` from a `useEffect` after the page renders. A plain `curl` of the magic link returns HTML and never executes the client-side handler, so the cookie jar gets no session. Use the CSRF + callback flow above instead.
>
> If you need to exercise the magic link itself (e.g., for browser-based regression testing), use mode B below with a real browser.

---

## Why this works

The dev path of `sendEmailCode()`:

1. Calls `nodemailer.createTestAccount()` -> returns a fresh `{user, pass}` for an Ethereal mailbox that lives only for this run.
2. Sends the email (subject `Your F3 Nation sign-in code`) via `smtp.ethereal.email:587`.
3. Calls `nodemailer.getTestMessageUrl(info)` -> returns a URL like `https://ethereal.email/message/<id>`.
4. Logs `Preview email: <url>` to stdout.

The preview URL:

- Is publicly readable. No auth, no rate limit beyond Ethereal's per-IP fair-use limits.
- Returns the rendered HTML email body when GETed.
- Persists for at least the lifetime of the test process and typically much longer; treat it as ephemeral but stable.

The dev email body always contains the 6-digit code in a `<p>` styled with `letter-spacing: 8px;`, which `scripts/qa/extract-mfa-link.sh --code` finds deterministically.

NextAuth's `/api/auth/callback/credentials` POST endpoint runs the `email-mfa` provider's `authorize()` callback (see `apps/auth/src/lib/auth-options.ts`), which calls `verifyEmailCode(email, code)`. On success it sets the session cookie in the response.

---

## Rate limiting

`/api/verify-email` is rate-limited to 10 requests per minute per IP **in production**. In `NODE_ENV !== "production"` (local dev, CI, preview environments) the limiter is bypassed, because the email transport is Ethereal -- there is no real inbox to bomb. This bypass is what makes the recipe above viable for parallel agent QA without 429s.

The NextAuth `/api/auth/callback/credentials` endpoint has no application-level rate limit in any environment.

---

## Recipes by execution mode

### A. Headless (curl-only)

Best for CI smoke checks and lightweight pst:qa runs that don't need a real browser.

```bash
# Start everything you need
pnpm --filter f3-auth dev > /tmp/f3-auth.log 2>&1 &
pnpm --filter f3-api  dev > /tmp/f3-api.log  2>&1 &
pnpm --filter f3-me   dev > /tmp/f3-me.log   2>&1 &

# Wait until they're all listening
for port in 3004 3001 3003; do
  for i in $(seq 1 30); do
    curl -sf "http://localhost:$port/" >/dev/null 2>&1 && break
    sleep 1
  done
done

# Step 1: kick off sign-in via the calling app -- this typically lands on the
#         auth server's /login/email page; for full headlessness skip this and
#         drive the auth server directly.
curl -sc /tmp/jar -L \
  'http://localhost:3003/api/auth/login?returnTo=/profile' \
  -o /dev/null

# Step 2: get a CSRF token and cookie from the auth server
CSRF=$(curl -sb /tmp/jar -c /tmp/jar \
  http://localhost:3004/api/auth/csrf | jq -r .csrfToken)

# Step 3: trigger an MFA send
curl -sb /tmp/jar -X POST -H 'Content-Type: application/json' \
  -d '{"email":"qa-bot@f3nation.test"}' \
  'http://localhost:3004/api/verify-email?action=send'

# Step 4: extract the code from the latest preview email
CODE=$(scripts/qa/extract-mfa-link.sh --code)

# Step 5: POST to NextAuth's Credentials callback
curl -sb /tmp/jar -c /tmp/jar -L -X POST \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "email=qa-bot@f3nation.test" \
  --data-urlencode "code=$CODE" \
  --data-urlencode "callbackUrl=http://localhost:3004/" \
  --data-urlencode "json=true" \
  http://localhost:3004/api/auth/callback/credentials

# /tmp/jar now holds the auth server's session-token cookie.
# Cross-app session continues by following the calling app's OAuth callback:
curl -sb /tmp/jar -c /tmp/jar -L \
  'http://localhost:3003/api/auth/callback?...' >/dev/null

curl -sb /tmp/jar http://localhost:3003/api/auth/me
# -> {"user":{"id":...,"email":"qa-bot@f3nation.test",...}}
```

Notes:

- `--data-urlencode` is required: NextAuth expects `application/x-www-form-urlencoded`, not JSON.
- `json=true` makes the callback respond with JSON instead of a redirect, which is easier to assert on in scripts.
- The session cookie is named `next-auth.session-token` in dev and `__session` in production (see `auth-options.ts`).

### B. Real browser (CDP / browser automation)

Best for visual regression, screenshot evidence, and form-driven UI verification. This is also the only mode that exercises the magic-link auto-submit path.

```bash
# Start the stack as in mode A.

# Drive the browser to the calling app's landing
browser_navigate "http://localhost:3003"
browser_click "[data-testid=sign-in-button]"
# -> browser is now on http://localhost:3004/login/email

browser_fill "[name=email]" "qa-bot@f3nation.test"
browser_click "[type=submit]"
# -> /login/email/verify, waiting for the 6-digit code

# Pull the code (the form-driven path) ...
CODE=$(scripts/qa/extract-mfa-link.sh --code)
browser_fill "[name=code]" "$CODE"
browser_click "[type=submit]"

# ... or pull the magic link and navigate to it (the magic-link path)
MAGIC_LINK=$(scripts/qa/extract-mfa-link.sh)
browser_navigate "$MAGIC_LINK"
# -> page renders, useEffect fires signIn("email-mfa", ...), session cookie is set
```

### C. /pst:qa style autonomous run

For agents driving `/pst:qa`, the recommended flow is mode A above (it bypasses the form UI and is robust against frontend churn) plus a screenshot capture at meaningful checkpoints. Specifically:

- Capture the calling-app landing before sign-in (proves the app boots).
- Trigger send, get code, POST the callback.
- Re-navigate the browser to the calling-app's authenticated home and capture again (proves auth round-tripped).

The `scripts/qa/extract-mfa-link.sh` helper handles the log-scrape + curl-fetch + pattern-extract dance for you. It also enforces consume-once semantics by default -- if you call it twice without triggering a fresh send in between, it exits non-zero with a "stale URL" error. That's intentional: it catches the common failure mode where retries silently reuse already-consumed codes. Pass `--allow-reuse` if you really want the same URL twice (rare).

---

## Multi-service log capture

`pnpm dev` from the repo root runs `turbo dev --parallel`, which interleaves stdout from every workspace into one stream. For QA you usually want apps/auth's stream isolated:

```bash
# Best: run apps/auth alone, separately from the rest
pnpm --filter f3-auth dev > /tmp/f3-auth.log 2>&1 &
pnpm dev --filter '!f3-auth' > /tmp/turbo.log 2>&1 &
```

If you must use the merged stream, the helper still works -- apps/auth's lines are tagged by Turbo:

```bash
scripts/qa/extract-mfa-link.sh --log /tmp/turbo.log
```

The `Preview email: https://ethereal.email/message/...` pattern is unique to apps/auth in the monorepo, so no further filtering is needed.

The consume-once guard is especially important with merged logs, where an isolated mtime check would be fooled by unrelated output keeping the file fresh.

---

## Test data and PII

- Use synthetic email addresses (`qa-bot@f3nation.test`, `test-<uuid>@example.invalid`). Real PII in test emails leaks into Ethereal's public preview URLs.
- The auth DB schema accepts arbitrary email strings for MFA -- there's no DNS validation locally -- so pick a top-level domain that won't ever resolve (`.test`, `.invalid`, `.example`).
- The `users` table requires a real-looking record. Reset between runs with `pnpm reset-test-db` or seed deterministically in a fixture. New users redirect to `/register` instead of completing sign-in -- if your test asserts an authenticated session, seed the user first.

---

## When NOT to use this

- **End-to-end tests against staging or production.** Those flows route through SendGrid; the recipe doesn't apply, and `/api/verify-email` is rate-limited to 10/min/IP. Use a real test inbox or a SendGrid sub-account scoped to QA.
- **Performance benchmarks of the email send path itself.** Ethereal's latency is not representative of SendGrid in any meaningful way; use SendGrid's sandbox mode if you care about send-side perf.
- **Verifying email content rendering across clients.** Ethereal renders the raw HTML; it doesn't simulate Gmail or Outlook quirks. If that matters, use Litmus or Email on Acid.

For everything else -- local dev, branch QA, smoke tests of auth-bounded apps -- the Ethereal recipe is the path.

---

## Pointers

- [`apps/auth/AGENTS.md`](../apps/auth/AGENTS.md) -- agent-friendly reference, error modes
- [`apps/auth/README.md`](../apps/auth/README.md) -- full auth server architecture
- [`apps/auth/src/lib/email-mfa.ts`](../apps/auth/src/lib/email-mfa.ts) -- code that decides between SendGrid and Ethereal
- [`apps/auth/src/lib/auth-options.ts`](../apps/auth/src/lib/auth-options.ts) -- NextAuth Credentials provider that the callback flow drives
- [`scripts/qa/extract-mfa-link.sh`](../scripts/qa/extract-mfa-link.sh) -- helper used in every recipe above
- [`docs/LOCAL_DEV_SETUP.md`](LOCAL_DEV_SETUP.md) -- env vars, secrets bootstrap, baseline DB setup
- [Ethereal Email](https://ethereal.email/) -- upstream documentation
