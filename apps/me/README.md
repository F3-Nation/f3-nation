# F3 Me — Profile Manager

A self-service profile editor for F3 Nation users. Authenticate via F3 SSO, view and update your profile data including name, avatar, emergency contacts, bio text, roles, and positions.

**Live URL**: [me.f3nation.com](https://me.f3nation.com)

## Why This Exists

F3 Nation users need a way to manage their own profile information without requiring admin intervention. F3 Me provides a simple, secure interface where authenticated users can:

- Update personal info (F3 name, real name, phone, home region)
- Upload a profile avatar
- Manage emergency contact information
- Write their F3 name origin story and "why"
- Control cross-region information sharing preferences
- Remove themselves from roles and positions

## Tech Stack

| Layer         | Choice                                   |
| ------------- | ---------------------------------------- |
| Framework     | Next.js 15 (App Router)                  |
| Styling       | TailwindCSS + shadcn/ui                  |
| Auth          | F3 SSO (`@f3nation/sso`) + token cookies |
| API Backend   | F3 Nation API (api.f3nation.com)         |
| Image Storage | Google Cloud Storage                     |
| Hosting       | GCP Cloud Run (via GitHub Actions)       |
| Node          | 24.x                                     |

## Auth Architecture

F3 Me uses [`@f3nation/sso`](../../packages/sso/README.md) for OAuth and OpenID Connect interactions with the F3 auth provider. The shared package is responsible for:

- Building the authorization URL
- Exchanging the authorization code for tokens
- Refreshing access tokens with the refresh token
- Fetching user info from the userinfo endpoint

F3 Me stores the OAuth access token and refresh token in `httpOnly` cookies and uses the access token directly when calling the F3 API.

Current auth flow:

1. `/api/auth/login` delegates to `handleLoginRoute` from `@f3nation/sso-next`, which generates CSRF + PKCE values, stores short-lived OAuth cookies, and redirects to the auth server. The app owns the cookie names and `flowCookieMaxAge`.
2. `/api/auth/callback` delegates to `handleCallbackRoute` from `@f3nation/sso-next`. The app supplies a custom adapter that wraps `@f3nation/sso` with structured logging, and owns cookie names/lifetimes, the error redirect target, and the `validateUser` hook.
3. Middleware refreshes the access token when needed using the refresh token.
4. Server-side routes call the F3 API with `Authorization: Bearer <access_token>`.
5. `/api/auth/logout` delegates to `handleLogoutRoute` from `@f3nation/sso-next`, which revokes the refresh token, clears all auth cookies, and returns `{ ok, redirectTo }` JSON so the client can navigate to the auth-server's post-logout endpoint.

The `@f3nation/sso-next` adapter handles the shared protocol mechanics (PKCE, state validation, token exchange, cookie writes). The app owns all policy decisions: cookie names and lifetimes, redirect targets, role/user validation, and per-event logging.

## Project Structure

```text
apps/me/
├── middleware.ts                  # Auth route protection
├── src/
│   ├── app/
│   │   ├── layout.tsx            # Root layout
│   │   ├── page.tsx              # Landing page (sign-in)
│   │   ├── profile/page.tsx      # Profile editor (protected)
│   │   └── api/
│   │       ├── auth/             # SSO auth routes
│   │       └── profile/          # Profile CRUD routes
│   ├── components/
│   │   ├── ui/                   # shadcn/ui primitives
│   │   ├── profile-form.tsx      # Main profile form
│   │   ├── avatar-upload.tsx     # File upload component
│   │   ├── region-select.tsx     # Searchable region picker
│   │   ├── role-list.tsx         # Removable role badges
│   │   └── position-list.tsx     # Removable position badges
│   └── lib/
│       ├── auth/                 # Auth utilities
│       ├── api/client.ts         # F3 API client (server-side)
│       ├── gcs.ts                # GCS upload helper
│       ├── types.ts              # TypeScript interfaces
│       └── utils.ts              # Utility functions
├── __tests__/                    # Test suite
├── scripts/                      # Deployment scripts
├── Dockerfile                    # Production container build
├── apphosting.yaml               # Cloud Run resource config (cpu, memory, etc.)
```

## Local Development

### Prerequisites

- Node.js 24.x (`nvm use` if you have nvm)
- pnpm (managed by the monorepo root)
- OAuth clients registered in the F3 auth provider (see [OAuth Client Registration](#oauth-client-registration) below)
- Admin F3 API key with edit permissions
- GCS service account credentials (base64-encoded, from GCP)

### Setup

```bash
# From the monorepo root
cd apps/me

# Copy and populate env file
cp .env.example .env
# Edit .env with actual values (get from team via Slack)

# Install dependencies (from monorepo root)
cd ../..
pnpm install

# Run the dev server
pnpm dev --filter f3-me
# Or from apps/me:
cd apps/me
pnpm dev
```

Open [https://localhost:3003](https://localhost:3003). Accept the self-signed certificate warning. Click "Sign in with F3 Nation" to authenticate.

### Environment Variables

| Variable               | Description                                                                               | Example                                    |
| ---------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------ |
| `OAUTH_CLIENT_ID`      | OAuth client ID                                                                           | `f3-me-local`                              |
| `OAUTH_CLIENT_SECRET`  | OAuth client secret                                                                       | (from auth provider)                       |
| `OAUTH_REDIRECT_URI`   | OAuth callback URL                                                                        | `https://localhost:3003/api/auth/callback` |
| `AUTH_PROVIDER_URL`    | F3 SSO base URL                                                                           | `https://auth.f3nation.com`                |
| `F3_API_BASE_URL`      | F3 API base URL (must include `/v1`)                                                      | `https://staging.api.f3nation.com/v1`      |
| `F3_CHANNEL`           | Storage bucket selection (`local`/`staging` → staging bucket, `prod` → production bucket) | `local`                                    |
| `GCS_CREDENTIALS`      | Base64-encoded GCS service account JSON                                                   | (from GCP)                                 |
| `NEXT_PUBLIC_SITE_URL` | Public URL of the app                                                                     | `https://localhost:3003`                   |

## Testing

```bash
# Run all tests (coverage always collected)
pnpm test

# Run tests in watch mode (no coverage)
pnpm test:watch
```

Tests are located in `__tests__/` and cover:

- Token parsing/expiry helpers
- API client functions
- Profile API route handlers (GET, PATCH)
- Avatar upload validation
- Role and position removal
- Utility functions

## Deployment

### Overview

f3-me uses **tag-based deployment** via GitHub Actions and GCP Cloud Run. This is different from the rest of the monorepo, which uses branch-per-environment deploys.

**How it works:**

1. You PR into `main` as usual — CI runs lint, typecheck, and tests
2. When you're ready to deploy, you tag the commit on `main` with `me@X.Y.Z`
3. GitHub Actions builds a Docker image **once**
4. The image deploys to **staging** automatically
5. You verify on staging, then go to GitHub Actions and **approve** the production deploy
6. The **same image** (no rebuild) deploys to **production**

```text
PR → main → tag me@1.2.3 → [CI passes] → build image → deploy staging → [approve] → deploy prod
```

### GCP Projects

| Environment | GCP Project         | Cloud Run Service | URL                       |
| ----------- | ------------------- | ----------------- | ------------------------- |
| Staging     | `f3-me-app-staging` | `f3-me`           | `staging.me.f3nation.com` |
| Production  | `f3-me-app`         | `f3-me`           | `me.f3nation.com`         |

### How to Deploy (Step by Step)

#### 1. Merge your PR into `main`

Wait for CI to pass on `main`. You can verify in the GitHub Actions tab.

#### 2. Tag the commit

From the command line:

```bash
# Make sure you're on main and up to date
git checkout main
git pull origin main

# Create the tag (use semantic versioning)
git tag me@1.0.0

# Push the tag to GitHub (this triggers the deploy)
git push origin me@1.0.0
```

Or from GitHub's web UI:

1. Go to the repo → **Releases** → **Draft a new release**
2. Click **Choose a tag** → type `me@1.0.0` → **Create new tag: me@1.0.0 on publish**
3. Set **Target** to `main` (or the specific commit SHA)
4. Click **Publish release**

**Tag naming:** Use `me@MAJOR.MINOR.PATCH` (e.g., `me@1.0.0`, `me@1.1.0`, `me@1.1.1`). The `me@` prefix scopes it to this app so other app tags won't trigger it.

#### 3. Monitor the staging deploy

Go to **Actions** → **Deploy f3-me** → click the running workflow. You'll see:

- **ci-check** — waits for CI to pass on this commit
- **build** — builds the Docker image and pushes to Artifact Registry
- **deploy-staging** — deploys to staging Cloud Run

Once staging is done, verify at [staging.me.f3nation.com](https://staging.me.f3nation.com).

#### 4. Approve the production deploy

Once you're satisfied with staging:

1. In the same workflow run, the **deploy-prod** job shows **"Waiting for review"**
2. Click **Review deployments**
3. Check the **me-production** environment
4. Click **Approve and deploy**

The same container image (no rebuild) deploys to production.

#### 5. Verify production

Check [me.f3nation.com](https://me.f3nation.com).

### Version History

To see all deployed versions:

```bash
git tag --list 'me@*' --sort=-version:refname
```

To see what changed between versions:

```bash
git log me@1.0.0..me@1.1.0 --oneline -- apps/me/
```

### First-Time Setup

See [docs/GCP_APP_SETUP.md](../../docs/GCP_APP_SETUP.md) for the full generalized walkthrough. Use these values in the variables block at the top of that doc:

```bash
APP_NAME="me"
CLOUDRUN_SERVICE="f3-me"
GCP_REGION="us-central1"
GCP_STAGING_PROJECT="f3-me-app-staging"
GCP_PROD_PROJECT="f3-me-app"
STAGING_DOMAIN="staging.me.f3nation.com"
PROD_DOMAIN="me.f3nation.com"
GH_STAGING_ENV="me-staging"
GH_PROD_ENV="me-production"
```

App-specific note: F3 Me requires OAuth clients registered in the auth provider — see [OAuth Client Registration](#oauth-client-registration) below.

### OAuth Client Registration

Before the app works, these OAuth clients must be registered in the auth provider:

| Client ID       | Redirect URI                                        | Environment |
| --------------- | --------------------------------------------------- | ----------- |
| `f3-me-local`   | `https://localhost:3003/api/auth/callback`          | Local dev   |
| `f3-me-prod`    | `https://me.f3nation.com/api/auth/callback`         | Production  |
| `f3-me-staging` | `https://staging.me.f3nation.com/api/auth/callback` | Staging     |

This requires access to the auth provider admin. The project owner handles this.

## Security Notes

- `@f3nation/sso` is used for OAuth operations only; Next.js responses, redirects, and cookie/session handling remain app-owned.
- The app stores `access_token` and `refresh_token` in `httpOnly` cookies and never exposes them to client-side JavaScript.
- Middleware refreshes expired access tokens using the refresh token before protected requests continue.
- Profile updates are authorized using the authenticated user's OAuth access token; users can only edit their own profile.
- File uploads are validated for type (jpeg/png/webp) and size (max 5MB).
- `meta` field updates merge with existing data — unknown keys are preserved.
- Position removal preserves all other users' assignments.
- Auth cookies are `httpOnly`, `secure` in production, `sameSite: "lax"`.

## License

Internal — F3 Nation.
