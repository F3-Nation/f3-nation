# Migrate to F3 Nation SSO (f3-nation-auth)

This document describes the plan to make `f3-nation-auth` the **single sign-on provider for all F3 apps**, replacing the legacy NextAuth setup in `apps/map` and `apps/api`.

---

## Current State

| App               | Auth System                          | Identity Proof                                         | Status                                        |
| ----------------- | ------------------------------------ | ------------------------------------------------------ | --------------------------------------------- |
| **apps/auth**     | f3-nation-auth (OAuth 2.0 server)    | Issues opaque access tokens (1h), refresh tokens (30d) | ✅ Built                                      |
| **apps/me**       | f3-nation-auth SDK (OAuth client)    | HMAC session cookie → static API key + X-User-Id       | ✅ Working, insecure impersonation workaround |
| **apps/map**      | NextAuth (email + OTP, JWT strategy) | NextAuth JWT cookie                                    | ✅ Working, legacy                            |
| **apps/api**      | NextAuth + API key auth              | Validates NextAuth JWTs OR api_keys table              | ✅ Working, legacy                            |
| **packages/auth** | NextAuth config                      | Shared by apps/map and apps/api                        | Legacy, to be removed                         |

### Problem

- `apps/me` can't prove user identity to the API because they use different auth systems
- The workaround (X-User-Id + ME_BFF_API_KEY shared secret) doesn't scale to more apps
- Two auth systems (NextAuth + f3-nation-auth) create maintenance burden and confusion

### Key Architectural Advantage

The API and auth server **share the same PostgreSQL database**. The `auth.oauth_access_tokens` table is accessible from `packages/api` via Drizzle — the API can validate f3-nation-auth tokens by direct DB lookup with zero network overhead. No HTTP introspection endpoint needed.

---

## Migration Plan

### Step 1: API Accepts F3-Auth Tokens (this PR)

**Goal:** Make `getSession()` in `packages/api/src/shared.ts` accept f3-nation-auth OAuth access tokens alongside NextAuth JWTs and legacy API keys. Zero breaking changes.

**Changes:**

1. **`packages/api/src/shared.ts`** — Add a new auth path in `getSession()`:

   - After NextAuth check fails, before API key lookup
   - Query `auth.oauth_access_tokens` table for the bearer token
   - If found and not expired, look up the user and build a session
   - Falls through to API key auth if not found (backwards compatible)

2. **`packages/env/src/index.ts`** — No changes needed (the DB connection is already shared)

**Resolution order in `getSession()` after this change:**

```
1. NextAuth session (JWT cookie)     ← legacy apps/map
2. F3-auth access token (DB lookup)  ← any f3-nation-auth app
3. API key (DB lookup)               ← Scalar, mobile, scripts
4. Dev mock session                  ← local dev only
```

**What this enables:** Any app that authenticates through f3-nation-auth can call the API with `Authorization: Bearer {access_token}` and be recognized as the correct user. No X-User-Id, no per-app secrets.

---

### Step 2: Migrate apps/me to Use Access Tokens

**Goal:** `apps/me` BFF passes the OAuth access token to the API instead of the X-User-Id workaround.

**Changes:**

1. **`apps/me` BFF** — Store the access token (and refresh token) in the session cookie or a server-side store. Send `Authorization: Bearer {access_token}` to the API.
2. **`apps/me` BFF** — Handle token refresh when access token expires (1h TTL).
3. **Remove** `X-User-Id` header, `ME_BFF_API_KEY`, `F3_API_KEY` (from the me app), and `meProtectedProcedure`.
4. The `/me` endpoints become regular `protectedProcedure` endpoints — `session.id` already contains the correct user ID.

**Impact:** Eliminates the entire impersonation attack surface. apps/me becomes "just another app" from the API's perspective.

---

### Step 3: Migrate apps/map to f3-nation-auth

**Goal:** Replace NextAuth in apps/map with f3-nation-auth OAuth.

**Changes:**

1. Replace NextAuth `SessionProvider` / `useSession()` with f3-nation-auth SDK flow
2. Use `packages/auth-sdk` for OAuth login (authorization code + PKCE)
3. Store access token in secure httpOnly cookie or BFF pattern
4. Send `Authorization: Bearer {access_token}` to the API
5. Handle token refresh (1h access token, 30d refresh token)

**Impact:** All users log in through the same auth server. Cross-app SSO works (login once, access map and me).

---

### Step 4: Remove NextAuth

**Goal:** Remove the legacy auth system entirely.

**Changes:**

1. Remove `packages/auth` (NextAuth config)
2. Remove `auth()` call from `getSession()` in shared.ts
3. Remove NextAuth-specific cookie configuration
4. Remove NextAuth-specific DB tables (auth_accounts, auth_sessions, auth_verification_tokens) or migrate users
5. Clean up `AUTH_SECRET` and other NextAuth env vars

**Impact:** Single auth system. Cleaner codebase. One fewer dependency (next-auth).

---

### Step 5 (Future): Switch to JWT Access Tokens

**Goal:** Eliminate per-request DB lookups for token validation.

**Changes in apps/auth:**

1. Generate RS256 key pair, store private key as env var
2. Replace `crypto.randomBytes()` with `jose.SignJWT()` in token issuance
3. Serve public key at `/.well-known/jwks.json`
4. Update userinfo to decode JWT instead of DB lookup

**Changes in packages/api:**

1. Replace DB token lookup with `jose.jwtVerify()` using remote JWKS
2. JWKS is cached automatically by the `jose` library

**Impact:** Zero DB queries for auth, zero network calls after JWKS cache. Better for high-throughput and multi-region deployments.

---

## Compatibility Matrix

Each step is backwards-compatible. All existing auth methods continue working until explicitly removed.

| After Step | NextAuth JWT | F3-Auth Token | API Key | X-User-Id          |
| ---------- | ------------ | ------------- | ------- | ------------------ |
| 1          | ✅           | ✅            | ✅      | ✅ (if on feat/me) |
| 2          | ✅           | ✅            | ✅      | ❌ removed         |
| 3          | ✅           | ✅            | ✅      | ❌                 |
| 4          | ❌ removed   | ✅            | ✅      | ❌                 |
| 5          | ❌           | ✅ (JWT)      | ✅      | ❌                 |

---

## Env Var Changes by Step

| Step | Added                                                                                             | Removed                                            |
| ---- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1    | —                                                                                                 | —                                                  |
| 2    | —                                                                                                 | `ME_BFF_API_KEY`, `F3_API_KEY` (from apps/me)      |
| 3    | `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, `AUTH_PROVIDER_URL` (on apps/map) | NextAuth env vars from apps/map                    |
| 4    | —                                                                                                 | `AUTH_SECRET`, NextAuth env vars from packages/env |
