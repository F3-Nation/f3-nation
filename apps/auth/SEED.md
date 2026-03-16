# F3 Nation Auth Provider — Specification

> **Origin**: Ported from [F3-Nation/f3-nation-auth](https://github.com/F3-Nation/f3-nation-auth).
> Refer to that repo for historical context, postmortems, and original implementation.

This document is the blueprint for `apps/auth` — the central OAuth 2.0 / OpenID
Connect authorization server for the F3 Nation ecosystem. It describes **how the
system should work** once integrated into this monorepo.

---

## 1. Architecture

### 1.1 What Ships

| Workspace               | Purpose                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **`apps/auth`**         | Next.js OAuth 2.0 / OIDC server, deployed at `auth.f3nation.com`                                                                     |
| **`packages/sso`** | TypeScript SDK consumed by any app that needs to authenticate against the auth server (e.g. `apps/me`, external apps like pax-vault) |

There is no standalone demo client app. `apps/me` serves as the primary reference
integration. The `packages/sso` README must contain a complete, step-by-step
client setup guide (see §12).

### 1.2 OAuth Consumers

Any F3 Nation application can register as an OAuth client. Known consumers today:

- **pax-vault** — F3 workout tracker
- **the-codex** — F3 community platform
- **`apps/me`** — User profile manager (in this monorepo)
- **`apps/map`** — (future) Will migrate from `packages/auth` to this provider

### 1.3 Environments

Each environment gets its own GCP project and Cloud Run service:

| Environment    | Domain                      | GCP Project | Notes                           |
| -------------- | --------------------------- | ----------- | ------------------------------- |
| **Production** | `auth.f3nation.com`         | TBD         | Serves all production consumers |
| **Staging**    | `staging.auth.f3nation.com` | TBD         | For integration testing         |
| **Local**      | `https://localhost:3000`    | N/A         | Dev with mkcert certificates    |

### 1.4 Relationship to `packages/auth`

The monorepo currently has `packages/auth` — a NextAuth v5 config used by
`apps/map`. That package handles session-based auth for the map app only.

`apps/auth` is a full **OAuth 2.0 authorization server** that issues tokens to
any registered client — a fundamentally different role. The long-term plan is
for `apps/auth` to become the single sign-on source for every F3 app, at which
point `packages/auth` will be retired.

Until that migration, both coexist. The SDK lives at `packages/sso` to
avoid naming conflicts.

---

## 2. Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Auth library**: NextAuth v4 with `@auth/drizzle-adapter`
- **ORM**: Drizzle ORM, integrated with `packages/db`
- **Database**: Cloud SQL PostgreSQL via **Cloud SQL Auth Proxy** (not direct `pg` connections)
- **Email**: SendGrid via SMTP (uses the monorepo's `packages/mail` where possible; falls back to direct SendGrid API for verification emails)
- **Styling**: Tailwind CSS (matches monorepo `tooling/tailwind` config)
- **Runtime**: Node.js on Cloud Run (not Edge — requires Node `crypto`, `pg` driver, and long-lived DB connections that Edge runtimes cannot support)
- **Themes**: `next-themes` for dark/light mode

---

## 3. Database Design

### 3.1 Schema Strategy

Auth owns **two categories** of tables:

1. **`public` schema — shared `users` table.** Auth reads and writes the existing
   `public.users` table defined in `packages/db`. User creation and profile
   updates go through `api.f3nation.com` to avoid race conditions with other apps
   writing to the same table. Auth reads user data directly from the database
   (via Cloud SQL Auth Proxy) for session enrichment and token validation.

2. **`auth` schema — auth-owned tables.** OAuth clients, authorization codes,
   tokens, and MFA codes live in a dedicated `auth` schema. Only `apps/auth`
   reads/writes these tables. The Drizzle schema explicitly pins tables to the
   `auth` schema so there is no reliance on `search_path`.

All auth-owned tables are defined in `packages/db` alongside the rest of the
monorepo's schema, keeping Drizzle migrations unified.

### 3.2 `public.users` (existing — no changes to table structure)

The existing users table in `packages/db`. Auth relies on these columns:

| Column           | Type                         | Auth Usage                                                           |
| ---------------- | ---------------------------- | -------------------------------------------------------------------- |
| `id`             | serial PK                    | Stable numeric user ID — used as `sub` in OAuth claims               |
| `f3_name`        | varchar                      | Returned as `name` in profile scope                                  |
| `first_name`     | varchar                      | Used during onboarding                                               |
| `last_name`      | varchar                      | Used during onboarding                                               |
| `email`          | citext NOT NULL UNIQUE       | Primary login identifier                                             |
| `avatar_url`     | varchar                      | Returned as `picture` in profile scope                               |
| `email_verified` | timestamp                    | Set when user verifies their email code                              |
| `meta`           | json (`UserMeta`)            | Stores `onboarding_completed: boolean` and other auth-specific flags |
| `status`         | user_status DEFAULT 'active' | Auth checks for active status before issuing tokens                  |

**Onboarding state**: The `onboarding_completed` flag lives in the `meta` JSON
field as `meta.onboarding_completed`. Auth checks this before issuing
authorization codes and redirects to `/onboarding` if false.

**User creation**: When a new email is verified and no user exists, auth calls
the F3 API (`POST /api/users` or equivalent) to create the user record. This
ensures all user creation goes through a single code path.

**User reads**: Auth reads `public.users` directly via the DB connection (read-only
access to `public` schema) for performance-critical paths like session callbacks
and token validation.

### 3.3 `auth.oauth_clients`

Registered OAuth client applications. Each consumer app (pax-vault, f3-me, etc.)
has a row here. Admins manage clients via CLI script or future admin UI.

| Column           | Type                                  | Notes                                                      |
| ---------------- | ------------------------------------- | ---------------------------------------------------------- |
| `id`             | text PK                               | Slug identifier, e.g. `f3-me-prod`                         |
| `name`           | text NOT NULL                         | Human-readable label                                       |
| `client_secret`  | text NOT NULL                         | 32-byte base64url token, compared with constant-time check |
| `redirect_uris`  | text NOT NULL                         | JSON array of allowed redirect URIs                        |
| `allowed_origin` | text NOT NULL                         | CORS origin for this client                                |
| `scopes`         | text DEFAULT `'openid profile email'` | Space-separated allowed scopes                             |
| `created_at`     | timestamp DEFAULT now()               |                                                            |
| `is_active`      | boolean DEFAULT true                  | Soft-disable a client without deleting                     |

### 3.4 `auth.oauth_authorization_codes`

Short-lived authorization codes generated during the OAuth authorize step.
Each code is single-use and deleted immediately after token exchange.

| Column                  | Type                          | Notes                                     |
| ----------------------- | ----------------------------- | ----------------------------------------- |
| `code`                  | text PK                       | 32-byte base64url, one-time use           |
| `client_id`             | text FK → oauth_clients(id)   |                                           |
| `user_id`               | integer FK → public.users(id) |                                           |
| `redirect_uri`          | text NOT NULL                 | Must match the original authorize request |
| `scopes`                | text                          | Space-separated                           |
| `code_challenge`        | text                          | PKCE challenge (S256 or plain)            |
| `code_challenge_method` | text                          | `'S256'` or `'plain'`                     |
| `expires_at`            | timestamp NOT NULL            | 10-minute TTL                             |
| `created_at`            | timestamp DEFAULT now()       |                                           |

### 3.5 `auth.oauth_access_tokens`

Opaque bearer tokens that clients present to access protected resources (e.g.
the userinfo endpoint). No user data is embedded — validation is always a DB lookup.

| Column       | Type                          | Notes                          |
| ------------ | ----------------------------- | ------------------------------ |
| `token`      | text PK                       | 32-byte opaque bearer token    |
| `client_id`  | text FK → oauth_clients(id)   |                                |
| `user_id`    | integer FK → public.users(id) |                                |
| `scopes`     | text                          | Space-separated scopes granted |
| `expires_at` | timestamp NOT NULL            | 1-hour TTL                     |
| `created_at` | timestamp DEFAULT now()       |                                |

### 3.6 `auth.oauth_refresh_tokens`

Long-lived tokens that clients use to obtain new access tokens without requiring
the user to re-authenticate. Refresh tokens are rotated on each use — the old
pair is deleted and a new pair is issued.

| Column       | Type                          | Notes                |
| ------------ | ----------------------------- | -------------------- |
| `token`      | text PK                       | 32-byte opaque token |
| `client_id`  | text FK → oauth_clients(id)   |                      |
| `user_id`    | integer FK → public.users(id) |                      |
| `expires_at` | timestamp NOT NULL            | 30-day TTL           |
| `created_at` | timestamp DEFAULT now()       |                      |

### 3.7 `auth.email_mfa_codes`

One-time email verification codes used during sign-in. Codes are stored as
SHA-256 hashes — the plaintext is never persisted. Only one active code exists
per email at a time; creating a new code invalidates any previous one.

| Column          | Type               | Notes                                           |
| --------------- | ------------------ | ----------------------------------------------- |
| `id`            | text PK            | UUID                                            |
| `email`         | text NOT NULL      | Indexed for lookup                              |
| `code_hash`     | text NOT NULL      | SHA-256 hex digest of 6-digit code              |
| `expires_at`    | timestamp NOT NULL | 10-minute TTL; indexed for cleanup              |
| `consumed_at`   | timestamp          | NULL until used or expired                      |
| `attempt_count` | integer DEFAULT 0  | Incremented on failed attempts; lockout after 5 |
| `created_at`    | timestamp NOT NULL |                                                 |

### 3.8 Tables NOT Carried Forward

The original auth repo had `session`, `account`, and `verificationToken` tables
required by the NextAuth Drizzle adapter. In practice:

- **`session`** — Empty. Unused because auth uses JWT strategy, not database sessions.
- **`account`** — Empty. Was for Google provider linking, which is deprecated.
- **`verificationToken`** — Empty. Replaced by the custom `email_mfa_codes` table.

These tables are **not created** in the new implementation. The monorepo already
has its own `auth_sessions`, `auth_accounts`, and `auth_verification_tokens`
tables in `packages/db` for `packages/auth` (used by `apps/map`). Those remain
untouched.

---

## 4. Authentication Flow

### 4.1 Email Sign-In (Two-Step)

1. **User submits email** → NextAuth `CredentialsProvider` `authorize()` fires
2. **Step 1 — Send code** (no `code` in credentials):
   - Generate 6-digit code via `crypto.randomInt(100000, 999999)`
   - Hash with SHA-256 and store in `auth.email_mfa_codes` (10-min TTL)
   - Clean up expired codes; replace any existing active code for this email
   - Send email via SendGrid with both the code and a magic link
   - Return `null` — user is not yet authenticated
3. **Step 2 — Verify code** (code present in credentials):
   - `verifyEmailCode()` checks hash match, expiry, attempt count
   - If attempt count ≥ 5, reject with lockout error
   - If valid → look up user in `public.users` by email
   - If no user exists → create via F3 API, set `meta.onboarding_completed = false`
   - Return user object → NextAuth creates JWT session

### 4.2 Magic Link

The verification email includes a clickable link that auto-fills the code:

```
{AUTH_URL}/login/email/verify?email={email}&code={code}
```

### 4.3 User Onboarding

First-time users (where `meta.onboarding_completed` is false or absent) are
redirected to `/onboarding` before any OAuth codes are issued:

- Required fields: **F3 Name** and **First/Last Name**
- Submit calls the F3 API to update the user profile
- Sets `meta.onboarding_completed = true`

---

## 5. OAuth 2.0 / OpenID Connect Provider

### 5.1 Supported Flows

| Feature        | Value                                               |
| -------------- | --------------------------------------------------- |
| Response types | `code` (Authorization Code only)                    |
| Grant types    | `authorization_code`, `refresh_token`               |
| PKCE           | S256 (recommended), plain                           |
| Token format   | Opaque (not JWT) — stored in DB                     |
| Client auth    | `client_secret_post`, `client_secret_basic`         |
| Scopes         | `openid`, `profile`, `email`                        |
| Claims         | `sub`, `name`, `email`, `email_verified`, `picture` |

### 5.2 Authorization Endpoint (`GET /api/oauth/authorize`)

1. Validate `response_type=code`, `client_id`, `redirect_uri`
2. Check client is active in DB and redirect URI is in the allowed list
3. Validate requested scopes against client's allowed scopes
4. If user not authenticated → redirect to `/login?callbackUrl=...`
5. If user not onboarded → redirect to `/onboarding?callbackUrl=...`
6. Store PKCE `code_challenge` and method if provided
7. Generate 32-byte auth code (10-minute TTL), store in `auth.oauth_authorization_codes`
8. Redirect to `redirect_uri?code={code}&state={state}`

### 5.3 Token Endpoint (`POST /api/oauth/token`)

**Authorization Code Exchange:**

1. Validate `grant_type=authorization_code`, `client_id`, `client_secret`, `code`, `redirect_uri`
2. Compare `client_secret` using constant-time comparison (`crypto.timingSafeEqual`)
3. Validate auth code exists, not expired, matches client + redirect URI
4. PKCE: if code has a `code_challenge`, require and verify `code_verifier`
5. Delete auth code (one-time use)
6. Create access token (1-hour TTL) and refresh token (30-day TTL) in DB
7. Return `{ access_token, token_type: "Bearer", expires_in: 3600, refresh_token, scope }`

**Refresh Token Exchange:**

1. Validate `grant_type=refresh_token`, `client_id`, `client_secret`, `refresh_token`
2. Find valid, unexpired refresh token in DB matching client
3. Delete old access + refresh tokens (rotation)
4. Create new token pair
5. Return same format as above

### 5.4 UserInfo Endpoint (`GET /api/oauth/userinfo`)

- Requires `Authorization: Bearer {accessToken}`
- Validates token exists and is not expired
- Returns claims based on token's scopes:
  - `sub` — always (the numeric user ID)
  - `name`, `picture` — if `profile` scope
  - `email`, `email_verified` — if `email` scope

### 5.5 OpenID Discovery (`GET /api/.well-known/openid-configuration`)

Returns a standards-compliant OIDC discovery document. Only advertises features
that are actually implemented (no JWKS URI, since tokens are opaque).

### 5.6 Token Revocation (`POST /api/oauth/revoke`)

Accepts an access token or refresh token and immediately deletes it from the DB.
If a refresh token is revoked, its associated access token is also deleted.

### 5.7 Client Management CLI (`apps/auth/scripts/add-client.ts`)

Interactive CLI script for registering and updating OAuth clients. Ported from
the original `auth-provider/scripts/add-client.ts` in the source repo.

**Usage:**

```bash
pnpm -C apps/auth add-client              # local (default)
pnpm -C apps/auth add-client --env staging
pnpm -C apps/auth add-client --env prod   # prompts for confirmation
```

**How it works:**

1. Loads `DATABASE_URL` from `.env.{env}` and opens a standalone `pg` pool
2. Prompts for **client name** — if a client with that name already exists, enters
   **update mode** (shows current config, regenerates the secret)
3. In **create mode**, prompts for:
   - **Client ID** — enter a slug like `pax-vault-prod`, or press Enter to
     auto-generate a 16-byte random ID
   - **Redirect URIs** — comma-separated; validated (must be HTTPS or localhost)
   - **Allowed origin** — the CORS origin for this client
   - **Scopes** — defaults to `openid profile email`
4. Prints a review summary and asks for confirmation
5. Generates a 32-byte `client_secret` via `crypto.randomBytes` (base64url)
6. Inserts or updates the `auth.oauth_clients` row via Drizzle
7. Prints the client ID and secret — **the secret cannot be retrieved later**

**Validation rules:**

- Client ID: lowercase alphanumeric with hyphens (`/^[a-z0-9][a-z0-9-]*[a-z0-9]$/`)
- Redirect URIs: must be valid HTTPS URLs (or `localhost` for local dev)
- Duplicate client IDs and names are rejected
- Production environment shows a warning prompt before proceeding

---

## 6. API Endpoints

| Method   | Path                                    | Purpose                                     |
| -------- | --------------------------------------- | ------------------------------------------- |
| GET/POST | `/api/auth/[...nextauth]`               | NextAuth handler (session, CSRF, callbacks) |
| POST     | `/api/verify-email`                     | Verify 6-digit code without consuming it    |
| POST     | `/api/onboarding`                       | Complete onboarding (F3 name + real name)   |
| GET      | `/api/session`                          | Enhanced session with DB-enriched user data |
| GET      | `/api/oauth/authorize`                  | OAuth authorization endpoint                |
| POST     | `/api/oauth/token`                      | Token exchange (auth code + refresh)        |
| GET      | `/api/oauth/userinfo`                   | User profile claims                         |
| POST     | `/api/oauth/revoke`                     | Token revocation                            |
| GET      | `/api/.well-known/openid-configuration` | OIDC discovery                              |
| GET      | `/api/health`                           | Health check (returns "ok")                 |

---

## 7. UI Pages

| Route                 | Purpose                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `/`                   | Authenticated home — shows user info or redirects to login; forwards OAuth params to authorize |
| `/login`              | Login options — "Sign in with Email" button                                                    |
| `/login/email`        | Email input form → triggers verification code send                                             |
| `/login/email/verify` | 6-digit code input → verifies and signs in                                                     |
| `/onboarding`         | Profile completion (F3 name + first/last name) — required before OAuth                         |

---

## 8. Security

### 8.1 Token Security

- **Opaque tokens**: 32-byte `crypto.randomBytes` encoded as base64url — no user data embedded
- **DB-backed**: All tokens stored in PostgreSQL; validation is always a DB lookup
- **One-time auth codes**: Deleted immediately after exchange
- **TTLs**: Auth codes 10 min, access tokens 1 hour, refresh tokens 30 days, MFA codes 10 min

### 8.2 Email Verification

- 6-digit code from `crypto.randomInt(100000, 999999)` (cryptographically secure)
- Stored as SHA-256 hash — plaintext never persisted
- **Brute-force lockout**: After 5 failed attempts, the code is rejected until it expires
- Only one active code per email; creating a new one invalidates the old one
- Expired codes cleaned up transactionally on new code creation

### 8.3 PKCE

- S256 (SHA-256 + base64url) and plain methods supported
- If auth code was created with a challenge, token exchange **requires** a matching verifier

### 8.4 CSRF / State Parameter

- State encoded as base64 JSON: `{ csrfToken, clientId, returnTo, timestamp }`
- Validated on callback by comparing `csrfToken`

### 8.5 Session Cookies

- `HttpOnly: true`, `Secure: true`, `SameSite: none` (required for cross-site OAuth flow)
- Cookie name: `__session` in production

### 8.6 CORS

- Per-client `allowed_origin` stored in DB
- OAuth endpoints allow `Content-Type, Authorization, Cookie` headers
- Credentials allowed (`Access-Control-Allow-Credentials: true`)

### 8.7 Client Secret Comparison

- All secret comparisons use `crypto.timingSafeEqual` to prevent timing attacks

### 8.8 Content Security Policy

- Login/onboarding pages: strict CSP with `nonce`-based script loading (no `unsafe-inline` or `unsafe-eval`)

### 8.9 Rate Limiting

- Token endpoint: rate-limited per client ID
- Verify-email endpoint: rate-limited per IP
- Authorize endpoint: rate-limited per IP

---

## 9. `packages/sso`

A lightweight TypeScript SDK that any F3 consumer app uses to integrate with the
auth server. Lives in the monorepo at `packages/sso` and is also published
to npm as `@acme/sso` for external consumers.

### Interface

```typescript
class AuthClient {
  constructor(config: AuthClientConfig);

  /** Returns public OAuth config (no secrets). Safe for client-side use. */
  getOAuthConfig(): OauthClient;

  /** Exchanges an authorization code for access + refresh tokens. Server-side only. */
  exchangeCodeForToken(params: { code: string }): Promise<AuthTokens>;

  /** Uses a refresh token to get a new access token. Server-side only. */
  refreshToken(params: { refreshToken: string }): Promise<AuthTokens>;

  /** Fetches user profile from the userinfo endpoint. Server-side only. */
  getUserInfo(accessToken: string): Promise<AuthUser>;

  /** Revokes an access or refresh token. Server-side only. */
  revokeToken(token: string): Promise<void>;
}
```

### Types

```typescript
interface AuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authServerUrl: string;
}

interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
  scope?: string;
}

interface AuthUser {
  sub: number;
  name?: string;
  email?: string;
  emailVerified?: boolean;
  picture?: string;
}

interface OauthClient {
  clientId: string;
  redirectUri: string;
  authServerUrl: string;
}
```

---

## 10. Environment Variables

### `apps/auth`

| Variable           | Purpose                                                                               |
| ------------------ | ------------------------------------------------------------------------------------- |
| `DATABASE_URL`     | Cloud SQL connection via Auth Proxy (`postgresql://user:pass@localhost:5432/f3_prod`) |
| `F3_API_BASE_URL`  | Base URL for F3 API (user creation, profile updates)                                  |
| `F3_API_KEY`       | API key for authenticating with the F3 API                                            |
| `NEXTAUTH_SECRET`  | JWT signing secret for NextAuth sessions                                              |
| `NEXTAUTH_URL`     | Canonical base URL (e.g. `https://auth.f3nation.com`)                                 |
| `SENDGRID_API_KEY` | SendGrid API key for verification emails                                              |
| `EMAIL_FROM`       | From address for verification emails                                                  |
| `NODE_ENV`         | `production` / `development`                                                          |

### `packages/sso` consumers

| Variable              | Purpose                                           |
| --------------------- | ------------------------------------------------- |
| `OAUTH_CLIENT_ID`     | Registered client ID from `auth.oauth_clients`    |
| `OAUTH_CLIENT_SECRET` | Client secret                                     |
| `OAUTH_REDIRECT_URI`  | Callback URL (must match registered redirect URI) |
| `AUTH_PROVIDER_URL`   | Auth server base URL                              |

---

## 11. Deployment

Follows the same pattern as `apps/me` (`deploy-me.yml` on the `feat/me` branch).

### 11.1 Docker Image

Multi-stage Dockerfile using `node:20-alpine`:

1. **Builder** — `turbo prune f3-auth --docker` to create a minimal workspace
2. **Installer** — `pnpm install --frozen-lockfile` + `pnpm turbo build --filter=f3-auth`
3. **Runner** — standalone Next.js output, non-root user, listens on configured port

No Doppler. No Firebase App Hosting.

### 11.2 GitHub Actions Pipeline (`.github/workflows/deploy-auth.yml`)

Triggered by pushing a tag matching `auth@*` (e.g. `auth@1.0.0`):

1. **CI gate** — waits for the `test-coverage` check to pass on the tagged commit
2. **Build** — builds the Docker image and pushes it to Artifact Registry in the
   staging GCP project
3. **Deploy staging** — deploys to Cloud Run in the staging project automatically.
   Uses a GitHub environment (`auth-staging`) for the deploy URL.
4. **Deploy production** — requires **manual approval** via a GitHub environment
   protection rule (`auth-production`). Promotes the same image from staging AR
   to the prod project's AR, then deploys to Cloud Run in the prod project.

Each environment is a separate GCP project, giving full isolation of secrets,
IAM, and networking:

| Environment | GCP Project (placeholder) | Service Name | Tag Example              |
| ----------- | ------------------------- | ------------ | ------------------------ |
| Staging     | `f3-auth-staging`         | `f3-auth`    | `auth@1.0.0`             |
| Production  | `f3-auth`                 | `f3-auth`    | same tag, after approval |

Authentication to GCP uses **Workload Identity Federation** (WIF) — no
long-lived service account keys.

### 11.3 Secrets Management

Secrets are stored in **GCP Secret Manager**, one set per GCP project. A
`scripts/cloud-run-env.sh` script (modeled on the same script in `apps/me`)
handles:

1. Creating/updating secrets in Secret Manager for the target environment
2. Granting the Cloud Run service account `secretAccessor` role
3. Updating the Cloud Run service with secret-backed env vars and plain env vars

```bash
# Push staging secrets + env vars
bash apps/auth/scripts/cloud-run-env.sh --env staging

# Push production secrets + env vars
bash apps/auth/scripts/cloud-run-env.sh --env prod
```

**Secret-backed vars** (stored in Secret Manager, mounted at runtime):

- `DATABASE_URL`, `NEXTAUTH_SECRET`, `SENDGRID_API_KEY`, `F3_API_KEY`

**Plain env vars** (set directly on Cloud Run, not sensitive):

- `NEXTAUTH_URL`, `F3_API_BASE_URL`, `EMAIL_FROM`, `NODE_ENV`

No Doppler. Secrets are scoped per GCP project — environment isolation comes
from the project boundary.

### 11.4 Database Connectivity

Cloud Run connects to Cloud SQL PostgreSQL via the **Cloud SQL Auth Proxy**
sidecar. The proxy handles IAM authentication and TLS — the app connects to
`localhost:5432` as if it were a local PostgreSQL instance.

This replaces the old direct `pg` connection with a plaintext `DATABASE_URL`,
which required exposing the DB to the public internet.

### 11.5 Health Check

`GET /api/health` returns `200 ok` for Cloud Run startup probes.

A future improvement: add a `/api/health/ready` endpoint that verifies the
database connection and `auth.oauth_clients` table is accessible, to catch
schema mismatches before serving traffic.

---

## 12. Client Setup Guide (`packages/sso` README)

The SDK README must walk a volunteer developer through the complete integration —
no assumed knowledge. This is the outline of what it should cover:

### Prerequisites

- A running auth server (local, staging, or production URL)
- A registered OAuth client (ID + secret from an admin)

### Step 1: Install the SDK

```bash
pnpm add @acme/sso
# or for monorepo consumers:
# add "sso": "workspace:*" to package.json
```

### Step 2: Set Environment Variables

Explain each variable, what it is, where to get it, with example values for
local development.

### Step 3: Create Server-Side Auth Helper

Show the exact code to create an `AuthClient` instance from env vars and export
reusable functions (`getOAuthConfig`, `exchangeCodeForToken`, etc.).

### Step 4: Build the Login Route

Show how to redirect the user to the auth server's authorize endpoint with
correct parameters (client_id, redirect_uri, state, scope, PKCE).

### Step 5: Build the Callback Route

Show the exact route handler code to:

1. Receive the authorization code
2. Validate the state parameter
3. Exchange the code for tokens
4. Store tokens in a session cookie
5. Redirect to the app

### Step 6: Build the Logout Route

Show how to clear the session and optionally revoke the token.

### Step 7: Protect Routes

Show middleware or wrapper patterns for checking session validity and refreshing
tokens when expired.

### Troubleshooting

Common errors and what they mean:

- "Invalid redirect URI" → your OAUTH_REDIRECT_URI doesn't match what's registered
- "Invalid client" → wrong client ID or secret
- "State mismatch" → CSRF check failed, usually a stale page
- CORS errors → `allowed_origin` in the client registration doesn't match your domain

### Full Working Example

Link to `apps/me` as the reference implementation with pointers to the specific
files that handle auth.

---

## 13. Drizzle Integration

Auth tables are defined in `packages/db` alongside all other monorepo tables,
using Drizzle's schema qualifier to pin them to the `auth` schema:

```typescript
import { pgSchema } from "drizzle-orm/pg-core";

export const authSchema = pgSchema("auth");

export const oauthClients = authSchema.table("oauth_clients", {
  // ...columns
});
```

Migrations are managed by the monorepo's unified `drizzle-kit` config. Running
`pnpm db:push` or `pnpm db:generate` includes both `public` and `auth` schema
tables.

The `auth` schema must be created once per database:

```sql
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO app_auth;
GRANT ALL ON ALL TABLES IN SCHEMA auth TO app_auth;
```

---

## 14. Migration Path from `packages/auth`

`packages/auth` currently handles authentication for `apps/map` via NextAuth v5
with email OTP. The plan to consolidate:

1. **Phase 1 (now)**: Build `apps/auth` + `packages/sso`. `apps/me` and
   external apps use the new auth server. `apps/map` continues using `packages/auth`.

2. **Phase 2**: Register `apps/map` as an OAuth client of `apps/auth`. Update
   `apps/map` to use `packages/sso` for login. Verify all roles/permissions
   still work.

3. **Phase 3**: Remove `packages/auth`. All apps authenticate through `apps/auth`.

This is not blocking for the initial build — both systems coexist safely.
