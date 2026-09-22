<!-- BEGIN:nextjs-agent-rules -->

# Next.js: ALWAYS read docs before coding

Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

<!-- END:nextjs-agent-rules -->

# F3 Me — Agent Guide

> This document provides context for AI coding agents working on the F3 Me app.

## Architecture Overview

F3 Me is a Next.js 15 App Router application that provides self-service profile editing for F3 Nation users. It uses F3 SSO for authentication and proxies all data operations through the F3 Nation API.

### Key Architectural Decisions

1. **User-scoped OAuth tokens**: The app stores `access_token` and `refresh_token` in `httpOnly` cookies and calls the F3 API as the authenticated user.
2. **No direct database access**: All data operations go through the F3 Nation API (`api.f3nation.com`). There is no database in this app.
3. **Meta field merging**: The `meta` field in the user profile is a JSON string. When updating, parse existing meta, merge editable keys, preserve all unknown keys, and re-serialize.
4. **Position removal safety**: When removing a user from a position, fetch the full org position list, remove only the user's ID, and PUT back the complete list to preserve other users.

## File Structure

```text
src/
├── app/
│   ├── layout.tsx          — Root layout (AuthProvider, Navbar, Toaster)
│   ├── page.tsx            — Landing page (redirects if authed)
│   ├── globals.css         — Tailwind CSS + CSS variables
│   ├── profile/page.tsx    — Profile editor (server component)
│   └── api/
│       ├── auth/           — OAuth login/callback/me/logout routes
│       └── profile/        — Profile CRUD (GET/PATCH, avatar, roles, positions)
├── components/
│   ├── ui/                 — shadcn/ui primitives (button, card, input, etc.)
│   ├── profile-form.tsx    — Main profile editing form (client component)
│   ├── avatar-upload.tsx   — Drag-and-drop avatar upload
│   ├── region-select.tsx   — Searchable region dropdown
│   ├── role-list.tsx       — Role badges with remove buttons
│   ├── position-list.tsx   — Position badges with remove buttons
│   ├── navbar.tsx          — Top navigation bar
│   └── auth-card.tsx       — Sign-in card for landing page
└── lib/
    ├── auth/
    │   ├── constants.ts    — Cookie names, TTLs
    │   ├── oauth.ts        — AuthClient wrapper (@f3nation/sso)
    │   ├── tokens.ts       — Access token parsing/expiry helpers
    │   ├── server.ts       — getSessionUser(), requireAuth(), requireAccessToken()
    │   └── AuthProvider.tsx — Client-side auth context
    ├── api/client.ts       — Server-side F3 API client
    ├── gcs.ts              — Google Cloud Storage upload helper
    ├── types.ts            — TypeScript interfaces
    └── utils.ts            — cn() helper, fallback avatar
```

## API Reference

- **Base URL**: `F3_API_BASE_URL` env var (must include `/v1`, e.g. `https://staging.api.f3nation.com/v1`)
- **Client**: typed oRPC client (`@orpc/client`) backed by `@acme/api` router — see `src/lib/api/client.ts`
- **Headers**: `Authorization: Bearer {access_token}`, `Client: f3-me` (set automatically by the client factory)

### Key Procedures

- `client.me.profile()` — Load authenticated user's profile (user fields + roles + positions)
- `client.me.regions()` — List active regions for the region picker
- `client.me.updateProfile(payload)` — Update user profile fields
- `client.me.removeRole({ roleId })` — Remove a role from the user
- `client.me.removePosition({ orgId, positionId })` — Remove a position from the user

## Authentication Flow

OAuth 2.0 Authorization Code + PKCE via `https://auth.f3nation.com`:

1. `/api/auth/login` → Set CSRF + code_verifier cookies → Redirect to auth provider
2. Auth provider authenticates user (email → 6-digit code)
3. Redirect to `/api/auth/callback` → Validate CSRF → Exchange code for tokens → Fetch userinfo (to confirm email) → Store `access_token` + `refresh_token` cookies
4. Middleware performs full RS256 + JWKS verification and refreshes the access token when needed using the refresh token.
5. Server components decode claims locally from the already-verified JWT — no additional userinfo network call per render (`parseAccessTokenPayload` in `tokens.ts`, `getSessionUser()` / `requireAuth()` in `server.ts`).

## Editable Fields

Profile form allows editing these fields only (whitelist):

- `f3Name`, `firstName`, `lastName`, `phone`, `homeRegionId`
- `avatarUrl` (via file upload)
- `emergencyContact`, `emergencyPhone`, `emergencyNotes`
- Meta sub-fields: `f3_name_origin`, `my_f3_why`, `user_emergency_info_dr_sharing`, `start_date_override`, `brought_by`

## Testing

Tests use Vitest and are in `__tests__/`. Run with `pnpm test`.

## Common Enhancement Tasks

### Adding a new editable field

1. Add to `ProfileUpdatePayload` in `src/lib/types.ts`
2. Add field name to `EDITABLE_FIELDS` set (or `META_FIELDS` if it's a meta field) in `src/app/api/profile/route.ts`
3. Add form state and input to `src/components/profile-form.tsx`
4. Add test case in `__tests__/api/profile.test.ts`

### Adding a new API endpoint

1. Add function to `src/lib/api/client.ts`
2. Create route handler in `src/app/api/`
3. Add tests in `__tests__/api/`

### Updating shadcn/ui components

Run `npx shadcn@latest add <component>` from `apps/me/`.
