# F3 Auth — OAuth 2.0 / OpenID Connect Server

Central authentication and authorization server for the F3 Nation ecosystem. Issues OAuth 2.0 tokens to any registered client application (pax-vault, the-codex, apps/me, etc.) via the Authorization Code Grant with PKCE support.

- **Runtime**: Next.js 15 (App Router, standalone output)
- **Auth**: NextAuth.js v5 with email-based MFA (6-digit codes + magic links)
- **Database**: Drizzle ORM → Cloud SQL PostgreSQL (shared `@acme/db` schema)
- **Deployment**: Docker → Cloud Run (GCP), tag-triggered via GitHub Actions
- **Production URL**: `auth.f3nation.com`

> **Spec**: See [SEED.md](SEED.md) for the design basis. SEED was the initiator. It should not be used going forward. It is kept as a reference.

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

# 3. Start the dev server (port 3004)
pnpm dev --filter f3-auth

# 4. Open http://localhost:3004
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

Defined and validated in `src/env.ts` using `@t3-oss/env-nextjs`. Variables prefixed with `NEXT_PUBLIC_` are exposed to the browser; all others are server-side only.

| Variable               | Description                                                                                   | Required                       |
| ---------------------- | --------------------------------------------------------------------------------------------- | ------------------------------ |
| `AUTH_JWT_PRIVATE_KEY` | RSA private key (PEM) for signing JWT access tokens (see below)                               | Yes                            |
| `AUTH_SECRET`          | Secret for signing/encrypting session JWTs. Generate with `openssl rand -base64 32`           | Yes                            |
| `DATABASE_HOST`        | PostgreSQL host (e.g. `/cloudsql/f3data:us-central1:f3data-nonprod` for Cloud SQL Auth Proxy) | Yes                            |
| `DATABASE_USER`        | PostgreSQL username (e.g. `app_auth`)                                                         | Yes                            |
| `DATABASE_PASSWORD`    | PostgreSQL password                                                                           | Yes                            |
| `DATABASE_NAME`        | PostgreSQL database name (e.g. `f3_staging`)                                                  | Yes                            |
| `NEXT_PUBLIC_AUTH_URL` | Base URL of the auth server (e.g. `https://auth.f3nation.com`)                                | Yes                            |
| `NEXT_PUBLIC_API_URL`  | F3 API endpoint for user management (e.g. `https://api.f3nation.com`)                         | Yes                            |
| `API_KEY`              | API key for authenticating calls to the F3 API                                                | Yes                            |
| `SENDGRID_API_KEY`     | SendGrid SMTP API key (used in production for transactional email)                            | Yes                            |
| `EMAIL_FROM`           | Sender email address (e.g. `noreply@f3nation.com`)                                            | Yes                            |
| `NODE_ENV`             | `development`, `production`, or `test`                                                        | No (defaults to `development`) |

Set `SKIP_ENV_VALIDATION=1` to bypass validation during CI builds.

### Shared vs. Auth-Only Variables

Most of these variables (`AUTH_SECRET`, `DATABASE_HOST`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME`, `API_KEY`, `SENDGRID_API_KEY`, `EMAIL_FROM`) are already in the root `.env` and shared across all apps. **You only need to define them once** — `apps/auth` reads from the same root `.env` as `apps/map` and `apps/api`.

The only variable unique to `apps/auth` is **`AUTH_JWT_PRIVATE_KEY`** — the RSA key for signing OAuth access tokens. Add it to your root `.env` alongside the existing variables. No duplication needed.

### Generating the JWT Private Key

The auth server signs OAuth access tokens as RS256 JWTs. You need an RSA key pair:

```bash
# Generate a 2048-bit RSA private key
openssl genpkey -algorithm RSA -out private.pem -pkeyopt rsa_keygen_bits:2048

# (Optional) Extract the public key (for verification by other services)
openssl rsa -in private.pem -pubout -out public.pem
```

Set `AUTH_JWT_PRIVATE_KEY` in your `.env` file. The value is the **full PEM contents** including the header/footer lines. Since `.env` files don't handle multi-line well, convert to a single line:

```bash
# Convert to single-line (use \n as literal newline markers)
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' private.pem
```

Then in `.env`:

```
AUTH_JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv...base64...\n-----END PRIVATE KEY-----"
```

The corresponding public key is served automatically at `/.well-known/jwks.json` (derived from the private key at runtime). API consumers (`packages/api`) fetch this JWKS endpoint to verify access token signatures without sharing the private key.

#### `NEXT_PUBLIC_AUTH_URL` in the Root `.env`

`packages/api` (via `packages/env`) reads `NEXT_PUBLIC_AUTH_URL` from the root `.env` to discover the auth server's JWKS public key and verify JWT access tokens. The JWKS URL is derived automatically: `${NEXT_PUBLIC_AUTH_URL}/.well-known/jwks.json`. This is the same variable that `apps/auth` uses for its own base URL — no extra env var needed.

```
# Root .env
NEXT_PUBLIC_AUTH_URL=https://auth.f3nation.com
```

- If `NEXT_PUBLIC_AUTH_URL` is **not set** in the root `.env`, the API ignores JWT auth entirely — existing auth flows (NextAuth cookies, API keys) continue to work unchanged.
- If `NEXT_PUBLIC_AUTH_URL` **is set**, the API fetches `${NEXT_PUBLIC_AUTH_URL}/.well-known/jwks.json`, accepts `Authorization: Bearer <jwt>` tokens, and validates the issuer matches.

---

## Project Structure

```
apps/auth/
├── src/
│   ├── app/
│   │   ├── .well-known/
│   │   │   ├── openid-configuration/route.ts  # OIDC discovery document
│   │   │   └── jwks.json/route.ts             # JWKS public key endpoint
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/route.ts   # NextAuth v5 handler
│   │   │   ├── oauth/
│   │   │   │   ├── authorize/route.ts         # Authorization endpoint
│   │   │   │   ├── token/route.ts             # Token exchange endpoint
│   │   │   │   ├── userinfo/route.ts          # UserInfo endpoint
│   │   │   │   └── revoke/route.ts            # Token revocation (RFC 7009)
│   │   │   ├── verify-email/route.ts          # Email MFA send/verify
│   │   │   ├── check-user/route.ts            # Email existence check
│   │   │   ├── regions/route.ts               # Active regions for registration
│   │   │   ├── register/route.ts              # New user creation via F3 API
│   │   │   ├── onboarding/route.ts            # Profile completion (legacy)
│   │   │   ├── session/route.ts               # Enhanced session info
│   │   │   └── health/route.ts                # Liveness probe
│   │   ├── login/                             # Login UI pages
│   │   │   ├── page.tsx                       # Method selection
│   │   │   └── email/
│   │   │       ├── page.tsx                   # Email input
│   │   │       └── verify/page.tsx            # Code verification + new user detection
│   │   ├── register/page.tsx                  # New user registration form
│   │   ├── onboarding/page.tsx                # Profile setup (legacy users)
│   │   ├── page.tsx                           # Home / OAuth entry point
│   │   ├── layout.tsx                         # Root layout
│   │   ├── providers.tsx                      # Session provider
│   │   └── globals.css                        # Tailwind + CSS variables
│   ├── lib/
│   │   ├── auth-options.ts                    # NextAuth v5 configuration
│   │   ├── auth.ts                            # NextAuth instance (handlers, auth, signIn, signOut)
│   │   ├── jwt.ts                             # RS256 JWT signing + JWKS generation
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
                          POST /api/check-user { email }
                          → checks if email exists in public.users
                                    │
                         ┌──────────┴──────────┐
                    User exists            User NOT found
                         │                      │
                         ▼                      ▼
               signIn("email-mfa")       Redirect to /register
               → verifies MFA code       (code + email in query params)
               → JWT session created            │
                         │                      ▼
                         │              /register → fill profile
                         │              (firstName*, lastName*, f3Name,
                         │               homeRegion, phone, emergency)
                         │                      │
                         │                      ▼
                         │              POST /api/register
                         │              → creates user via F3 API
                         │              → signIn("email-mfa")
                         │              → JWT session created
                         │                      │
                         └──────────┬───────────┘
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
              (access_token is an RS256 JWT — verified via JWKS, not DB lookup)
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
| `GET`  | `/.well-known/jwks.json`            | JSON Web Key Set. Contains the RS256 public key used to verify access tokens. Cached for 1 hour.                                                                  |

### Internal Endpoints

| Method     | Path                      | Description                                                                                                                                |
| ---------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET/POST` | `/api/auth/[...nextauth]` | NextAuth.js dynamic handler. Manages sessions, CSRF, sign-in/sign-out.                                                                     |
| `POST`     | `/api/verify-email`       | Send or verify an email MFA code. Body: `{ email, action?, code? }`. Rate-limited: 10 req/min per IP.                                      |
| `POST`     | `/api/check-user`         | Check if an email exists in `public.users`. Body: `{ email }`. Returns `{ exists: boolean }`.                                              |
| `GET`      | `/api/regions`            | Returns active regions (`orgType='region'`, `isActive=true`) for the registration dropdown. Returns `[{ id, name }]`.                      |
| `POST`     | `/api/register`           | Create a new user via the F3 API. Body: `{ email, firstName, lastName, f3Name?, homeRegionId?, phone?, emergency* }`. Rate-limited: 5/min. |
| `POST`     | `/api/onboarding`         | Save user profile (f3Name, firstName, lastName) and mark onboarding complete. Requires active session.                                     |
| `GET`      | `/api/session`            | Returns enriched user profile data (f3Name, firstName, lastName, email, avatarUrl, onboardingCompleted).                                   |
| `GET`      | `/api/health`             | Returns `{ status: "ok" }`. Used as a Cloud Run liveness probe.                                                                            |

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

| Route                 | Purpose                                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                   | Home page. Forwards OAuth parameters to `/api/oauth/authorize` if present. Shows session info if authenticated.                        |
| `/login`              | Sign-in method selection (currently email only).                                                                                       |
| `/login/email`        | Email address input form. Client-side email validation with regex. Submits to `/api/verify-email` to send a 6-digit code.              |
| `/login/email/verify` | Code input form. Checks if user exists first — existing users sign in, new users are redirected to `/register` with their MFA code.    |
| `/register`           | New user registration form. Collects First Name, Last Name, F3 Name, Home Region (searchable dropdown), Phone, Emergency Contact info. |
| `/onboarding`         | Profile completion form (F3 Name, First Name, Last Name). For legacy users who haven't completed onboarding.                           |

All pages use Tailwind CSS with HSL CSS variables (light mode, F3 Nation color scheme: cream background, white cards, F3 red primary).

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

- **Client name**: Human-readable name (e.g. `Pax Vault`)
- **Client ID**: kebab-case slug (e.g. `pax-vault`), or auto-generated
- **Client Secret**: auto-generated 32-byte base64url (stored as SHA-256 hash)
- **Redirect URIs**: comma-separated (must be HTTPS or localhost)
- **Allowed Origin**: CORS origin
- **Scopes**: defaults to `openid profile email`

Production modifications require explicit confirmation. The plaintext secret is displayed once and cannot be retrieved later.

### Programmatic Registration

```sql
INSERT INTO auth.oauth_clients (
  id, name, client_secret_hash, redirect_uris,
  allowed_origin, scopes, is_active
) VALUES (
  'my-app',
  'My App',
  encode(digest('my-secret', 'sha256'), 'hex'),
  '["https://myapp.com/callback"]',
  'https://myapp.com',
  'openid profile email',
  true
);
```

---

## Database Schema

Auth-owned tables live in the `auth` PostgreSQL schema. User data is read from the `public.users` table (owned by `@acme/db`).

### `auth.oauth_clients`

Registered OAuth client applications.

| Column               | Type        | Description                             |
| -------------------- | ----------- | --------------------------------------- |
| `id`                 | `text` PK   | Unique client identifier (slug or UUID) |
| `name`               | `text`      | Human-readable client name              |
| `client_secret_hash` | `text`      | SHA-256 hex hash of client secret       |
| `redirect_uris`      | `text`      | JSON array of allowed redirect URIs     |
| `allowed_origin`     | `text`      | Allowed CORS origin                     |
| `scopes`             | `text`      | Space-separated allowed scopes          |
| `created_at`         | `timestamp` | Creation time (UTC default)             |
| `is_active`          | `boolean`   | Whether client can authenticate         |

### `auth.oauth_authorization_codes`

Short-lived authorization codes (10-minute TTL).

| Column                  | Type        | Description                      |
| ----------------------- | ----------- | -------------------------------- |
| `code`                  | `text` PK   | The authorization code           |
| `client_id`             | `text`      | FK → `oauth_clients.id`          |
| `user_id`               | `integer`   | FK → `public.users.id`           |
| `redirect_uri`          | `text`      | Redirect URI used in the request |
| `scopes`                | `text`      | Granted scopes (nullable)        |
| `code_challenge`        | `text`      | PKCE code challenge (nullable)   |
| `code_challenge_method` | `text`      | `S256` or `plain` (nullable)     |
| `expires_at`            | `timestamp` | Expiration time                  |
| `created_at`            | `timestamp` | Creation time (UTC default)      |

### `auth.oauth_access_tokens`

> **Note**: With JWT access tokens, this table is no longer written to during token exchange. Access tokens are self-contained RS256 JWTs verified via the JWKS endpoint. The table is retained in the schema for potential future use (e.g., token blocklisting).

| Column       | Type        | Description                 |
| ------------ | ----------- | --------------------------- |
| `token`      | `text` PK   | The access token            |
| `client_id`  | `text`      | FK → `oauth_clients.id`     |
| `user_id`    | `integer`   | FK → `public.users.id`      |
| `scopes`     | `text`      | Granted scopes (nullable)   |
| `expires_at` | `timestamp` | Expiration time             |
| `created_at` | `timestamp` | Creation time (UTC default) |

### `auth.oauth_refresh_tokens`

Long-lived refresh tokens (30-day TTL, rotation on use).

| Column       | Type        | Description                 |
| ------------ | ----------- | --------------------------- |
| `token`      | `text` PK   | The refresh token           |
| `client_id`  | `text`      | FK → `oauth_clients.id`     |
| `user_id`    | `integer`   | FK → `public.users.id`      |
| `expires_at` | `timestamp` | Expiration time             |
| `created_at` | `timestamp` | Creation time (UTC default) |

### `auth.email_mfa_codes`

Temporary email verification codes (10-minute TTL).

| Column          | Type        | Description                        |
| --------------- | ----------- | ---------------------------------- |
| `id`            | `text` PK   | UUID                               |
| `email`         | `text`      | Email address                      |
| `code_hash`     | `text`      | SHA-256 hash of the 6-digit code   |
| `expires_at`    | `timestamp` | Expiration time                    |
| `consumed_at`   | `timestamp` | When code was used (nullable)      |
| `attempt_count` | `integer`   | Verification attempt count (max 5) |
| `created_at`    | `timestamp` | Creation time (UTC default)        |

All tables are defined in `packages/db/drizzle/schema.ts` using Drizzle ORM's `pgSchema("auth")`.

---

## Deployment

### First-Time Setup

These steps only need to be done once when setting up the CI/CD pipeline.

#### 1. Create GCP Artifact Registry repositories

Each project gets its own Artifact Registry. The build pushes to staging; the deploy-prod job copies the image to prod's registry.

```bash
# Staging
gcloud artifacts repositories create cloud-run-builds \
  --repository-format=docker \
  --location=us-east1 \
  --project=f3-authentication-staging

# Production
gcloud artifacts repositories create cloud-run-builds \
  --repository-format=docker \
  --location=us-east1 \
  --project=f3-authentication
```

#### 2. Create Cloud Run services

```bash
# Deploy a placeholder first (Cloud Run needs an initial image). Note that this enables Cloud SQL Auth Proxy

# Staging
gcloud run deploy f3-auth \
  --image=us-docker.pkg.dev/cloudrun/container/hello \
  --region=us-east1 \
  --project=f3-authentication-staging \
  --add-cloudsql-instances=f3data:us-central1:f3data-nonprod \
  --allow-unauthenticated

# Production
gcloud run deploy f3-auth \
  --image=us-docker.pkg.dev/cloudrun/container/hello \
  --region=us-east1 \
  --project=f3-authentication \
  --add-cloudsql-instances=f3data:us-central1:f3data \
  --allow-unauthenticated
```

#### 3. Set up Workload Identity Federation (WIF)

This lets GitHub Actions authenticate to GCP without service account keys. The WIF pool is shared across all F3 apps in the `f3-github` project — if it already exists (e.g. from the `apps/me` setup), skip to the service account steps.

```bash
# ── Skip if f3-github project + WIF pool already exist ──

gcloud projects create f3-github --name="F3 GitHub CI/CD"

gcloud services enable iam.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com cloudresourcemanager.googleapis.com \
  --project=f3-github

gcloud iam workload-identity-pools create "github-actions" \
  --location="global" \
  --display-name="GitHub Actions" \
  --project=f3-github

gcloud iam workload-identity-pools providers create-oidc "github" \
  --location="global" \
  --workload-identity-pool="github-actions" \
  --display-name="GitHub" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="attribute.repository==\"F3-Nation/f3-nation\"" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --project=f3-github

# Get the f3-github project number (used in SA bindings below)
gcloud projects describe f3-github --format='value(projectNumber)'
# ↑ Note this — referred to as WIF_PROJECT_NUMBER below
```

Make sure the org has a variable for the WIF Provider. Go to https://github.com/organizations/F3-Nation/settings/variables and make sure there is a variable called WIP_PROVIDER with value "projects/WIF_PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions/providers/github". (Make sure WIF_PROJECT_NUMBER uses the number from the previous step). This one provider is used for all F3 Nation repos to deploy to GCP.

```bash
# ── Staging SA ──
gcloud iam service-accounts create github-actions-deploy \
  --display-name="GitHub Actions Deploy" \
  --project=f3-authentication-staging

gcloud projects add-iam-policy-binding f3-authentication-staging \
  --member="serviceAccount:github-actions-deploy@f3-authentication-staging.iam.gserviceaccount.com" \
  --role="roles/run.admin"
gcloud projects add-iam-policy-binding f3-authentication-staging \
  --member="serviceAccount:github-actions-deploy@f3-authentication-staging.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"
gcloud projects add-iam-policy-binding f3-authentication-staging \
  --member="serviceAccount:github-actions-deploy@f3-authentication-staging.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

# Allow GitHub to impersonate the staging SA
gcloud iam service-accounts add-iam-policy-binding \
  github-actions-deploy@f3-authentication-staging.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/WIF_PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions/attribute.repository/F3-Nation/f3-nation" \
  --project=f3-authentication-staging

# ── Production SA ──
gcloud iam service-accounts create github-actions-deploy \
  --display-name="GitHub Actions Deploy" \
  --project=f3-authentication

gcloud projects add-iam-policy-binding f3-authentication \
  --member="serviceAccount:github-actions-deploy@f3-authentication.iam.gserviceaccount.com" \
  --role="roles/run.admin"
gcloud projects add-iam-policy-binding f3-authentication \
  --member="serviceAccount:github-actions-deploy@f3-authentication.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

# Prod SA needs AR read on staging (to pull the build image) and AR write on prod
gcloud projects add-iam-policy-binding f3-authentication-staging \
  --member="serviceAccount:github-actions-deploy@f3-authentication.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.reader"
gcloud projects add-iam-policy-binding f3-authentication \
  --member="serviceAccount:github-actions-deploy@f3-authentication.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

# Allow GitHub to impersonate the prod SA
gcloud iam service-accounts add-iam-policy-binding \
  github-actions-deploy@f3-authentication.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/WIF_PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions/attribute.repository/F3-Nation/f3-nation" \
  --project=f3-authentication
```

Replace `WIF_PROJECT_NUMBER` with the `f3-github` project number from the `gcloud projects describe` command above.

#### 54. Create GitHub Environments

In GitHub → repo Settings → **Environments**:

1. Create **`auth-staging`** — no special rules needed

- Add an Environment variable called WIF_SA and set it to github-actions-deploy@f3-authentication-staging.iam.gserviceaccount.com

2. Create **`auth-production`** — add **Required reviewers** (add yourself or your team)

- Add an Environment variable called WIF_SA and set it to github-actions-deploy@f3-authentication.iam.gserviceaccount.com

#### 5. Push secrets to Cloud Run

```bash
# Copy and populate env files from the example
cp apps/auth/.env.cloud-run.example apps/auth/.env.cloud-run.staging
cp apps/auth/.env.cloud-run.example apps/auth/.env.cloud-run.prod
# Edit each with the correct values

# Push to GCP
bash apps/auth/scripts/cloud-run-env.sh --env staging
bash apps/auth/scripts/cloud-run-env.sh --env prod
```

#### 6. Map custom domains

```bash
gcloud run domain-mappings create \
  --service=f3-auth \
  --domain=staging.auth.f3nation.com \
  --region=us-east1 \
  --project=f3-authentication-staging

gcloud run domain-mappings create \
  --service=f3-auth \
  --domain=auth.f3nation.com \
  --region=us-east1 \
  --project=f3-authentication
```

#### 7. Set Cloud SQL Permissions

This will allow Auth Proxy to work.

Make sure the Cloud SQL Admin API is enabled on the Data (postgres) GCP project and the Auth projects. Go to https://console.cloud.google.com/apis/library/sqladmin.googleapis.com, select the project from the top drop down and hit Enable if not enabled.

Get the service accounts Cloud Run is using. You will need to use the output to modify the next set of command.

```bash
gcloud run services describe f3-auth \
  --region=us-east1 \
  --project=f3-authentication-staging \
  --format="value(spec.template.spec.serviceAccountName)"

gcloud run services describe f3-auth \
  --region=us-east1 \
  --project=f3-authentication \
  --format="value(spec.template.spec.serviceAccountName)"
```

Take the output from above and insert it below into SA_EMAIL before running

```bash
gcloud projects add-iam-policy-binding f3data \
  --member="serviceAccount:615846288284-compute@developer.gserviceaccount.com" \
  --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding f3data \
  --member="serviceAccount:516015729503-compute@developer.gserviceaccount.com" \
  --role="roles/cloudsql.client"
```

---

### Docker

The Dockerfile uses a 3-stage build:

1. **Builder**: `node:20-alpine` + corepack/pnpm + turbo prune for minimal workspace
2. **Installer**: `pnpm install --frozen-lockfile` + `turbo build`
3. **Runner**: Standalone Next.js output, non-root user (`auth`, UID 1001), port 8080 (Cloud Run default)

```bash
# Build locally
docker build -f apps/auth/Dockerfile -t f3-auth .

# Run (Cloud Run injects $PORT; locally default is 8080)
docker run -p 8080:8080 --env-file .env f3-auth
```

### GitHub Actions (`.github/workflows/deploy-auth.yml`)

Triggered by tags matching `auth@*` (e.g. `auth@1.0.0`).

| Job                 | Description                                                                           |
| ------------------- | ------------------------------------------------------------------------------------- |
| `ci-gate`           | Waits for CI checks to pass on the tagged commit                                      |
| `build`             | Builds Docker image, pushes to Artifact Registry (staging project)                    |
| `deploy-staging`    | Deploys to Cloud Run in the staging GCP project (automatic)                           |
| `deploy-production` | Promotes image to production Artifact Registry and deploys (manual approval required) |

**Infrastructure**:

- GCP Workload Identity Federation for keyless auth (shared `WIF_PROVIDER`, per-app `WIF_SA_AUTH_*` variables)
- GCP project IDs hardcoded in workflow `env:` block (no GitHub variables needed)
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
| **NextAuth version** | v5 (beta)                | v5 (beta)                       |
| **Purpose**          | Session auth for map app | OAuth token issuer for all apps |
| **Consumers**        | `apps/map` only          | Any registered client           |
| **Session type**     | Cookie-based             | JWT-based                       |
| **Access tokens**    | N/A                      | RS256 JWTs (verified via JWKS)  |

The long-term plan is for `apps/map` to migrate to `apps/auth` as an OAuth client.

### Rate Limiting

The current rate limiter is in-memory (suitable for single Cloud Run instances). For multi-instance deployments, swap to Redis or Cloud Memorystore. See `src/lib/rate-limit.ts`.

### Email Transport

- **Production**: SendGrid SMTP (`smtp.sendgrid.net:465`)
- **Development**: Ethereal (auto-generated test account, preview URLs logged to console)

### CI Exclusion

`@acme/auth` is excluded from the root `lint:ws`, `typecheck`, and `ci:local` scripts because next-auth v5 (beta) has transient build/type issues when hoisted into the Turborepo workspace graph. The auth server has its own lint/typecheck commands (`pnpm -C apps/auth lint`, `pnpm -C apps/auth typecheck`) and is validated in its own CI workflow. This exclusion should be removed once the next-auth v5 stable release resolves the workspace compatibility issues.

### Security Features

- PKCE support (S256 and plain methods)
- Constant-time secret comparison (`crypto.timingSafeEqual`)
- SHA-256 hashed codes and secrets (never stored in plaintext)
- Brute-force protection (max 5 attempts per code)
- Rate limiting on all public endpoints
- Per-client CORS with origin validation
- `httpOnly`, `secure`, `sameSite=none` cookies (production); `sameSite=lax` in dev
- Non-root Docker user
