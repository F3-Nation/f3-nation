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

### Step 1: JWT Access Tokens + API Verification (this PR)

**Goal:** Issue RS256 JWT access tokens from `apps/auth` and make `getSession()` in `packages/api` verify them cryptographically — zero DB lookups for auth, zero network calls after JWKS cache.

**Changes in apps/auth:**

1. Add `jose` dependency
2. Add `AUTH_JWT_PRIVATE_KEY` env var (PEM-encoded RS256 private key)
3. Replace `crypto.randomBytes()` with `jose.SignJWT()` in `exchangeAuthorizationCode()` and `exchangeRefreshToken()`
4. JWT claims: `sub` (user ID), `email`, `scope`, `client_id`, `iat`, `exp`
5. Serve public key at `/.well-known/jwks.json`
6. Update `validateAccessToken()` (userinfo) to decode JWT locally instead of DB lookup
7. Token revocation still deletes from DB (refresh tokens remain opaque)

**Changes in packages/api:**

1. Add `jose` dependency
2. Add `AUTH_JWKS_URL` env var (e.g. `https://auth.f3nation.com/.well-known/jwks.json`)
3. Add `getSessionFromJWT()` in `shared.ts` — verify bearer tokens with `jose.jwtVerify()` using cached remote JWKS
4. Resolution order: NextAuth cookie → JWT bearer → API key → dev mock

**What this enables:** Any app that authenticates through f3-nation-auth can call the API with `Authorization: Bearer {jwt}` and be recognized as the correct user. No DB round-trip, no per-app secrets.

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

## Compatibility Matrix

Each step is backwards-compatible. All existing auth methods continue working until explicitly removed.

| After Step | NextAuth JWT | F3-Auth JWT | API Key | X-User-Id          |
| ---------- | ------------ | ----------- | ------- | ------------------ |
| 1          | ✅           | ✅          | ✅      | ✅ (if on feat/me) |
| 2          | ✅           | ✅          | ✅      | ❌ removed         |
| 3          | ✅           | ✅          | ✅      | ❌                 |
| 4          | ❌ removed   | ✅          | ✅      | ❌                 |

---

## Env Var Changes by Step

| Step | Added                                                                                             | Removed                                            |
| ---- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1    | `AUTH_JWT_PRIVATE_KEY` (apps/auth), `AUTH_JWKS_URL` (packages/env)                                | —                                                  |
| 2    | —                                                                                                 | `ME_BFF_API_KEY`, `F3_API_KEY` (from apps/me)      |
| 3    | `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, `AUTH_PROVIDER_URL` (on apps/map) | NextAuth env vars from apps/map                    |
| 4    | —                                                                                                 | `AUTH_SECRET`, NextAuth env vars from packages/env |
