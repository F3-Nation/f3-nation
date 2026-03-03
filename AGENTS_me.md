# F3 Me — Agent Implementation Guide

> **Purpose**: This document provides everything an AI coding agent needs to build the F3 Me user profile management app from scratch. It includes architecture decisions, API contracts, auth flow, file structure, and step-by-step implementation instructions.
>
> **Target location in monorepo**: `apps/me/` (or equivalent directory in [F3-Nation/f3-nation](https://github.com/F3-Nation/f3-nation))
>
> **Live URL**: `me.f3nation.com`

---

## 1. Project Summary

A self-service profile editor for F3 Nation users. Users authenticate via F3 SSO, view their profile data pulled from the F3 Nation API, and update fields like name, avatar, emergency contacts, and free-form bio text. They can also remove themselves from roles and positions (but cannot add new ones).

---

## 2. Tech Stack

| Layer           | Choice                                                           | Notes                                                                                                                                       |
| --------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework       | **Next.js 15** (App Router)                                      | TypeScript, strict mode                                                                                                                     |
| Styling         | **TailwindCSS**                                                  |                                                                                                                                             |
| Components      | **shadcn/ui**                                                    | `button`, `input`, `textarea`, `select`, `label`, `card`, `dialog`, `avatar`, `badge`, `separator`, `toast`, `switch`, `command` (combobox) |
| Auth            | **F3 SSO** via `f3-nation-auth-sdk`                              | OAuth 2.0 Authorization Code + PKCE                                                                                                         |
| API             | **F3 Nation API** (`api.f3nation.com`)                           | Bearer API key, server-side only                                                                                                            |
| Image Storage   | **Google Cloud Storage** (existing `f3-logos` bucket or similar) | `@google-cloud/storage`                                                                                                                     |
| Hosting         | **Firebase App Hosting** (Cloud Run)                             | Prod + Staging                                                                                                                              |
| Node            | **20.x** (add `.nvmrc`)                                          |                                                                                                                                             |
| Package Manager | **npm**                                                          |                                                                                                                                             |

---

## 3. Decisions (Do Not Re-Ask)

These were explicitly confirmed by the project owner:

1. **API auth model**: The app holds a single server-side admin/edit API key. The server validates user identity via SSO session before proxying updates. Users never see the API key.
2. **User identity**: The SSO `sub` claim is the same as the `id` field in the F3 Nation API. Use `sub` to call `GET /v1/user/id/{sub}`.
3. **No email allowlist**: Any user who can authenticate via F3 SSO can use this app. Do NOT implement the BigQuery allowlist pattern from PAX Vault.
4. **UI**: Next.js + Tailwind + shadcn/ui. Do NOT use HeroUI or Ionic.
5. **Avatar upload**: File upload to GCS (existing bucket), not a URL text field.
6. **Region selector**: Searchable dropdown populated from the API, not free text.
7. **Role/position removal**: Roles removed via the user update endpoint; positions removed via the position assignment API.
8. **CI/CD**: Firebase App Hosting auto-deploy from GitHub branches (`main` → prod, `staging` → staging).

---

## 4. F3 Nation API Reference

**Base URLs**:

- Prod: `https://api.f3nation.com`
- Staging: `https://staging.api.f3nation.com`

**Required headers on every request**:

```
Authorization: Bearer {F3_API_KEY}
Client: f3-me
```

**Rate limit**: 200 requests / 60 seconds.

### 4.1 User Endpoints

| Method | Path                     | Use                                                                                                                     |
| ------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/v1/user/id/{id}`       | Load user profile by ID. Add `?includePii=true` for emergency/phone fields (requires admin key).                        |
| `GET`  | `/v1/user/email/{email}` | Lookup by email (fallback).                                                                                             |
| `POST` | `/v1/user`               | **Upsert**. Include `id` in body to update existing user. This is the only update mechanism — there is no PATCH or PUT. |
| `GET`  | `/v1/user`               | List users (paginated). Not needed for this app.                                                                        |

### 4.2 User Model (POST body for upsert)

```typescript
interface UserUpsert {
  id: number; // REQUIRED for update (= SSO sub)
  f3Name?: string;
  firstName?: string | null;
  lastName?: string;
  email?: string; // PII
  phone?: string; // PII
  homeRegionId?: number | null;
  avatarUrl?: string | null;
  meta?: string; // Free-form JSON string
  emergencyContact?: string | null; // PII
  emergencyPhone?: string | null; // PII
  emergencyNotes?: string | null; // PII
  status?: "active" | "inactive";
  roles?: { orgId: number; roleName: "user" | "editor" | "admin" }[];
}
```

**Important**: The `meta` field is a JSON string. The app stores these keys inside it:

- `f3_name_origin` (string, long text)
- `my_f3_why` (string, long text)
- `user_emergency_info_dr_sharing` (boolean)
- `start_date_override` (string, `yyyy-MM-dd`)
- Plus any other keys that already exist (preserve them)

When updating `meta`, parse the existing JSON, merge the editable keys, preserve all other keys, and re-serialize.

### 4.3 Org Endpoints (for region dropdown)

| Method | Path                                   | Use                                                                                              |
| ------ | -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET`  | `/v1/org?orgType=region&isActive=true` | List active regions for the home region dropdown. Returns array of `{ id, name, orgType, ... }`. |

### 4.4 Position Endpoints (for position removal)

| Method | Path                               | Use                                                                                                                 |
| ------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/v1/position/assignments/{orgId}` | Get all position assignments for an org. Returns `{ orgId, assignments: [{ positionId, positionName, userIds }] }`. |
| `PUT`  | `/v1/position/assignments`         | Replace all position assignments for an org. Body: `{ orgId, assignments: [{ positionId, userIds }] }`.             |

**Position removal flow**:

1. Determine which orgs the user has positions in (from user profile or a lookup).
2. For each org, `GET /v1/position/assignments/{orgId}`.
3. Find assignments where the user's ID is in `userIds`.
4. Remove the user's ID from those arrays.
5. `PUT /v1/position/assignments` with the updated list.

⚠️ This modifies org-level data. Be careful to preserve all other users' assignments.

---

## 5. Authentication (F3 SSO)

### 5.1 Overview

OAuth 2.0 Authorization Code flow with PKCE, delegating to `https://auth.f3nation.com`. The app does NOT run its own auth provider. It manages session cookies locally.

### 5.2 Auth Flow

```
User clicks "Sign in" →
  GET /api/auth/login?returnTo=/profile →
  Set oauth_csrf + oauth_code_verifier cookies →
  Redirect to AUTH_PROVIDER_URL/api/oauth/authorize (PKCE S256) →
  User authenticates on auth.f3nation.com (email → 6-digit code) →
  Redirect back to /api/auth/callback?code=...&state=... →
  Validate CSRF + state timestamp (10 min expiry) →
  Exchange code for access token (POST /api/oauth/token with code_verifier) →
  Fetch user info (GET /api/oauth/userinfo with Bearer token) →
  Create HMAC-signed __session cookie (10-day TTL) →
  Redirect to /profile
```

### 5.3 Session

- **Cookie name**: `__session` (Firebase App Hosting strips all cookies except those prefixed with `__`)
- **Payload**: `{ sub: string, email: string, name?: string, iat: number }`
- **Signing**: HMAC-SHA256 with `SESSION_SECRET` env var
- **Format**: `base64url(JSON).base64url(HMAC)`
- **TTL**: 10 days (configurable)
- **Verification**: timing-safe comparison of HMAC signature + expiry check

### 5.4 SDK Integration

```bash
npm install f3-nation-auth-sdk
```

```typescript
import { AuthClient, type AuthClientConfig } from "f3-nation-auth-sdk";

const config: AuthClientConfig = {
  client: {
    CLIENT_ID: process.env.OAUTH_CLIENT_ID!,
    CLIENT_SECRET: process.env.OAUTH_CLIENT_SECRET!,
    REDIRECT_URI: process.env.OAUTH_REDIRECT_URI!,
    AUTH_SERVER_URL: process.env.AUTH_PROVIDER_URL!, // https://auth.f3nation.com
  },
};

const authClient = new AuthClient(config);

// Get OAuth config (public, no secret)
const { CLIENT_ID, AUTH_SERVER_URL, REDIRECT_URI } =
  authClient.getOAuthConfig();

// Exchange code for tokens
const tokens = await authClient.exchangeCodeForToken({ code });

// Fetch user info (manual — SDK's getUser() is not implemented)
const res = await fetch(`${AUTH_SERVER_URL}/api/oauth/userinfo`, {
  headers: { Authorization: `Bearer ${tokens.accessToken}` },
});
const userInfo = await res.json(); // { sub, email, name? }
```

### 5.5 OAuth Client Registration

Before the app can work, these OAuth clients must be registered in the auth provider's database:

| Client ID       | Redirect URI                                                                  | Environment |
| --------------- | ----------------------------------------------------------------------------- | ----------- |
| `f3-me-local`   | `https://localhost:3001/api/auth/callback`                                    | Local dev   |
| `f3-me-prod`    | `https://me.f3nation.com/api/auth/callback`                                   | Production  |
| `f3-me-staging` | `https://staging.me.f3nation.com/api/auth/callback` (or Firebase default URL) | Staging     |

This requires access to the auth provider admin or its database. The project owner will handle this.

### 5.6 Reference Implementation

Copy the auth pattern from [F3-Nation/pax-vault](https://github.com/F3-Nation/pax-vault):

- `src/lib/auth/oauth.ts` — AuthClient wrapper
- `src/lib/auth/session.ts` — HMAC sign/verify
- `src/lib/auth/server.ts` — `getSessionUser()`, `requireAuth()`
- `src/lib/auth/AuthProvider.tsx` — client-side `useAuth()` hook
- `src/lib/auth/constants.ts` — cookie name, TTL
- `src/app/api/auth/login/route.ts` — builds authorize URL
- `src/app/api/auth/callback/route.ts` — handles callback
- `src/app/api/auth/me/route.ts` — returns current user
- `src/app/api/auth/logout/route.ts` — clears session
- `middleware.ts` — protects routes

**Key difference from PAX Vault**: Do NOT implement the BigQuery email allowlist (`src/lib/auth/allowlist.ts`). Skip that entirely — any SSO-authenticated user is authorized.

---

## 6. File Structure

```
apps/me/
├── .env.local.sample              # Template for local dev env vars
├── .env.firebase.sample           # Template for Firebase env vars
├── .firebaserc                    # Firebase project ID
├── .gitignore
├── .nvmrc                         # Node 20.x
├── AGENTS.md                      # This file
├── apphosting.yaml                # Firebase App Hosting config
├── components.json                # shadcn/ui config
├── firebase.json                  # Firebase config
├── middleware.ts                  # Auth route protection
├── next.config.ts                 # Next.js config
├── package.json
├── tailwind.config.ts
├── tsconfig.json
├── scripts/
│   └── firebase-env.sh           # Push secrets to GCP Secret Manager
├── src/
│   ├── app/
│   │   ├── layout.tsx            # Root layout (AuthProvider, Navbar, Toaster)
│   │   ├── page.tsx              # Landing page (sign-in card)
│   │   ├── profile/
│   │   │   └── page.tsx          # Profile page (protected, server component)
│   │   └── api/
│   │       ├── auth/
│   │       │   ├── login/route.ts
│   │       │   ├── callback/route.ts
│   │       │   ├── me/route.ts
│   │       │   └── logout/route.ts
│   │       └── profile/
│   │           ├── route.ts          # GET + PATCH user profile
│   │           ├── avatar/route.ts   # POST avatar upload
│   │           ├── roles/route.ts    # DELETE role
│   │           └── positions/route.ts # DELETE position
│   ├── components/
│   │   ├── ui/                   # shadcn/ui components (auto-generated)
│   │   ├── navbar.tsx
│   │   ├── auth-card.tsx
│   │   ├── profile-form.tsx      # Main profile editing form
│   │   ├── avatar-upload.tsx     # File upload component
│   │   ├── region-select.tsx     # Searchable region combobox
│   │   ├── role-list.tsx         # Removable role badges
│   │   └── position-list.tsx     # Removable position badges
│   └── lib/
│       ├── auth/
│       │   ├── oauth.ts
│       │   ├── session.ts
│       │   ├── server.ts
│       │   ├── AuthProvider.tsx
│       │   └── constants.ts
│       ├── api/
│       │   └── client.ts         # Server-side F3 API client
│       ├── gcs.ts                # Google Cloud Storage upload helper
│       ├── types.ts              # Shared TypeScript interfaces
│       └── utils.ts              # Helpers (fallback logo, etc.)
```

---

## 7. Implementation Steps (In Order)

### Step 1: Scaffold Next.js App

```bash
npx create-next-app@latest apps/me --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
cd apps/me
```

- Set up `.nvmrc` with `20`
- Configure `tsconfig.json` with `"strict": true` and `"paths": { "@/*": ["./src/*"] }`

### Step 2: Install Dependencies

```bash
npm install f3-nation-auth-sdk @google-cloud/storage
npm install -D @types/node
npx shadcn@latest init
npx shadcn@latest add button input textarea label card avatar badge separator toast switch command select dialog
```

### Step 3: Environment Variables

Create `.env.local.sample`:

```env
# Auth (F3 SSO)
OAUTH_CLIENT_ID=f3-me-local
OAUTH_CLIENT_SECRET=<get-from-auth-provider>
OAUTH_REDIRECT_URI=https://localhost:3001/api/auth/callback
AUTH_PROVIDER_URL=https://auth.f3nation.com
SESSION_SECRET=<generate-random-64-char-hex>

# F3 Nation API
F3_API_KEY=<admin-api-key-from-f3-nation>
F3_API_BASE_URL=https://staging.api.f3nation.com

# Google Cloud Storage (avatar uploads)
GCS_BUCKET=f3-logos
GCS_CREDENTIALS=<service-account-json-base64-encoded>

# App
NEXT_PUBLIC_SITE_URL=https://localhost:3001
ENVIRONMENT=local
```

### Step 4: Implement Auth (copy from PAX Vault, adapt)

**`src/lib/auth/constants.ts`**:

```typescript
export const SESSION_COOKIE_NAME = "__session";
export const SESSION_COOKIE_DAYS = 10;
export const SESSION_COOKIE_MAX_AGE = SESSION_COOKIE_DAYS * 24 * 60 * 60;
```

**`src/lib/auth/session.ts`**: HMAC sign/verify — copy from pax-vault verbatim.

**`src/lib/auth/oauth.ts`**: AuthClient wrapper — copy from pax-vault. Keep `getOAuthConfig()`, `exchangeCodeForToken()`, and `getUserInfo()`.

**`src/lib/auth/server.ts`**: `getSessionUser()` and `requireAuth()` — copy from pax-vault.

**`src/lib/auth/AuthProvider.tsx`**: Client-side context — copy from pax-vault.

**`src/app/api/auth/login/route.ts`**: Build authorize URL with PKCE. Default `returnTo` should be `/profile` (not `/stats/nation`).

**`src/app/api/auth/callback/route.ts`**: Handle callback. **Remove the allowlist check** (`isAuthorizedEmail`). After getting user info, create session cookie directly.

**`src/app/api/auth/me/route.ts`**: Return `{ user }` from session cookie.

**`src/app/api/auth/logout/route.ts`**: Clear `__session` cookie.

**`middleware.ts`**: Protect all routes except `/`, `/api/auth/*`. Check `__session` cookie. Redirect unauthenticated users to `/?redirect={path}`.

### Step 5: Implement API Client

**`src/lib/api/client.ts`**:

```typescript
const API_BASE = process.env.F3_API_BASE_URL!;
const API_KEY = process.env.F3_API_KEY!;

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  Client: "f3-me",
  "Content-Type": "application/json",
};

export async function getUser(id: number) {
  const res = await fetch(`${API_BASE}/v1/user/id/${id}?includePii=true`, {
    headers,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function updateUser(body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}/v1/user`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function getRegions() {
  const res = await fetch(`${API_BASE}/v1/org?orgType=region&isActive=true`, {
    headers,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function getPositionAssignments(orgId: number) {
  const res = await fetch(`${API_BASE}/v1/position/assignments/${orgId}`, {
    headers,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function updatePositionAssignments(
  orgId: number,
  assignments: { positionId: number; userIds: number[] }[],
) {
  const res = await fetch(`${API_BASE}/v1/position/assignments`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ orgId, assignments }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
```

### Step 6: Implement GCS Upload Helper

**`src/lib/gcs.ts`**:

```typescript
import { Storage } from "@google-cloud/storage";

function getStorage() {
  const creds = JSON.parse(
    Buffer.from(process.env.GCS_CREDENTIALS!, "base64").toString(),
  );
  return new Storage({ credentials: creds });
}

export async function uploadAvatar(
  userId: number,
  file: Buffer,
  filename: string,
  contentType: string,
): Promise<string> {
  const bucket = getStorage().bucket(process.env.GCS_BUCKET!);
  const path = `avatars/${userId}/${Date.now()}-${filename}`;
  const blob = bucket.file(path);

  await blob.save(file, {
    metadata: { contentType },
    public: true,
  });

  return `https://storage.googleapis.com/${process.env.GCS_BUCKET}/${path}`;
}
```

### Step 7: Implement Profile API Routes

**`src/app/api/profile/route.ts`** — GET and PATCH:

```typescript
// GET: load profile
// 1. requireAuth() → get sub from session
// 2. getUser(Number(sub)) from API client
// 3. Return user data (parse meta JSON for display)

// PATCH: update profile
// 1. requireAuth() → get sub from session
// 2. Validate body (only allow editable fields)
// 3. If meta fields changed, parse existing meta, merge, re-serialize
// 4. Call updateUser({ id: Number(sub), ...validatedFields })
// 5. Return updated user
```

**Editable fields** (whitelist — reject anything else):

- `avatarUrl`, `emergencyContact`, `emergencyNotes`, `emergencyPhone`
- `f3Name`, `firstName`, `lastName`, `homeRegionId`, `phone`
- `meta` (containing: `f3_name_origin`, `my_f3_why`, `user_emergency_info_dr_sharing`, `start_date_override`)

**`src/app/api/profile/avatar/route.ts`** — POST:

```typescript
// 1. requireAuth()
// 2. Parse multipart form data (file + metadata)
// 3. Validate: file type (jpeg/png/webp/gif), max 5MB
// 4. Upload to GCS via uploadAvatar()
// 5. Update user's avatarUrl via updateUser()
// 6. Return { avatarUrl }
```

**`src/app/api/profile/roles/route.ts`** — DELETE:

```typescript
// 1. requireAuth()
// 2. Body: { orgId, roleName }
// 3. Fetch current user to get roles array
// 4. Filter out the specified role
// 5. Call updateUser({ id, roles: filteredRoles })
// 6. Return updated roles
```

**`src/app/api/profile/positions/route.ts`** — DELETE:

```typescript
// 1. requireAuth()
// 2. Body: { orgId, positionId }
// 3. getPositionAssignments(orgId)
// 4. Find the assignment for positionId
// 5. Remove userId from that assignment's userIds array
// 6. updatePositionAssignments(orgId, updatedAssignments)
// 7. Return success
```

### Step 8: Implement Pages

**`src/app/page.tsx`** (Landing):

- F3 branding, environment badge
- If authenticated → redirect to `/profile`
- If not → show sign-in card with "Sign in with F3 Nation" button
- Handle error query params from auth flow

**`src/app/profile/page.tsx`** (Profile — protected):

- Server component: calls `requireAuth()`, loads user data server-side
- Passes data to `<ProfileForm />` client component
- Also loads regions list server-side for the dropdown

**`src/app/layout.tsx`** (Root):

- HTML shell, Tailwind globals, font loading
- `<AuthProvider>` wrapper
- `<Navbar />` with F3 logo, user avatar, sign out button
- `<Toaster />` for notifications
- Theme: dark mode support (F3 brand is dark-themed)

### Step 9: Implement Components

**`src/components/profile-form.tsx`** — The main form (client component, `"use client"`):

- Receives user data + regions list as props
- Sections (use shadcn Card for each):
  1. **Header**: avatar preview with upload button, F3 name, region
  2. **Personal Info**: `f3Name` (Input), `firstName` (Input), `lastName` (Input), `phone` (Input), `homeRegionId` (RegionSelect combobox)
  3. **Emergency Contact**: `emergencyContact` (Input), `emergencyPhone` (Input), `emergencyNotes` (Textarea)
  4. **About Me**: `f3_name_origin` (Textarea, from meta), `my_f3_why` (Textarea, from meta), `start_date_override` (Input type="date", from meta), `user_emergency_info_dr_sharing` (Switch + description text: "If enabled, users can search for your info from other Slack workspaces.")
  5. **Roles**: `<RoleList />` — read-only badges with X buttons
  6. **Positions**: `<PositionList />` — read-only badges with X buttons
- Save button → PATCH `/api/profile`
- Toast on success/error
- Loading/disabled states during save

**`src/components/avatar-upload.tsx`**:

- Click-to-upload or drag-and-drop zone
- Preview current avatar
- On file select → POST `/api/profile/avatar` (FormData)
- Show upload progress
- On success → update avatar preview + toast

**`src/components/region-select.tsx`**:

- Uses shadcn `Command` (Combobox pattern)
- Searchable/filterable list of regions
- Props: `regions: { id: number; name: string }[]`, `value`, `onChange`

**`src/components/role-list.tsx`**:

- List of badge items: `{org name} — {role name}` with an X button
- Info callout: "To add a new role, contact your region admins. Check [org.f3nation.com](https://org.f3nation.com) to find admins."
- On X click → DELETE `/api/profile/roles` → remove badge → toast

**`src/components/position-list.tsx`**:

- Same pattern as role-list
- Info callout: "To add a new position, contact your region admins. Check [org.f3nation.com](https://org.f3nation.com) to find admins."
- On X click → DELETE `/api/profile/positions` → remove badge → toast

**`src/components/navbar.tsx`**:

- F3 logo (left), app name "F3 Me" (left), user avatar + name (right), sign out button (right)
- Uses `useAuth()` hook for user state
- Responsive

**`src/components/auth-card.tsx`**:

- Sign-in card for landing page
- "Sign in with F3 Nation" button
- Error message display
- Environment badge

### Step 10: Firebase Configuration

**`firebase.json`**:

```json
{
  "apphosting": {
    "backendId": "f3-me"
  }
}
```

**`.firebaserc`**:

```json
{
  "projects": {
    "default": "<firebase-project-id>"
  }
}
```

**`apphosting.yaml`**:

```yaml
runConfig:
  maxInstances: 4
  minInstances: 0
  cpu: 1
  memoryMiB: 512
  concurrency: 80

env:
  - variable: NEXT_PUBLIC_SITE_URL
    secret: next-public-site-url
  - variable: ENVIRONMENT
    secret: environment
  - variable: OAUTH_CLIENT_ID
    secret: oauth-client-id
  - variable: OAUTH_CLIENT_SECRET
    secret: oauth-client-secret
  - variable: OAUTH_REDIRECT_URI
    secret: oauth-redirect-uri
  - variable: AUTH_PROVIDER_URL
    secret: auth-provider-url
  - variable: SESSION_SECRET
    secret: session-secret
  - variable: F3_API_KEY
    secret: f3-api-key
  - variable: F3_API_BASE_URL
    secret: f3-api-base-url
  - variable: GCS_BUCKET
    secret: gcs-bucket
  - variable: GCS_CREDENTIALS
    secret: gcs-credentials
```

**`next.config.ts`**:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "storage.googleapis.com",
        pathname: "/f3-logos/**",
      },
    ],
  },
};

export default nextConfig;
```

### Step 11: Scripts

**`scripts/firebase-env.sh`**: Copy from pax-vault, update `SECRET_VARS` and `SECRET_IDS` arrays to match this app's env vars:

```bash
SECRET_VARS=("NEXT_PUBLIC_SITE_URL" "ENVIRONMENT" "OAUTH_CLIENT_ID" "OAUTH_CLIENT_SECRET" "OAUTH_REDIRECT_URI" "AUTH_PROVIDER_URL" "SESSION_SECRET" "F3_API_KEY" "F3_API_BASE_URL" "GCS_BUCKET" "GCS_CREDENTIALS")
SECRET_IDS=("next-public-site-url" "environment" "oauth-client-id" "oauth-client-secret" "oauth-redirect-uri" "auth-provider-url" "session-secret" "f3-api-key" "f3-api-base-url" "gcs-bucket" "gcs-credentials")
```

**`package.json` scripts**:

```json
{
  "dev": "next dev --experimental-https --port 3003",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "typecheck": "tsc --noEmit"
}
```

### Step 12: Custom Domain & Deployment

1. **Firebase Console**: Create Firebase project (or reuse existing). Set up App Hosting backend connected to GitHub repo, branch `main`, root directory `apps/me`.
2. **Staging**: Create second App Hosting backend connected to `staging` branch.
3. **Custom Domain**: In Firebase Console → App Hosting → Custom Domains → add `me.f3nation.com`. Set DNS records as instructed.
4. **Secrets**: Run `./scripts/firebase-env.sh` after populating `.env.firebase` with prod values.

---

## 8. Types

**`src/lib/types.ts`**:

```typescript
// User profile as returned by the F3 API
export interface UserProfile {
  id: number;
  f3Name: string;
  firstName: string | null;
  lastName: string;
  email: string;
  phone: string | null;
  homeRegionId: number | null;
  avatarUrl: string | null;
  meta: string | null; // JSON string
  emergencyContact: string | null;
  emergencyPhone: string | null;
  emergencyNotes: string | null;
  status: "active" | "inactive";
  roles: UserRole[];
  created: string;
  updated: string;
}

export interface UserRole {
  orgId: number;
  roleName: "user" | "editor" | "admin";
  orgName?: string; // May need separate lookup
}

// Parsed meta fields that users can edit
export interface UserMeta {
  f3_name_origin?: string;
  my_f3_why?: string;
  user_emergency_info_dr_sharing?: boolean;
  start_date_override?: string; // yyyy-MM-dd
  [key: string]: unknown; // Preserve all other keys
}

export interface Region {
  id: number;
  name: string;
  orgType: string;
  isActive: boolean;
}

export interface PositionAssignment {
  positionId: number;
  positionName: string;
  userIds: number[];
}

export interface OrgPositionAssignments {
  orgId: number;
  assignments: PositionAssignment[];
}
```

---

## 9. Security Checklist

- [ ] API key (`F3_API_KEY`) is NEVER exposed to the client. All API calls happen server-side.
- [ ] Session `sub` is always validated against the requested user ID — users can only edit their own profile.
- [ ] File uploads are validated for type (jpeg/png/webp/gif) and size (max 5MB) before processing.
- [ ] `meta` field updates merge with existing data — never overwrite unknown keys.
- [ ] Position removal preserves all other users' assignments.
- [ ] Role removal only removes the specified role — preserves others.
- [ ] CSRF protection on auth flow via `oauth_csrf` cookie + state parameter.
- [ ] Session cookie is `httpOnly`, `secure` in production, `sameSite: "lax"`.
- [ ] All user input is validated/sanitized before sending to the API.

---

## 10. Local Development Quick Start

```bash
cd apps/me
cp .env.local.sample .env.local
# Fill in .env.local with actual values (get from team)
npm install
npm run dev
# Open https://localhost:3001
# Accept self-signed cert warning
# Click "Sign in with F3 Nation" to authenticate
```

**Prerequisites**:

- Node 20.x
- npm
- OAuth client `f3-me-local` registered in auth provider
- Admin API key with edit permissions
- GCS service account credentials

---

## 11. Staging / Prod Deployment

### First-time setup:

1. Create Firebase project in GCP Console
2. `firebase init apphosting` in `apps/me/`
3. Connect to GitHub repo, set branch (`main` for prod, `staging` for staging)
4. Set root directory to `apps/me` (if monorepo)
5. Run `./scripts/firebase-env.sh` to push secrets
6. Configure custom domain `me.f3nation.com`

### Subsequent deploys:

- Push to `main` → Firebase auto-builds and deploys to prod
- Push to `staging` → Firebase auto-builds and deploys to staging
- Secrets update: edit `.env.firebase`, re-run `firebase-env.sh`

## 12. Long term documentation

- Make sure there's a really robust and detailed ReadMe.md in apps/me. It should include how to set up and deploy the environment both locally and in firebase. It should also include why we're doing this.
- Also generate an AGENTS.md to keep in apps/me to be used for future enhancements.

## 13. Testing

- Include a full suite of comprehensive tests to be auto-run in GitHub Actions during a PR that affects this code.
