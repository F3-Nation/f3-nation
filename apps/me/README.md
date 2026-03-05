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

| Layer         | Choice                           |
| ------------- | -------------------------------- |
| Framework     | Next.js 15 (App Router)          |
| Styling       | TailwindCSS + shadcn/ui          |
| Auth          | F3 SSO (f3-nation-auth-sdk)      |
| API Backend   | F3 Nation API (api.f3nation.com) |
| Image Storage | Google Cloud Storage             |
| Hosting       | Firebase App Hosting             |
| Node          | 20.x                             |

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
└── apphosting.yaml               # Firebase App Hosting config
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
| `GCS_BUCKET`           | GCS bucket for avatars                  | `f3-logos`                                 |
| `GCS_CREDENTIALS`      | Base64-encoded GCS service account JSON | (from GCP)                                 |
| `NEXT_PUBLIC_SITE_URL` | Public URL of the app                   | `https://localhost:3003`                   |
| `ENVIRONMENT`          | Environment name                        | `local`                                    |

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

### Firebase App Hosting

The app is deployed via Firebase App Hosting with two separate GCP/Firebase projects — one for prod, one for staging. Each project has a backend named `f3-me`. Secret names are identical in both projects; isolation comes from the project boundary.

| Branch    | GCP Project                     | Backend | URL                       |
| --------- | ------------------------------- | ------- | ------------------------- |
| `main`    | `f3-me-profile-manager`         | `f3-me` | `me.f3nation.com`         |
| `staging` | `f3-me-profile-manager-staging` | `f3-me` | `staging.me.f3nation.com` |

### First-Time Setup

1. Create two Firebase/GCP projects:
   - `f3-me-profile-manager` (production)
   - `f3-me-profile-manager-staging` (staging)
2. Create an App Hosting backend in each project:
   ```bash
   cd apps/me
   firebase apphosting:backends:create --project f3-me-profile-manager
   # Backend ID: f3-me, Branch: main, Root: apps/me
   firebase apphosting:backends:create --project f3-me-profile-manager-staging
   # Backend ID: f3-me, Branch: staging, Root: apps/me
   ```
3. Populate environment files:
   - `.env.firebase.prod` with production values
   - `.env.firebase.staging` with staging values
4. Push secrets to each project:
   ```bash
   bash scripts/firebase-env.sh --env prod
   bash scripts/firebase-env.sh --env staging
   ```
5. Configure custom domains in each project's Firebase Console:
   - `me.f3nation.com` → `f3-me-profile-manager`
   - `staging.me.f3nation.com` → `f3-me-profile-manager-staging`

### Subsequent Deploys

- **Push to `main`** → prod project auto-builds and deploys
- **Push to `staging`** → staging project auto-builds and deploys
- **Update secrets**: Edit `.env.firebase.prod` or `.env.firebase.staging`, then run:
  ```bash
  bash scripts/firebase-env.sh --env prod      # or --env staging
  ```

### Firebase Project Aliases

Use `.firebaserc` aliases to switch between projects:

```bash
firebase use staging   # → f3-me-profile-manager-staging
firebase use prod      # → f3-me-profile-manager
```

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
- Session `sub` is always validated against the requested user ID — users can only edit their own profile.
- File uploads are validated for type (jpeg/png/webp/gif) and size (max 5MB).
- `meta` field updates merge with existing data — unknown keys are preserved.
- Position removal preserves all other users' assignments.
- Session cookies are `httpOnly`, `secure` in production, `sameSite: "lax"`.

## License

Internal — F3 Nation.
