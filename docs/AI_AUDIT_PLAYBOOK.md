# AI Repository Audit Playbook

> Instructions for an AI coding agent (Claude, Copilot, Cursor, or similar) asked
> to audit this monorepo for security, reliability, performance, and
> maintainability problems and to file high-quality issues.
>
> This document describes **how to run an audit** — the methodology, what to look
> for, how to verify, and how to report. It deliberately does **not** list
> specific past findings; treat every audit as fresh and verify everything
> firsthand against the current code.

---

## 1. Goal & philosophy

You are looking for things the team can improve — ideally high-level
infrastructure issues, "corners we're working ourselves into," missing
guardrails, and concrete security/correctness bugs. Findings can be big sweeping
architectural concerns or small nitpicks. Every issue you file must:

1. **Be verified firsthand.** Read the actual code path end-to-end. Never file a
   finding based on a pattern match, a filename, or an assumption. If you cannot
   prove it from the code, do not file it.
2. **Detail the problem _and_ the fix.** An issue without a concrete, actionable
   remediation is noise.
3. **Be deduplicated.** Search existing open issues first. If the topic already
   exists, add a comment with your new evidence instead of filing a duplicate.
4. **Be labeled.** Every audit issue gets the `ai-audit` label so humans can
   triage the batch and measure signal-to-noise.

Quality over volume. One verified, well-written issue is worth more than ten
speculative ones. A wrong finding erodes trust in the whole batch.

---

## 2. Before you start

### Confirm your tools and context

- **GitHub CLI:** Confirm `gh auth status` and the target repo
  (`F3-Nation/f3-nation`). The default branch is `main`. The repo is **public** —
  do not paste secrets, tokens, or real user PII into issue bodies.
- **Shell:** In bash, prefix commands with `set +H` so `!` characters don't
  trigger history expansion. If `pnpm` isn't on `PATH`, run
  `. ~/.nvm/nvm.sh && nvm use` first (see [`AGENTS.md`](../AGENTS.md)).
- **Read the project guides first:** [`AGENTS.md`](../AGENTS.md),
  [`docs/AI_DEVELOPMENT_GUIDE.md`](AI_DEVELOPMENT_GUIDE.md), and the per-app
  `AGENTS.md` files. They encode conventions you must respect (commit scopes,
  env handling, cross-platform constraints) and the secure patterns you are
  auditing _for_.

### Set up a working memory

Audits are long and may span multiple sessions. Keep a running scratch file
(e.g. agent memory or a local notes file) that records, at minimum:

- Repo facts you've confirmed (auth model, deploy topology, default branch).
- Existing open issues / PRs relevant to dedup.
- Each finding: file path, line, a one-line proof, status (verified / filed /
  commented), and the issue number once filed.
- **Verified non-findings** — things you checked that turned out fine — so you
  don't re-investigate them or accidentally contradict yourself later.

---

## 3. The audit loop

For each candidate area, follow this loop:

1. **Survey** — use fast search (`grep`/file search/semantic search) to locate
   the relevant code.
2. **Read** — open the full code path. Follow imports, middleware, and wiring.
   Confirm the code is actually reachable/live (imported, routed, deployed), not
   dead or test-only.
3. **Prove** — articulate the concrete failure: who can trigger it, what
   happens, and why it matters. If you can't, drop it.
4. **Dedup** — search open issues for the topic. Decide: new issue, comment on
   existing, or skip.
5. **Report** — file the issue (Section 6) or add a comment, then record it in
   memory.

Work breadth-first across categories, then go deep where you find smoke.

---

## 4. What to look for

Use these categories as a checklist. For each, the goal is listed first, then
concrete things to grep for and verify. **Always confirm the finding against the
real code** — these are starting points, not conclusions.

### 4.1 Authentication & authorization (highest value)

- **Authorization on _every_ mutating and data-returning endpoint.** Map the
  API's procedure tiers (public / authenticated / editor / admin) and confirm
  each endpoint uses the right one. The dangerous pattern is an
  "authenticated-but-not-authorized" endpoint: it checks that _a_ user is
  logged in but then trusts an ID from the request body (`userId`, `orgId`,
  `eventId`) without verifying the caller owns or has a role on that resource.
  This is IDOR (CWE-639). Read each handler and ask: _"What stops me from passing
  someone else's ID here?"_
- **Resource-scoped reads.** Confirm endpoints that return user data scope to the
  session subject or a role on the target org — not "any logged-in caller can
  read anyone's data" (PII exposure, CWE-200).
- **Token & secret generation.** Any value used as a credential, OTP,
  session/verification token, or nonce must come from a CSPRNG
  (`crypto.randomInt`, `crypto.randomBytes`, `crypto.getRandomValues`) — never
  `Math.random()`.
- **JWT / session verification.** Where tokens are trusted, confirm the
  signature is actually verified (issuer, audience, algorithm allow-list) and not
  merely decoded. Watch for "decode-and-trust" handlers that rely on a single
  upstream verifier (e.g. middleware) — a fragile single point of failure.
- **OAuth/OIDC flows.** PKCE enforced (reject `plain`), state/nonce validated,
  redirect URIs allow-listed (no open redirect), refresh-token rotation handled
  safely (see 4.3), revoke/userinfo endpoints rate-limited.
- **Credentials reaching the browser.** Any `NEXT_PUBLIC_*` value is shipped in
  the client bundle and is effectively public. Confirm none of them grant broad
  server access (an over-scoped public API key is a confused-deputy problem).

### 4.2 Secrets & sensitive data

- **Secrets in logs.** Grep for logging of tokens, passwords, OTPs, full auth
  headers, raw OAuth account objects, or PII. Look for hardcoded `LOG = true`
  flags. On Cloud Run, stdout → Cloud Logging, so this is real exposure
  (CWE-532).
- **Secrets in build artifacts.** Check Dockerfiles for secrets baked into image
  layers (`.env` files copied into the runner stage, `ARG`/`echo` of tokens,
  `--build-arg` secrets). Use build secrets/runtime injection instead.
- **PII in source.** Real emails/names hardcoded in seed scripts, fixtures, or
  tests — especially in a public repo.
- **Env validation bypass.** Credentials read via raw `process.env` instead of
  the validated env schema.

### 4.3 Reliability & "corners we're painting into"

- **Connection pooling under autoscaling.** For serverless/Cloud Run + Postgres,
  confirm the DB client has bounded pool size, connect/idle timeouts, and a
  driver config compatible with the pooler (e.g. prepared statements vs PgBouncer
  transaction mode). `instances × pool_max` must stay under the DB/pooler ceiling.
- **Refresh-token rotation races.** If the server single-uses refresh tokens
  (delete-on-use) while clients refresh per-request/concurrently, concurrent
  requests at token expiry can all redeem the same token and get logged out.
  Look for per-request refresh in middleware against strict rotation with no
  grace window.
- **In-memory state in multi-instance deploys.** Rate limiters, caches, locks, or
  counters kept in process memory don't work across autoscaled instances.
- **Unbounded queries / payloads.** Endpoints returning "all" rows without
  pagination or limits; file uploads without size caps; `await
file.arrayBuffer()` on untrusted input.
- **Missing timeouts / retries / idempotency** on external calls and webhooks.

### 4.4 HTTP & web security

- **Security headers.** Check each app's `next.config.*`/middleware for CSP,
  HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options`/`frame-ancestors`,
  `Referrer-Policy`, `Permissions-Policy`. Note intentionally embeddable surfaces
  (e.g. the map) need an allow-list, not a blanket `DENY`.
- **`X-Powered-By` / framework fingerprinting** left enabled.
- **Untrusted HTML.** `dangerouslySetInnerHTML` must be sanitized (DOMPurify);
  email/template interpolation of user input must be escaped.
- **File upload handling.** Content-Type and extension derived from
  attacker-controlled `file.type`; unencoded object paths (overwrite/traversal);
  unauthenticated upload endpoints.

### 4.5 Dependencies

- Run `pnpm audit --prod` and triage by severity. Cross-reference the workspace
  catalog/pins. Prioritize high-severity CVEs in security-relevant deps
  (framework middleware bypasses, HTTP clients, mail libraries). Note whether a
  fix is a patch, minor, or breaking major.

### 4.6 Observability & operations

- Inconsistent or missing structured logging; `console.*` sprawl.
- Error monitoring (e.g. PostHog) configured for only some apps; sampling/release
  config that's wrong for production.
- Health checks, graceful shutdown, and DB connection teardown.

### 4.7 CI/CD & supply chain

- GitHub Actions: third-party actions pinned to SHAs (not floating tags),
  least-privilege `GITHUB_TOKEN` permissions, no secret leakage in logs.
- Docker base images pinned; build steps that run migrations at build time
  (should be a deploy-time step).
- Node/pnpm versions consistent across `.nvmrc`, CI, and Dockerfiles.

### 4.8 Data layer & migrations

- Drizzle migration journal integrity (no drift, all migrations present).
- Missing indexes on hot query paths (especially auth/role lookups and
  foreign keys used in joins).
- N+1 query patterns — authorization or enrichment checks inside `for await`
  loops that could be batched.
- Raw SQL: confirm parameterization (no string interpolation of user input).

### 4.9 Maintainability

- Type-safety escape hatches (`@ts-nocheck`, `@ts-ignore`, `any`) on important
  code.
- Duplicated logic that has drifted between apps (e.g. two copies of an auth
  helper where only one was fixed).
- Dead code, commented-out prod branches, `TODO`/`FIXME` on security paths.

---

## 5. How to verify a finding (do not skip)

A finding is only real if you can answer all of these from the code:

- **Is it live?** Is the code imported, routed, and deployed — not test-only or
  dead? Trace the wiring (e.g. is the vulnerable procedure actually mounted on
  the router; is the flag actually `true` in the path that runs).
- **Who can trigger it?** Anonymous internet user, any authenticated user, or
  only an admin? The reachability determines severity.
- **What is the impact?** Data exposure, data tampering, auth bypass, outage,
  cost, or just tech debt?
- **Are there compensating controls?** A separate middleware, a guard, an env
  gate (`isProduction`), or an allow-list might already mitigate it. Check
  before filing, and describe them honestly in the issue.

If you previously recorded something as a "verified non-finding," and new
evidence contradicts it, say so explicitly in the new issue rather than quietly
reversing yourself.

---

## 6. Writing the issue

Use the GitHub CLI with a body file to avoid shell-escaping problems:

```bash
set +H
gh issue create --repo F3-Nation/f3-nation --label ai-audit \
  --title "<type>(<scope>): <concise, specific summary>" \
  --body-file /tmp/audit/<n>-<slug>.md
```

Title convention mirrors Conventional Commits scopes (see
[`AGENTS.md`](../AGENTS.md) → Commit Message Convention), e.g.
`security(api): ...`, `infra(db): ...`, `perf(api): ...`.

**Body template:**

```markdown
## Summary

One paragraph: what's wrong and the headline impact.

## Evidence

Exact file paths + line refs + minimal code snippets proving the issue.
Show the live wiring (where it's imported/routed/enabled).

## Why it matters

Reachability (who can trigger), impact, and any CWE reference.

## Suggested fix

Concrete, actionable remediation. Code sketch if helpful. Offer options
when there's a tradeoff.

## Acceptance criteria

Bullet list a reviewer can check off, ideally including a regression test.

---

Filed as part of an automated repository audit (`ai-audit`). Related: #<refs>
```

**Commenting instead of filing:** If an open issue already covers the topic, add
a comment with your additional evidence and cross-reference, e.g.:

```bash
gh issue comment <n> --repo F3-Nation/f3-nation --body-file /tmp/audit/comment.md
```

**Dedup search:**

```bash
gh issue list --repo F3-Nation/f3-nation --state open --limit 250 \
  --json number,title \
  --jq '.[] | select(.title|test("<keywords>";"i")) | "\(.number) \(.title)"'
```

---

## 7. Severity guidance

Calibrate so humans can triage quickly:

- **High** — exploitable by anonymous or any authenticated user; data exposure,
  auth bypass, data tampering, or a production outage/cost cliff.
- **Medium** — requires elevated access or specific conditions; reliability
  risks that appear only under load; meaningful tech-debt corners.
- **Low** — nitpicks, style, defense-in-depth hardening with no direct exploit.

State the reachability explicitly; it's the main driver of severity.

---

## 8. Anti-patterns — do NOT

- File findings you have not read end-to-end in the current code.
- Report theoretical issues without a reachable trigger.
- Duplicate an existing open issue instead of commenting.
- Paste secrets, tokens, or real PII into a public issue.
- Suggest fixes that bypass safety (e.g. `--no-verify`, disabling auth, deleting
  unfamiliar files).
- Make changes to the codebase during an audit unless explicitly asked — an audit
  is read-only by default; file issues, don't fix.
- Over-engineer remediations. Recommend the smallest change that closes the gap.

---

## 9. Wrap-up

When the audit (or session) ends:

- Update your memory/notes with every filed issue number and verified
  non-finding.
- Summarize the batch for the human: counts by severity/category, the most
  important findings, and any threads left to pull next time.
- Keep the `ai-audit` label consistent so the team can review the whole set and
  measure precision.
