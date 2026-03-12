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

| Layer         | Choice                             |
| ------------- | ---------------------------------- |
| Framework     | Next.js 15 (App Router)            |
| Styling       | TailwindCSS + shadcn/ui            |
| Auth          | F3 SSO (f3-nation-auth-sdk)        |
| API Backend   | F3 Nation API (api.f3nation.com)   |
| Image Storage | Google Cloud Storage               |
| Hosting       | GCP Cloud Run (via GitHub Actions) |
| Node          | 20.x                               |

## Project Structure

```
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

- Node.js 20.x (`nvm use` if you have nvm)
- pnpm (managed by the monorepo root)
- OAuth clients registered in the F3 auth provider (see [OAuth Client Registration](#oauth-client-registration) below)
- Admin F3 API key with edit permissions
- GCS service account credentials (base64-encoded, from GCP)

### Setup

```bash
# From the monorepo root
cd apps/me

# Copy and populate env file
cp .env.local.example .env.local
# Edit .env.local with actual values (get from team via Slack)

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

| Variable               | Description                             | Example                                    |
| ---------------------- | --------------------------------------- | ------------------------------------------ |
| `OAUTH_CLIENT_ID`      | OAuth client ID                         | `f3-me-local`                              |
| `OAUTH_CLIENT_SECRET`  | OAuth client secret                     | (from auth provider)                       |
| `OAUTH_REDIRECT_URI`   | OAuth callback URL                      | `https://localhost:3003/api/auth/callback` |
| `AUTH_PROVIDER_URL`    | F3 SSO base URL                         | `https://auth.f3nation.com`                |
| `SESSION_SECRET`       | HMAC key for session cookies            | (random 64-char hex)                       |
| `F3_API_KEY`           | F3 Nation API key (admin/edit)          | (from team)                                |
| `F3_API_BASE_URL`      | F3 API base URL                         | `https://staging.api.f3nation.com`         |
| `GCS_BUCKET`           | GCS bucket for avatars                  | `f3-public-images-staging`                 |
| `GCS_CREDENTIALS`      | Base64-encoded GCS service account JSON | (from GCP)                                 |
| `NEXT_PUBLIC_SITE_URL` | Public URL of the app                   | `https://localhost:3003`                   |

## Testing

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage
```

Tests are located in `__tests__/` and cover:

- Session signing/verification
- API client functions
- Profile API route handlers (GET, PATCH)
- Avatar upload validation
- Role and position removal
- Utility functions

## Deployment

### Overview

f3-me uses **tag-based deployment** via GitHub Actions and GCP Cloud Run. This is different from the rest of the monorepo, which uses branch-per-environment deploys.

**How it works:**

1. You PR into `dev` as usual — CI runs lint, typecheck, and tests
2. When you're ready to deploy, you tag the commit on `dev` with `me@X.Y.Z`
3. GitHub Actions builds a Docker image **once**
4. The image deploys to **staging** automatically
5. You verify on staging, then go to GitHub Actions and **approve** the production deploy
6. The **same image** (no rebuild) deploys to **production**

```
PR → dev → tag me@1.2.3 → [CI passes] → build image → deploy staging → [approve] → deploy prod
```

### GCP Projects

| Environment | GCP Project                     | Cloud Run Service | URL                       |
| ----------- | ------------------------------- | ----------------- | ------------------------- |
| Staging     | `f3-me-app-staging` | `f3-me`           | `staging.me.f3nation.com` |
| Production  | `f3-me-app`         | `f3-me`           | `me.f3nation.com`         |

### How to Deploy (Step by Step)

#### 1. Merge your PR into `dev`

Wait for CI to pass on `dev`. You can verify in the GitHub Actions tab.

#### 2. Tag the commit

From the command line:

```bash
# Make sure you're on dev and up to date
git checkout dev
git pull origin dev

# Create the tag (use semantic versioning)
git tag me@1.0.0

# Push the tag to GitHub (this triggers the deploy)
git push origin me@1.0.0
```

Or from GitHub's web UI:

1. Go to the repo → **Releases** → **Draft a new release**
2. Click **Choose a tag** → type `me@1.0.0` → **Create new tag: me@1.0.0 on publish**
3. Set **Target** to `dev` (or the specific commit SHA)
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

These steps only need to be done once when setting up the CI/CD pipeline.

#### 1. Create GCP Artifact Registry repository

In the **staging** project (images are stored here and pulled by prod):

```bash
gcloud artifacts repositories create cloud-run-builds \
  --repository-format=docker \
  --location=us-east1 \
  --project=f3-me-app-staging
```

#### 2. Create Cloud Run services

```bash
# Staging — deploy a placeholder first (Cloud Run needs an initial image)
gcloud run deploy f3-me \
  --image=us-docker.pkg.dev/cloudrun/container/hello \
  --region=us-east1 \
  --project=f3-me-app-staging \
  --allow-unauthenticated

# Production
gcloud run deploy f3-me \
  --image=us-docker.pkg.dev/cloudrun/container/hello \
  --region=us-east1 \
  --project=f3-me-app \
  --allow-unauthenticated
```

#### 3. Set up Workload Identity Federation (WIF)

This lets GitHub Actions authenticate to GCP without service account keys.

```bash
# Create a Workload Identity Pool (do this once, can be shared across projects)
gcloud iam workload-identity-pools create "github-actions" \
  --location="global" \
  --display-name="GitHub Actions" \
  --project=f3-me-app-staging

# Create a provider in the pool
gcloud iam workload-identity-pools providers create-oidc "github" \
  --location="global" \
  --workload-identity-pool="github-actions" \
  --display-name="GitHub" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --project=f3-me-app-staging

# Create service accounts for GitHub Actions
# Staging SA:
gcloud iam service-accounts create github-actions-deploy \
  --display-name="GitHub Actions Deploy" \
  --project=f3-me-app-staging

# Grant it Cloud Run + Artifact Registry permissions
gcloud projects add-iam-policy-binding f3-me-app-staging \
  --member="serviceAccount:github-actions-deploy@f3-me-app-staging.iam.gserviceaccount.com" \
  --role="roles/run.admin"
gcloud projects add-iam-policy-binding f3-me-app-staging \
  --member="serviceAccount:github-actions-deploy@f3-me-app-staging.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"
gcloud projects add-iam-policy-binding f3-me-app-staging \
  --member="serviceAccount:github-actions-deploy@f3-me-app-staging.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

# Allow GitHub to impersonate the staging SA
gcloud iam service-accounts add-iam-policy-binding \
  github-actions-deploy@f3-me-app-staging.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions/attribute.repository/F3-Nation/f3-nation" \
  --project=f3-me-app-staging

# Production SA:
gcloud iam service-accounts create github-actions-deploy \
  --display-name="GitHub Actions Deploy" \
  --project=f3-me-app

gcloud projects add-iam-policy-binding f3-me-app \
  --member="serviceAccount:github-actions-deploy@f3-me-app.iam.gserviceaccount.com" \
  --role="roles/run.admin"
gcloud projects add-iam-policy-binding f3-me-app \
  --member="serviceAccount:github-actions-deploy@f3-me-app.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

# Prod SA also needs read access to staging's Artifact Registry (to pull the image)
gcloud projects add-iam-policy-binding f3-me-app-staging \
  --member="serviceAccount:github-actions-deploy@f3-me-app.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.reader"

# Allow GitHub to impersonate the prod SA
gcloud iam service-accounts add-iam-policy-binding \
  github-actions-deploy@f3-me-app.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/PROD_PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions/attribute.repository/F3-Nation/f3-nation" \
  --project=f3-me-app
```

Replace `PROJECT_NUMBER` and `PROD_PROJECT_NUMBER` with the actual GCP project numbers (find them with `gcloud projects describe PROJECT_ID --format='value(projectNumber)'`).

#### 4. Add GitHub Secrets

In GitHub → repo Settings → **Secrets and variables** → **Actions**, add:

| Secret              | Value                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `ME_WIF_PROVIDER`   | `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions/providers/github` |
| `ME_WIF_SA_STAGING` | `github-actions-deploy@f3-me-app-staging.iam.gserviceaccount.com`                    |
| `ME_WIF_SA_PROD`    | `github-actions-deploy@f3-me-app.iam.gserviceaccount.com`                            |

#### 5. Create GitHub Environments

In GitHub → repo Settings → **Environments**:

1. Create **`me-staging`** — no special rules needed
2. Create **`me-production`** — add **Required reviewers** (add yourself or your team)

#### 6. Push secrets to Cloud Run

```bash
# Copy and populate env files from the example
cp apps/me/.env.cloud-run.example apps/me/.env.cloud-run.staging
cp apps/me/.env.cloud-run.example apps/me/.env.cloud-run.prod
# Edit each with the correct values (same values as the old .env.firebase.* files)

# Push to GCP
bash apps/me/scripts/cloud-run-env.sh --env staging
bash apps/me/scripts/cloud-run-env.sh --env prod
```

#### 7. Map custom domains

```bash
gcloud run domain-mappings create \
  --service=f3-me \
  --domain=staging.me.f3nation.com \
  --region=us-east1 \
  --project=f3-me-app-staging

gcloud run domain-mappings create \
  --service=f3-me \
  --domain=me.f3nation.com \
  --region=us-east1 \
  --project=f3-me-app
```

Follow the DNS instructions output by the commands.

#### 8. Disconnect Firebase App Hosting (if previously set up)

In the Firebase Console for each project, go to **App Hosting** → select the `f3-me` backend → **Settings** → **Delete backend**. This stops Firebase from auto-deploying on branch pushes.

### OAuth Client Registration

Before the app works, these OAuth clients must be registered in the auth provider:

| Client ID       | Redirect URI                                        | Environment |
| --------------- | --------------------------------------------------- | ----------- |
| `f3-me-local`   | `https://localhost:3003/api/auth/callback`          | Local dev   |
| `f3-me-prod`    | `https://me.f3nation.com/api/auth/callback`         | Production  |
| `f3-me-staging` | `https://staging.me.f3nation.com/api/auth/callback` | Staging     |

This requires access to the auth provider admin. The project owner handles this.

## Security Notes

- The F3 API key (`F3_API_KEY`) is **never** exposed to the client. All API calls happen server-side.
- Profile updates are authorized using the authenticated session (resolved by email); users can only edit their own profile.
- File uploads are validated for type (jpeg/png/webp/gif) and size (max 5MB).
- `meta` field updates merge with existing data — unknown keys are preserved.
- Position removal preserves all other users' assignments.
- Session cookies are `httpOnly`, `secure` in production, `sameSite: "lax"`.

## License

Internal — F3 Nation.
