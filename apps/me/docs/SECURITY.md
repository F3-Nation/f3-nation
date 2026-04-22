# Security & Authentication Architecture

This document describes the current security model for apps/me. It reflects the token-cookie auth flow now used by the app and replaces the earlier `__session` plus BFF API-key design.

## Architecture Overview

```
┌──────────┐     ┌──────────────────┐     ┌─────────────────┐     ┌────────────┐
│ Browser  │────▶│ apps/me          │────▶│ packages/api    │────▶│ Database   │
│          │◀────│ Next.js App      │◀────│ oRPC Server     │◀────│ PostgreSQL │
└──────────┘     └──────────────────┘     └─────────────────┘     └────────────┘
  httpOnly          Server-side routes       Bearer access token     Drizzle ORM
  token cookies     read/refresh cookies     validates user auth
```

The browser still talks only to apps/me. apps/me now calls the API as the authenticated user by forwarding the user's OAuth access token. The app no longer creates its own signed session cookie and no longer relies on a service API key plus `X-User-Id` override.

## Authentication Flow

### OAuth Login

Relevant files:

- `apps/me/src/app/api/auth/login/route.ts`
- `apps/me/src/app/api/auth/callback/route.ts`
- `apps/me/src/lib/auth/oauth.ts`

Flow:

1. `GET /api/auth/login` creates a CSRF token and PKCE verifier.
2. The route stores `oauth_csrf` and `oauth_code_verifier` as short-lived `httpOnly` cookies.
3. The browser is redirected to the auth provider using `@acme/sso`.
4. The provider redirects back to `GET /api/auth/callback` with `code` and `state`.
5. The callback validates the state timestamp, CSRF token, and PKCE verifier.
6. The callback exchanges the code for OAuth tokens.
7. The callback validates the returned access token using the provider `userinfo` endpoint.
8. The callback stores `access_token` and `refresh_token` in `httpOnly` cookies.
9. The temporary OAuth cookies are cleared.

Security controls:

- PKCE with `S256`
- CSRF protection tied to the login flow
- State timestamp replay protection
- Relative-path validation for `returnTo`
- `httpOnly`, `secure` in production, `sameSite=lax` cookies

### Auth Cookies

Relevant files:

- `apps/me/src/lib/auth/constants.ts`
- `apps/me/src/lib/auth/server.ts`
- `apps/me/src/lib/auth/tokens.ts`
- `apps/me/middleware.ts`

Cookie set:

- `access_token`: short-lived bearer token used for API calls
- `refresh_token`: longer-lived token used only for server-side refresh
- `oauth_csrf`, `oauth_code_verifier`: short-lived login-flow cookies

The access and refresh tokens are never exposed to client-side JavaScript. They are only read in route handlers, server components, and middleware.

### Middleware Refresh

Relevant file:

- `apps/me/middleware.ts`

Middleware protects non-public routes and handles token refresh:

1. Allow public routes and static assets.
2. Read `access_token` and `refresh_token` cookies.
3. If the access token is still usable, continue.
4. If the access token is missing or expired but a refresh token exists, request a fresh token set from the auth provider.
5. Rotate cookies on success.
6. Clear auth cookies and redirect to `/` on failure.

Middleware uses lightweight JWT payload inspection only to determine whether refresh is needed. Final identity validation still happens server-side through the provider `userinfo` endpoint.

### Server-Side User Resolution

Relevant file:

- `apps/me/src/lib/auth/server.ts`

`getSessionUser()` and `requireAuth()` now work by:

1. Reading the `access_token` cookie.
2. Calling the auth provider `userinfo` endpoint.
3. Mapping that response into the app's `SessionPayload` shape.

If the token is missing or invalid, `requireAuth()` redirects to `/`.

### API Calls

Relevant file:

- `apps/me/src/lib/api/client.ts`

apps/me calls the API with:

```
Authorization: Bearer {access_token}
Client: f3-me
Content-Type: application/json
```

There is no app-specific bearer secret and no `X-User-Id` override in this flow. Authorization happens as the end user represented by the access token.

## Environment Variables

### apps/me

| Variable               | Purpose                         | Sensitivity |
| ---------------------- | ------------------------------- | ----------- |
| `OAUTH_CLIENT_ID`      | OAuth client identifier         | Low         |
| `OAUTH_CLIENT_SECRET`  | OAuth client secret             | High        |
| `OAUTH_REDIRECT_URI`   | OAuth callback URL              | Low         |
| `AUTH_PROVIDER_URL`    | Auth provider base URL          | Low         |
| `F3_API_BASE_URL`      | API base URL                    | Low         |
| `NEXT_PUBLIC_SITE_URL` | Public app origin               | Low         |
| `GCS_BUCKET`           | Avatar upload bucket            | Medium      |
| `GCS_CREDENTIALS`      | GCS service account credentials | Critical    |

Legacy variables removed from apps/me:

- `SESSION_SECRET`
- `F3_API_KEY`

### packages/api

The API still has its own auth and secret requirements, but apps/me no longer depends on a dedicated BFF service key for `/me` traffic.

## Cookie Security

### Access and Refresh Cookies

| Cookie          | Purpose                   | Properties                                                   |
| --------------- | ------------------------- | ------------------------------------------------------------ |
| `access_token`  | Authenticated API access  | `httpOnly`, `secure` in production, `sameSite=lax`, `path=/` |
| `refresh_token` | Server-side token refresh | `httpOnly`, `secure` in production, `sameSite=lax`, `path=/` |

### OAuth Flow Cookies

| Cookie                | Purpose                      | Properties                                                      |
| --------------------- | ---------------------------- | --------------------------------------------------------------- |
| `oauth_csrf`          | CSRF protection for callback | `httpOnly`, `secure` in production, `sameSite=lax`, short-lived |
| `oauth_code_verifier` | PKCE verifier                | `httpOnly`, `secure` in production, `sameSite=lax`, short-lived |

The OAuth flow cookies are cleared immediately after callback handling. Auth cookies are cleared on logout and when refresh fails.

## Middleware & Route Protection

Public routes:

- `/`
- `/api/auth/login`
- `/api/auth/callback`
- `/api/auth/logout`
- `/api/auth/me`
- static assets and framework internals

Protected routes require a valid token path. Missing or stale tokens lead to either a middleware refresh or a redirect back to the login page.

## Known Risks & Watch Points

### Refresh token leakage

Risk: a stolen refresh token can be used to mint new access tokens until it expires or is revoked.

Mitigation:

- store refresh tokens only in `httpOnly` cookies
- revoke refresh tokens on logout
- clear auth cookies immediately when refresh fails

### Access token theft

Risk: a stolen access token can be used until it expires.

Mitigation:

- keep access-token TTL short
- store it only in `httpOnly` cookies
- refresh it server-side instead of exposing it to client code

### OAuth client secret leakage

Risk: an attacker with the client secret can abuse token exchange.

Mitigation:

- keep `OAUTH_CLIENT_SECRET` in secure secret management
- rotate it if compromise is suspected

### In-memory API rate limiting

Risk: per-instance rate limiting is weaker in multi-instance deployments.

Mitigation: move to a distributed limiter if production traffic requires it.

### Provider and app identity drift

Risk: if provider identity and F3 user data drift apart, auth may succeed while downstream user-specific behavior fails or becomes stale.

Mitigation: keep provider identity data and F3 records aligned.

## Checklist for Common Changes

### Adding a New Protected Route

1. Use `requireAuth()` or `requireAccessToken()` in server-side handlers.
2. If the route calls the API, use `apps/me/src/lib/api/client.ts` so the access token is forwarded consistently.
3. Add tests for missing auth, expired auth, and successful auth.

### Rotating OAuth Client Credentials

1. Update `OAUTH_CLIENT_SECRET` in the deployment environment.
2. Confirm the provider configuration still matches `OAUTH_CLIENT_ID` and `OAUTH_REDIRECT_URI`.
3. Redeploy apps/me.

### Changing Cookie Behavior

1. Update `apps/me/src/lib/auth/constants.ts`.
2. Confirm callback, middleware, and logout all still agree on cookie names and TTLs.
3. Re-run app tests and typecheck.
