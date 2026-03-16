# Security & Authentication Architecture

This document explains how authentication and authorization work for the **apps/me** BFF (Backend-for-Frontend) and its relationship with the **packages/api** public API. This is a non-trivial multi-layer auth system — read this fully before making changes.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Authentication Layers](#authentication-layers)
   - [Layer 1: OAuth Login Flow (Browser → BFF)](#layer-1-oauth-login-flow-browser--bff)
   - [Layer 2: Session Cookie (BFF ↔ Browser)](#layer-2-session-cookie-bff--browser)
   - [Layer 3: BFF → API (Server-to-Server)](#layer-3-bff--api-server-to-server)
   - [Layer 4: API Procedure Authorization](#layer-4-api-procedure-authorization)
3. [The X-User-Id Header & Why It's Sensitive](#the-x-user-id-header--why-its-sensitive)
4. [How Direct API Callers Work (Scalar, Mobile, etc.)](#how-direct-api-callers-work-scalar-mobile-etc)
5. [Environment Variables (Security-Critical)](#environment-variables-security-critical)
6. [Cookie Security](#cookie-security)
7. [Middleware & Route Protection](#middleware--route-protection)
8. [FAQ: "Can't Someone Just Run This Locally?"](#faq-cant-someone-just-run-this-locally)
9. [Known Risks & Things to Watch](#known-risks--things-to-watch)
10. [Checklist for Common Changes](#checklist-for-common-changes)

---

## Architecture Overview

```
┌──────────┐     ┌──────────────────┐     ┌─────────────────┐     ┌────────────┐
│  Browser  │────▶│  apps/me (BFF)   │────▶│  packages/api   │────▶│  Database   │
│           │◀────│  Next.js App     │◀────│  oRPC Server    │◀────│  PostgreSQL │
└──────────┘     └──────────────────┘     └─────────────────┘     └────────────┘
  Cookies           Server-only code         Bearer token auth       Drizzle ORM
  (HMAC session)    reads cookie,            validates API key,
                    sends X-User-Id          checks procedures
```

**Key principle:** The browser never talks to the API directly. All API calls go through the BFF, which acts as a trusted intermediary. The browser authenticates to the BFF with an HMAC-signed cookie. The BFF authenticates to the API with a service-level API key.

Other callers (Scalar docs UI, mobile apps, third-party integrations) authenticate to the API directly with their own API keys and **cannot** impersonate other users.

---

## Authentication Layers

### Layer 1: OAuth Login Flow (Browser → BFF)

**Files:**

- `apps/me/src/app/api/auth/login/route.ts`
- `apps/me/src/app/api/auth/callback/route.ts`
- `apps/me/src/lib/auth/oauth.ts`

**Flow:**

1. User clicks "Sign In" → `GET /api/auth/login`
2. Login handler generates:
   - **CSRF token** (random UUID) — stored in `oauth_csrf` httpOnly cookie
   - **PKCE code verifier** (random 32 bytes) — stored in `oauth_code_verifier` httpOnly cookie
   - **Code challenge** (SHA-256 of verifier) — sent in the authorize URL
   - **State parameter** (base64url JSON with CSRF token, client ID, returnTo, timestamp) — sent in the authorize URL
3. Browser is redirected to the OAuth provider's `/api/oauth/authorize`
4. User authenticates at the OAuth provider
5. Provider redirects back to `GET /api/auth/callback` with `code` and `state`
6. Callback handler validates:
   - State timestamp is < 10 minutes old (prevents replay)
   - CSRF token in state matches `oauth_csrf` cookie (prevents CSRF)
   - Code verifier cookie is present (PKCE)
7. Exchanges authorization code for access token (sending code verifier for PKCE)
8. Fetches user info from provider (`/api/oauth/userinfo`)
9. Calls `lookupUserByEmail()` to resolve email → numeric user ID via the API
10. Creates an HMAC-signed session cookie containing the user's identity
11. Clears the temporary OAuth cookies
12. Redirects to the `returnTo` path

**Security controls:**

- PKCE (S256) prevents authorization code interception
- CSRF token validates the callback originated from our login flow
- State timestamp prevents replay of old authorization URLs
- `returnTo` is validated to be a relative path (no open redirect)
- OAuth cookies are httpOnly, secure (in prod), sameSite=lax, short-lived (10 min)

### Layer 2: Session Cookie (BFF ↔ Browser)

**Files:**

- `apps/me/src/lib/auth/session.ts`
- `apps/me/src/lib/auth/constants.ts`
- `apps/me/src/lib/auth/server.ts`

**Cookie name:** `__session`
**Max age:** 10 days
**Cookie flags:** `httpOnly`, `secure` (production), `sameSite=lax`, `path=/`

**Format:** `{base64url_payload}.{base64url_hmac_signature}`

**Payload (SessionPayload):**

```json
{
  "sub": "oauth-subject-id",
  "email": "user@example.com",
  "name": "User Name",
  "userId": 42,
  "iat": 1710000000
}
```

**How it works:**

- **Signing:** `HMAC-SHA256(base64url(JSON(payload)), SESSION_SECRET)` → base64url signature
- **Verification:** Recompute HMAC and compare using `timingSafeEqual` (constant-time comparison to prevent timing attacks)
- **Expiry:** `iat` (issued-at) timestamp is checked against `SESSION_COOKIE_MAX_AGE` (10 days)

**Why not JWT?** This is simpler and sufficient. The BFF is the only consumer of the cookie — it doesn't need to be verified by third parties. HMAC is symmetric and faster than RSA/ECDSA signing.

**`requireAuth()` helper** (`apps/me/src/lib/auth/server.ts`):

- Reads the cookie, verifies HMAC, checks expiry
- If valid → returns `SessionPayload`
- If invalid/missing → redirects to `/` (login page)
- Every BFF route handler that touches user data calls `requireAuth()` first

### Layer 3: BFF → API (Server-to-Server)

**Files:**

- `apps/me/src/lib/api/client.ts` (BFF-side)
- `packages/api/src/shared.ts` — `getSession()` (API-side)
- `packages/api/src/router/me/index.ts` — `meProtectedProcedure` (API-side)

**How the BFF calls the API:**

```
Authorization: Bearer {F3_API_KEY}
Client: f3-me
X-User-Id: 42
Content-Type: application/json
```

1. The BFF sends `F3_API_KEY` as a Bearer token in the `Authorization` header
2. The API's `getSession()` validates the key against the `api_keys` table in the database
3. This produces a session object with the API key owner's identity and roles
4. `meProtectedProcedure` then checks: **does the Bearer token match `ME_BFF_API_KEY` env var?**
   - **Yes (BFF):** Override `session.id` with the `X-User-Id` header value. This is how the BFF acts on behalf of the logged-in user.
   - **No (anyone else):** Ignore `X-User-Id` entirely. Use the session identity from the API key (the key owner's own profile).

**This is the most security-critical part of the system.** See [The X-User-Id Header](#the-x-user-id-header--why-its-sensitive) below.

### Layer 4: API Procedure Authorization

**File:** `packages/api/src/shared.ts`

The API has a hierarchy of procedure types, each with increasing authorization requirements:

| Procedure                 | Auth Required                         | Who Can Use                                                        |
| ------------------------- | ------------------------------------- | ------------------------------------------------------------------ |
| `publicProcedure`         | None (rate-limited only)              | Anyone                                                             |
| `protectedProcedure`      | Valid session (cookie or API key)     | Any authenticated user                                             |
| `meProtectedProcedure`    | Valid session + BFF key check         | BFF (X-User-Id override) or any API key holder (own identity only) |
| `editorProcedure`         | Session + editor or admin role        | Regional editors, admins                                           |
| `adminProcedure`          | Session + admin role                  | Admins only                                                        |
| `nationAdminProcedure`    | Session + F3 Nation admin             | Nation-level admins                                                |
| `apiKeyProcedure`         | `x-api-key` header (not Bearer)       | Special API key holders                                            |
| `revalidateAuthProcedure` | `SUPER_ADMIN_API_KEY` or nation admin | Cache revalidation                                                 |

**Rate limiting:** All procedures inherit from `base`, which applies in-memory rate limiting (200 req/min in production, 10K in dev) keyed by client IP.

> **Warning:** Rate limiting is per-instance. In multi-instance deployments, effective limits = `MAX_REQUESTS × number_of_instances`. For true distributed limiting, migrate to Redis/Upstash.

---

## The X-User-Id Header & Why It's Sensitive

### The Problem

The `/me` router endpoints serve PII (email, phone, emergency contacts). They use `meProtectedProcedure`, which overrides `session.id` with the `X-User-Id` header — but **only** when the request is authenticated with the BFF's specific API key.

### How It's Secured

```
meProtectedProcedure:
  1. Extract the bearer token from the Authorization header
  2. Compare it against process.env.ME_BFF_API_KEY (constant-time comparison)
  3. If match → read X-User-Id, validate it, override session.id
  4. If no match → ignore X-User-Id, use the API key owner's own session identity
```

**The trust boundary:** The bearer token is a server-side secret (`ME_BFF_API_KEY`). It is never exposed to the browser. Only the BFF server knows it. This cannot be spoofed by setting headers — the attacker would need the actual API key secret.

### What Would Go Wrong Without This

If `meProtectedProcedure` trusted `X-User-Id` from **any** authenticated caller (i.e., checked only the `Client` header or accepted any API key), then:

- Any API key holder could set `X-User-Id: 5` and read another user's PII
- Any API key holder could `PATCH /me/profile` with someone else's ID and modify their data
- Any API key holder could `DELETE /me/roles` or `DELETE /me/positions` on behalf of other users

This is a **broken access control** vulnerability (OWASP A01:2021).

### Rules

1. **Never trust X-User-Id from an arbitrary caller.** Only honor it when the bearer token matches `ME_BFF_API_KEY`.
2. **Never expose `ME_BFF_API_KEY` / `F3_API_KEY` to the browser.** These are server-side secrets used only in `apps/me/src/lib/api/client.ts` (which is `"server-only"`).
3. **`Client` header is NOT a security boundary.** Anyone can set `Client: f3-me`. Never use it for auth decisions.
4. **If you add a new `/me` endpoint that accesses PII or modifies user data, use `meProtectedProcedure`.** Using plain `protectedProcedure` is fine for non-sensitive, non-user-scoped data (e.g., `regions`, `users` list, `lookupByEmail`).

---

## How Direct API Callers Work (Scalar, Mobile, etc.)

When someone uses the API directly (not through the BFF):

1. They authenticate with their own API key (`Authorization: Bearer {their_api_key}`)
2. `getSession()` validates the key, builds a session with `id = key owner's userId`
3. `meProtectedProcedure` checks the bearer token against `ME_BFF_API_KEY` — **no match**
4. `X-User-Id` header is silently ignored
5. `/me/profile` returns the API key owner's own profile — as intended

This means the Scalar docs UI at `/docs` works perfectly: you authenticate with your API key and `/me/profile` returns your own data. You just can't see anyone else's.

---

## Environment Variables (Security-Critical)

### apps/me (BFF)

| Variable               | Purpose                                              | Sensitivity                                                                                    |
| ---------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `SESSION_SECRET`       | HMAC key for signing session cookies                 | **Critical** — if leaked, attackers can forge session cookies for any user                     |
| `F3_API_KEY`           | Bearer token sent to the API                         | **Critical** — this is the BFF's service identity; must match `ME_BFF_API_KEY` on the API side |
| `OAUTH_CLIENT_ID`      | OAuth provider client identifier                     | Low                                                                                            |
| `OAUTH_CLIENT_SECRET`  | OAuth provider client secret                         | **High** — used in token exchange                                                              |
| `OAUTH_REDIRECT_URI`   | Callback URL for OAuth                               | Low (but must match provider config)                                                           |
| `AUTH_PROVIDER_URL`    | OAuth provider base URL                              | Low                                                                                            |
| `NEXT_PUBLIC_SITE_URL` | Public origin for redirects                          | Low                                                                                            |
| `F3_API_BASE_URL`      | API server URL (e.g., `http://localhost:3001/v1/me`) | Low                                                                                            |

### packages/api (API Server)

| Variable              | Purpose                                                           | Sensitivity                                     |
| --------------------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| `ME_BFF_API_KEY`      | The BFF's API key secret — **must match `F3_API_KEY` on the BFF** | **Critical** — determines who can set X-User-Id |
| `SUPER_ADMIN_API_KEY` | Bypasses normal auth for revalidation/admin ops                   | **Critical**                                    |
| `DATABASE_URL`        | PostgreSQL connection string                                      | **Critical**                                    |
| `AUTH_SECRET`         | NextAuth secret (for map/api session auth)                        | **Critical**                                    |

### Deployment Checklist

- [ ] `F3_API_KEY` (on BFF) and `ME_BFF_API_KEY` (on API) are set to the **same value**
- [ ] `SESSION_SECRET` is a strong random string (≥ 32 bytes)
- [ ] Neither `F3_API_KEY` nor `SESSION_SECRET` are exposed in client-side bundles
- [ ] `OAUTH_REDIRECT_URI` matches exactly what's configured in the OAuth provider
- [ ] API keys in the `api_keys` database table have appropriate `expiresAt` and are revoked when no longer needed

---

## Cookie Security

### Session Cookie (`__session`)

| Property   | Value                | Why                                                                          |
| ---------- | -------------------- | ---------------------------------------------------------------------------- |
| `httpOnly` | `true`               | Prevents JavaScript access — blocks XSS cookie theft                         |
| `secure`   | `true` in production | Only sent over HTTPS                                                         |
| `sameSite` | `lax`                | Prevents CSRF on state-changing requests while allowing top-level navigation |
| `path`     | `/`                  | Available to all routes                                                      |
| `maxAge`   | 864,000 (10 days)    | Limits window of a stolen cookie                                             |

### OAuth Flow Cookies (`oauth_csrf`, `oauth_code_verifier`)

| Property   | Value                | Why                                                           |
| ---------- | -------------------- | ------------------------------------------------------------- |
| `httpOnly` | `true`               | Prevents JavaScript access                                    |
| `secure`   | `true` in production | HTTPS only                                                    |
| `sameSite` | `lax`                | Prevents cross-site abuse                                     |
| `maxAge`   | 600 (10 minutes)     | Very short-lived — only needed during the OAuth redirect flow |

Both OAuth cookies are cleared immediately after the callback processes them.

---

## Middleware & Route Protection

**File:** `apps/me/middleware.ts`

The Next.js middleware runs on every request and enforces:

- **Public paths** (no auth required): `/`, `/api/auth/login`, `/api/auth/callback`
- **All `/api/auth/*` routes** are allowed (login, callback, logout, me)
- **Static files** (`_next/`, favicon, files with extensions) are allowed
- **Everything else** requires a `__session` cookie to be present. If missing → redirect to `/` with a `redirect` query param for post-login return.

> **Note:** The middleware only checks cookie _presence_, not validity. Full HMAC verification happens in `requireAuth()` / `getSessionUser()` inside each route handler. This is intentional — middleware runs at the edge and should be fast; expensive crypto verification happens in the Node.js runtime.

---

## FAQ: "Can't Someone Just Run This Locally?"

Since the code is public and 1000+ admins can generate API keys, this is a natural concern. Here's why it doesn't work:

### Attack: Run a local BFF pointed at the production API

```
Attacker's BFF (local)                         Production API
  ME_BFF_API_KEY=my-key                         ME_BFF_API_KEY=real-secret
  F3_API_KEY=my-key
  │                                                  │
  │  GET /v1/me/profile                              │
  │  Authorization: Bearer my-key                    │
  │  X-User-Id: 5  (someone else)                    │
  │─────────────────────────────────────────────────▶│
  │                                                  │  getSession(): validate "my-key" ✓
  │                                                  │  meProtectedProcedure:
  │                                                  │    "my-key" == "real-secret"? ✗
  │                                                  │    X-User-Id IGNORED
  │                                                  │  returns attacker's own data
  │◀─────────────────────────────────────────────────│
```

**Why it fails:** The attacker controls their own env vars, but they can't change the production API's `ME_BFF_API_KEY`. Their bearer token doesn't match, so `X-User-Id` is ignored.

### Attack: Run a local API with a custom ME_BFF_API_KEY

The attacker sets `ME_BFF_API_KEY` to their own key on a local API server. Now their BFF's bearer token matches! But the local API needs `DATABASE_URL` for the production database to access real user data — and that's a secret they don't have. A local DB is empty/useless.

### Attack: Call the production API directly (curl, Postman, Scalar)

Same as the first scenario. Their API key isn't `ME_BFF_API_KEY`, so `X-User-Id` is ignored.

### What actually matters

The security of the entire system rests on **two operational secrets**:

| Secret                            | If Leaked                                             | Who Has Access                                                                           |
| --------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ME_BFF_API_KEY` (= `F3_API_KEY`) | Attacker can impersonate any user via `/me` endpoints | **Only** people with access to production deployment env vars (Cloud Run, Doppler, etc.) |
| `DATABASE_URL`                    | Attacker can read/write the entire database directly  | **Only** people with access to production deployment env vars or cloud console           |

**Neither of these is an API key that admins generate.** They are deployment-level secrets. The 1000+ admin-generated API keys are stored in the `api_keys` table and are completely separate from `ME_BFF_API_KEY`.

### The real risk: operational access, not the code

With 1000+ admins in a distributed network, the questions to ask are:

1. **Who can see production env vars?** (Cloud Run console, Doppler, CI/CD dashboards) — that list should be very small
2. **Who can see the production DATABASE_URL?** — anyone with this can bypass every auth layer entirely
3. **Are deployment dashboards access-controlled?** — env vars should never be visible to anyone who doesn't need them
4. **Are secrets rotated when people leave the inner ops circle?**

The code being public is irrelevant — security through obscurity was never the plan. The mechanism is sound (Kerckhoffs's principle). The operational discipline around who can access deployment secrets is what matters.

---

## Known Risks & Things to Watch

### 1. Session Cookie Forgery

**Risk:** If `SESSION_SECRET` is leaked, an attacker can create valid session cookies for any user ID.

**Mitigation:**

- Keep `SESSION_SECRET` in secure env management (Doppler, etc.)
- Rotate `SESSION_SECRET` periodically (this invalidates all existing sessions — users re-login)
- Never log or expose it in error messages

### 2. API Key Leakage

**Risk:** If `F3_API_KEY` / `ME_BFF_API_KEY` is leaked, an attacker can call `/me` endpoints with arbitrary `X-User-Id` and access any user's PII.

**Mitigation:**

- `F3_API_KEY` is only used in `apps/me/src/lib/api/client.ts`, which has the `"server-only"` import guard
- Rotate the key immediately if suspected compromise (update both `F3_API_KEY` and `ME_BFF_API_KEY`)
- Monitor API logs for unusual `X-User-Id` patterns

### 3. In-Memory Rate Limiter

**Risk:** In multi-instance deployments, rate limits are per-instance. An attacker can exceed intended limits by distributing requests across instances.

**Mitigation:** Migrate to a distributed rate limiter (Redis, Upstash) for production.

### 4. Dev Mode Mock Session

**Risk:** In development (`NODE_ENV=development`), if no API key or session is provided, `getSession()` returns a mock session with `id: 0`. This means unauthenticated requests can access protected endpoints locally.

**Mitigation:** This is intentional for developer ergonomics. Ensure `NODE_ENV=production` in all deployed environments.

### 5. Middleware Only Checks Cookie Presence

**Risk:** An expired or tampered cookie will pass middleware but fail in `requireAuth()`. This means the user might see a flash of the authenticated layout before being redirected.

**Mitigation:** Acceptable tradeoff for performance. The actual auth check in `requireAuth()` is the security boundary, not the middleware.

### 6. No Session Revocation

**Risk:** There's no mechanism to revoke a specific session cookie. If a user's cookie is stolen, it remains valid for up to 10 days.

**Mitigation:**

- Session cookies are HMAC-signed with a timestamp — they expire after `SESSION_COOKIE_MAX_AGE` (10 days)
- Rotating `SESSION_SECRET` revokes **all** sessions (nuclear option)
- Consider adding a session blocklist in the database for targeted revocation in the future

### 7. Email-Based User Lookup

**Risk:** The OAuth callback resolves email → userId via `lookupUserByEmail()`. If a user changes their email at the OAuth provider but not in the F3 database, login fails with "user not found."

**Mitigation:** This is a known limitation. Email synchronization between the OAuth provider and the F3 database should be handled as a future enhancement.

### 8. PII in /me Endpoints

**Risk:** The `/me/profile` endpoint returns sensitive PII: email, phone, emergency contact/phone/notes. These endpoints should never return another user's data to an unauthorized caller.

**Protected by:**

- `meProtectedProcedure` ensures X-User-Id override only works with the BFF's bearer token
- Direct API callers only see their own data
- The BFF verifies the session cookie before calling the API

---

## Checklist for Common Changes

### Adding a New /me Endpoint

1. Does it access or modify user-specific data? → Use `meProtectedProcedure`
2. Does it return PII? → Use `meProtectedProcedure`
3. Is it a general lookup (regions, positions list)? → `protectedProcedure` is fine
4. Add a BFF wrapper in `apps/me/src/lib/api/client.ts` that calls `getHeaders()` (which sets the Bearer token + X-User-Id)
5. Add a route handler in `apps/me/src/app/api/` that calls `requireAuth()` before the API call
6. Write tests for both the BFF route handler and the API endpoint

### Rotating SESSION_SECRET

1. Set `SESSION_SECRET` to a new random value in the BFF's environment
2. All existing session cookies become invalid
3. All users will need to re-login
4. No database changes needed

### Rotating the BFF API Key

1. Create a new API key in the `api_keys` database table
2. Update `F3_API_KEY` on the BFF
3. Update `ME_BFF_API_KEY` on the API server to the **same value**
4. Both must be updated together — if they don't match, the BFF can't override X-User-Id
5. Revoke the old key in the database (`revokedAt = now()`)

### Adding a New OAuth Provider

The BFF uses `f3-nation-auth-sdk` for OAuth. To add a new provider:

1. Configure the provider in the auth SDK
2. Update `OAUTH_*` env vars
3. The rest of the flow (callback, session cookie creation) is provider-agnostic

---

## Request Flow Diagrams

### Browser → Profile Page (Authenticated)

```
Browser                          BFF (apps/me)                  API (packages/api)
  │                                 │                               │
  │  GET /profile                   │                               │
  │  Cookie: __session=abc.sig      │                               │
  │────────────────────────────────▶│                               │
  │                                 │  middleware: cookie present ✓  │
  │                                 │  requireAuth(): verify HMAC ✓ │
  │                                 │  userId = 42                  │
  │                                 │                               │
  │                                 │  GET /v1/me/profile           │
  │                                 │  Authorization: Bearer {key}  │
  │                                 │  X-User-Id: 42               │
  │                                 │──────────────────────────────▶│
  │                                 │                               │  getSession(): validate key ✓
  │                                 │                               │  meProtectedProcedure:
  │                                 │                               │    bearer == ME_BFF_API_KEY? ✓
  │                                 │                               │    session.id = 42
  │                                 │                               │  fetchFullProfile(42)
  │                                 │  200 { user: {...} }          │
  │                                 │◀──────────────────────────────│
  │  200 HTML (profile page)        │                               │
  │◀────────────────────────────────│                               │
```

### Direct API Caller (Scalar / Mobile)

```
Scalar UI / Mobile App                              API (packages/api)
  │                                                       │
  │  GET /v1/me/profile                                   │
  │  Authorization: Bearer {their_api_key}                │
  │  X-User-Id: 9999  ← ATTACKER TRYING TO IMPERSONATE   │
  │──────────────────────────────────────────────────────▶│
  │                                                       │  getSession(): validate key ✓
  │                                                       │    session.id = 4 (key owner)
  │                                                       │  meProtectedProcedure:
  │                                                       │    bearer == ME_BFF_API_KEY? ✗
  │                                                       │    X-User-Id IGNORED
  │                                                       │    session.id stays 4
  │                                                       │  fetchFullProfile(4)
  │  200 { user: { id: 4, ... } }  ← THEIR OWN DATA     │
  │◀──────────────────────────────────────────────────────│
```
