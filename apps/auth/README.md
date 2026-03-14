# F3 Auth — OAuth 2.0 / OpenID Connect Server

Central authentication and authorization server for the F3 Nation ecosystem. Issues OAuth 2.0 tokens to any registered client application (pax-vault, the-codex, apps/me, etc.) via the Authorization Code Grant with PKCE support.

- **Runtime**: Next.js 15 (App Router, standalone output)
- **Auth**: NextAuth.js v4 with email-based MFA (6-digit codes + magic links)
- **Database**: Drizzle ORM → Cloud SQL PostgreSQL (shared `@acme/db` schema)
- **Deployment**: Docker → Cloud Run (GCP), tag-triggered via GitHub Actions
- **Production URL**: `auth.f3nation.com`

> **Spec**: See [SEED.md](SEED.md) for the full architectural specification and design decisions.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [Authentication Flow](#authentication-flow)
- [API Reference](#api-reference)
- [UI Pages](#ui-pages)
- [OAuth Client Registration](#oauth-client-registration)
- [Database Schema](#database-schema)
- [Deployment](#deployment)
- [Development Notes](#development-notes)

---

## Quick Start

```bash
# From monorepo root — ensure Node >=20.19 and pnpm 8.15.1

# 1. Install dependencies
pnpm install

# 2. Copy and populate environment variables
#    (see Environment Variables section below)
cp .env.example .env

# 3. Start the dev server (port 3002)
pnpm dev --filter f3-auth

# 4. Open http://localhost:3002
```

### Build & Run Production Locally

```bash
# Build
pnpm build --filter f3-auth

# Start (standalone output)
pnpm -C apps/auth start
```

### Code Quality

```bash
# Lint
pnpm lint --filter f3-auth

# Format check
pnpm format --filter f3-auth

# Type check
pnpm -C apps/auth typecheck
```

---

## Environment Variables

All variables are server-side only. Defined and validated in `src/env.ts` using `@t3-oss/env-nextjs`.

| Variable           | Description                                                                 | Required                       |
| ------------------ | --------------------------------------------------------------------------- | ------------------------------ |
| `DATABASE_URL`     | PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/db`)   | Yes                            |
| `NEXTAUTH_SECRET`  | Secret for signing/encrypting JWTs. Generate with `openssl rand -base64 32` | Yes                            |
| `NEXTAUTH_URL`     | Base URL of the auth server (e.g. `https://auth.f3nation.com`)              | Yes                            |
| `F3_API_BASE_URL`  | F3 API endpoint for user management (e.g. `https://api.f3nation.com`)       | Yes                            |
| `F3_API_KEY`       | API key for authenticating calls to the F3 API                              | Yes                            |
| `SENDGRID_API_KEY` | SendGrid SMTP API key (used in production for transactional email)          | Yes                            |
| `EMAIL_FROM`       | Sender email address (e.g. `noreply@f3nation.com`)                          | Yes                            |
| `NODE_ENV`         | `development`, `production`, or `test`                                      | No (defaults to `development`) |

Set `SKIP_ENV_VALIDATION=1` to bypass validation during CI builds.

---

## Project Structure

```
apps/auth/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/route.ts   # NextAuth handler
│   │   │   ├── oauth/
│   │   │   │   ├── authorize/route.ts         # Authorization endpoint
│   │   │   │   ├── token/route.ts             # Token exchange endpoint
│   │   │   │   ├── userinfo/route.ts          # UserInfo endpoint
│   │   │   │   └── revoke/route.ts            # Token revocation (RFC 7009)
│   │   │   ├── .well-known/
│   │   │   │   └── openid-configuration/      # OIDC discovery document
│   │   │   ├── verify-email/route.ts          # Email MFA send/verify
│   │   │   ├── onboarding/route.ts            # Profile completion
│   │   │   ├── session/route.ts               # Enhanced session info
│   │   │   └── health/route.ts                # Liveness probe
│   │   ├── login/                             # Login UI pages
│   │   │   ├── page.tsx                       # Method selection
│   │   │   └── email/
│   │   │       ├── page.tsx                   # Email input
│   │   │       └── verify/page.tsx            # Code verification
│   │   ├── onboarding/page.tsx                # Profile setup form
│   │   ├── page.tsx                           # Home / OAuth entry point
│   │   ├── layout.tsx                         # Root layout
│   │   ├── providers.tsx                      # Session + Theme providers
│   │   └── globals.css                        # Tailwind + CSS variables
│   ├── lib/
│   │   ├── auth-options.ts                    # NextAuth v4 configuration
│   │   ├── oauth.ts                           # OAuth 2.0 server logic
│   │   ├── email-mfa.ts                       # Email code generation/verification
│   │   ├── db.ts                              # Drizzle database client
│   │   ├── cors.ts                            # Per-client CORS handling
│   │   └── rate-limit.ts                      # In-memory rate limiter
│   ├── types/
│   │   └── next-auth.d.ts                     # NextAuth type augmentation
│   └── env.ts                                 # Environment variable validation
├── scripts/
│   ├── add-client.ts                          # Interactive OAuth client CLI
│   └── cloud-run-env.sh                       # GCP Secret Manager setup
├── public/
├── Dockerfile                                 # Multi-stage Docker build
├── SEED.md                                    # Architectural specification
├── package.json
├── next.config.js
├── tsconfig.json
├── tailwind.config.ts
└── postcss.config.cjs
```

---

## Authentication Flow

### Email MFA Login (User-Facing)

```
User → /login → /login/email → enters email
                                    │
                                    ▼
                          POST /api/verify-email (action=send)
                          → generates 6-digit code
                          → SHA-256 hashes and stores in DB (10 min TTL)
                          → sends email via SendGrid with code + magic link
                                    │
                                    ▼
         /login/email/verify → user enters code (or clicks magic link)
                                    │
                                    ▼
                          POST /api/verify-email (action=verify)
                          → validates hash, checks attempts (max 5)
                          → creates user via F3 API if new
                          → returns user data
                                    │
                                    ▼
                          signIn("email-mfa") → JWT session created
                                    │
                                    ▼
              If onboarding incomplete → /onboarding (set f3Name, firstName, lastName)
              Else → redirect to original callbackUrl or home
```

### OAuth 2.0 Authorization Code Grant (Client App)

```
Client App → redirect to /api/oauth/authorize
             ?response_type=code
             &client_id=my-app
             &redirect_uri=https://app.example.com/callback
             &scope=openid profile email
             &state=random-csrf-token
             &code_challenge=...         (optional PKCE)
             &code_challenge_method=S256 (optional PKCE)
                         │
                         ▼
              User not logged in? → /login → (email MFA flow above)
              Onboarding incomplete? → /onboarding
              All good? → generate authorization code
                         │
                         ▼
              Redirect to: redirect_uri?code=AUTH_CODE&state=...
                         │
                         ▼
Client App → POST /api/oauth/token
             grant_type=authorization_code
             &code=AUTH_CODE
             &redirect_uri=...
             &client_id=...
             &client_secret=...
             &code_verifier=...          (if PKCE)
                         │
                         ▼
              Returns: { access_token, refresh_token, expires_in, token_type, scope }
                         │
                         ▼
Client App → GET /api/oauth/userinfo
             Authorization: Bearer ACCESS_TOKEN
                         │
                         ▼
              Returns: { sub, name, email, email_verified, picture }
```

---

## API Reference

### OAuth 2.0 Endpoints

| Method | Path                                | Description                                                                                                                                                       |
| ------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/oauth/authorize`              | Authorization endpoint. Validates client, authenticates user, returns authorization code via redirect. Supports PKCE (`code_challenge`, `code_challenge_method`). |
| `POST` | `/api/oauth/token`                  | Token endpoint. Exchanges authorization codes or refresh tokens for access/refresh tokens. Supports `client_secret_post` and `client_secret_basic` auth.          |
| `GET`  | `/api/oauth/userinfo`               | Returns user claims (`sub`, `name`, `email`, `email_verified`, `picture`) based on the access token's scope.                                                      |
| `POST` | `/api/oauth/revoke`                 | Revokes an access or refresh token (RFC 7009). Always returns 200.                                                                                                |
| `GET`  | `/.well-known/openid-configuration` | OpenID Connect discovery document. Lists all endpoints, supported scopes, grant types, and auth methods.                                                          |

### Internal Endpoints

| Method     | Path                      | Description                                                                                              |
| ---------- | ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET/POST` | `/api/auth/[...nextauth]` | NextAuth.js dynamic handler. Manages sessions, CSRF, sign-in/sign-out.                                   |
| `POST`     | `/api/verify-email`       | Send or verify an email MFA code. Body: `{ email, action?, code? }`. Rate-limited: 5 req/min per IP.     |
| `POST`     | `/api/onboarding`         | Save user profile (f3Name, firstName, lastName) and mark onboarding complete. Requires active session.   |
| `GET`      | `/api/session`            | Returns enriched user profile data (f3Name, firstName, lastName, email, avatarUrl, onboardingCompleted). |
| `GET`      | `/api/health`             | Returns `{ status: "ok" }`. Used as a Cloud Run liveness probe.                                          |

### OIDC Discovery

```
GET /.well-known/openid-configuration
```

```json
{
  "issuer": "https://auth.f3nation.com",
  "authorization_endpoint": "https://auth.f3nation.com/api/oauth/authorize",
  "token_endpoint": "https://auth.f3nation.com/api/oauth/token",
  "userinfo_endpoint": "https://auth.f3nation.com/api/oauth/userinfo",
  "revocation_endpoint": "https://auth.f3nation.com/api/oauth/revoke",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "scopes_supported": ["openid", "profile", "email"],
  "token_endpoint_auth_methods_supported": [
    "client_secret_post",
    "client_secret_basic"
  ]
}
```

---

## UI Pages

| Route                 | Purpose                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `/`                   | Home page. Forwards OAuth parameters to `/api/oauth/authorize` if present. Shows session info if authenticated. |
| `/login`              | Sign-in method selection (currently email only).                                                                |
| `/login/email`        | Email address input form. Submits to `/api/verify-email` to send a 6-digit code.                                |
| `/login/email/verify` | Code input form. Accepts magic link auto-fill via `?code=` query param. Calls NextAuth `signIn()` on success.   |
| `/onboarding`         | Profile completion form (F3 Name, First Name, Last Name). Required before OAuth codes are issued.               |

All pages use Tailwind CSS with HSL CSS variables for light/dark theme support via `next-themes`.

---

## OAuth Client Registration

### Interactive CLI

```bash
# Register a new OAuth client (local database)
pnpm -C apps/auth add-client

# Target staging or production
pnpm -C apps/auth add-client -- --env staging
pnpm -C apps/auth add-client -- --env prod
```

The CLI prompts for:

- **Client ID**: kebab-case identifier (e.g. `pax-vault`)
- **Client Secret**: auto-generated 32-byte base64url secret, or enter your own
- **Redirect URIs**: comma-separated (must be HTTPS in staging/prod)
- **Allowed Origins**: comma-separated (for CORS)
- **Scopes**: defaults to `openid profile email`

Production modifications require explicit confirmation.

### Programmatic Registration

```sql
INSERT INTO auth.oauth_clients (
  client_id, client_secret_hash, redirect_uris,
  allowed_origins, scopes, active
) VALUES (
  'my-app',
  encode(digest('my-secret', 'sha256'), 'hex'),
  '{"https://myapp.com/callback"}',
  '{"https://myapp.com"}',
  'openid profile email',
  true
);
```

---

## Database Schema

Auth-owned tables live in the `auth` PostgreSQL schema. User data is read from the `public.users` table (owned by `@acme/db`).

### `auth.oauth_clients`

Registered OAuth client applications.

| Column               | Type           | Description                     |
| -------------------- | -------------- | ------------------------------- |
| `id`                 | `serial` (PK)  | Internal ID                     |
| `client_id`          | `varchar(255)` | Unique client identifier        |
| `client_secret_hash` | `varchar(512)` | SHA-256 hash of client secret   |
| `redirect_uris`      | `text[]`       | Allowed redirect URIs           |
| `allowed_origins`    | `text[]`       | Allowed CORS origins            |
| `scopes`             | `text`         | Space-separated allowed scopes  |
| `active`             | `boolean`      | Whether client can authenticate |
| `created_at`         | `timestamp`    | Creation time                   |
| `updated_at`         | `timestamp`    | Last update time                |

### `auth.oauth_authorization_codes`

Short-lived authorization codes (10-minute TTL).

| Column                  | Type                | Description                      |
| ----------------------- | ------------------- | -------------------------------- |
| `code`                  | `varchar(512)` (PK) | The authorization code           |
| `client_id`             | `varchar(255)`      | FK to `oauth_clients.client_id`  |
| `user_id`               | `integer`           | FK to `public.users.id`          |
| `redirect_uri`          | `text`              | Redirect URI used in the request |
| `scopes`                | `text`              | Granted scopes                   |
| `code_challenge`        | `text`              | PKCE code challenge (nullable)   |
| `code_challenge_method` | `varchar(10)`       | `S256` or `plain` (nullable)     |
| `expires_at`            | `timestamp`         | Expiration time                  |
| `consumed`              | `boolean`           | Whether code has been exchanged  |

### `auth.oauth_access_tokens`

Bearer access tokens (1-hour TTL).

| Column       | Type                | Description                     |
| ------------ | ------------------- | ------------------------------- |
| `token`      | `varchar(512)` (PK) | The access token                |
| `client_id`  | `varchar(255)`      | FK to `oauth_clients.client_id` |
| `user_id`    | `integer`           | FK to `public.users.id`         |
| `scopes`     | `text`              | Granted scopes                  |
| `expires_at` | `timestamp`         | Expiration time                 |
| `revoked`    | `boolean`           | Whether token has been revoked  |

### `auth.oauth_refresh_tokens`

Long-lived refresh tokens (30-day TTL, rotation on use).

| Column       | Type                | Description                     |
| ------------ | ------------------- | ------------------------------- |
| `token`      | `varchar(512)` (PK) | The refresh token               |
| `client_id`  | `varchar(255)`      | FK to `oauth_clients.client_id` |
| `user_id`    | `integer`           | FK to `public.users.id`         |
| `scopes`     | `text`              | Granted scopes                  |
| `expires_at` | `timestamp`         | Expiration time                 |
| `revoked`    | `boolean`           | Whether token has been revoked  |

### `auth.email_mfa_codes`

Temporary email verification codes (10-minute TTL).

| Column       | Type           | Description                        |
| ------------ | -------------- | ---------------------------------- |
| `id`         | `serial` (PK)  | Internal ID                        |
| `email`      | `varchar(255)` | Email address                      |
| `code_hash`  | `varchar(512)` | SHA-256 hash of the 6-digit code   |
| `expires_at` | `timestamp`    | Expiration time                    |
| `consumed`   | `boolean`      | Whether code has been used         |
| `attempts`   | `integer`      | Verification attempt count (max 5) |
| `created_at` | `timestamp`    | Creation time                      |

All tables are defined in `packages/db/drizzle/schema.ts` using Drizzle ORM's `pgSchema("auth")`.

---

## Deployment

### Docker

The Dockerfile uses a 3-stage build for minimal image size:

1. **Builder**: `node:20-alpine` + turbo prune for minimal workspace
2. **Installer**: `pnpm install --frozen-lockfile` + `turbo build`
3. **Runner**: Standalone Next.js output, non-root user (`nextjs`, UID 1001), port 3002

```bash
# Build locally
docker build -f apps/auth/Dockerfile -t f3-auth .

# Run
docker run -p 3002:3002 --env-file .env f3-auth
```

### GitHub Actions (`.github/workflows/deploy-auth.yml`)

Triggered by tags matching `auth@*` (e.g. `auth@v1.0.0`).

| Job                 | Description                                                                           |
| ------------------- | ------------------------------------------------------------------------------------- |
| `ci-gate`           | Waits for CI checks to pass on the tagged commit                                      |
| `build`             | Builds Docker image, pushes to Artifact Registry (staging project)                    |
| `deploy-staging`    | Deploys to Cloud Run in the staging GCP project (automatic)                           |
| `deploy-production` | Promotes image to production Artifact Registry and deploys (manual approval required) |

**Infrastructure**:

- GCP Workload Identity Federation for keyless auth
- Artifact Registry for container images
- Cloud Run (us-east1) for compute
- GCP Secret Manager for secrets (see `scripts/cloud-run-env.sh`)

### GCP Secret Management

```bash
# Set up secrets and env vars for staging
bash apps/auth/scripts/cloud-run-env.sh --env staging

# Set up for production
bash apps/auth/scripts/cloud-run-env.sh --env prod
```

---

## Development Notes

### Relationship to `packages/auth`

The monorepo has `packages/auth` — a NextAuth v5 session config used by `apps/map`. That package handles cookie-based session auth for the map app only.

`apps/auth` is a full OAuth 2.0 authorization server that issues tokens to any registered client. These are separate systems:

|                      | `packages/auth`          | `apps/auth`                     |
| -------------------- | ------------------------ | ------------------------------- |
| **NextAuth version** | v5 (beta)                | v4                              |
| **Purpose**          | Session auth for map app | OAuth token issuer for all apps |
| **Consumers**        | `apps/map` only          | Any registered client           |
| **Session type**     | Cookie-based             | JWT-based                       |

The long-term plan is for `apps/map` to migrate to `apps/auth` as an OAuth client.

### Rate Limiting

The current rate limiter is in-memory (suitable for single Cloud Run instances). For multi-instance deployments, swap to Redis or Cloud Memorystore. See `src/lib/rate-limit.ts`.

### Email Transport

- **Production**: SendGrid SMTP (`smtp.sendgrid.net:465`)
- **Development**: Ethereal (auto-generated test account, preview URLs logged to console)

### Security Features

- PKCE support (S256 and plain methods)
- Constant-time secret comparison (`crypto.timingSafeEqual`)
- SHA-256 hashed codes and secrets (never stored in plaintext)
- Brute-force protection (max 5 attempts per code)
- Rate limiting on all public endpoints
- Per-client CORS with origin validation
- `httpOnly`, `secure`, `sameSite=none` cookies
- Non-root Docker user
