# @acme/sso

The official TypeScript client for F3 Nation's OAuth 2.0 / OpenID Connect auth server. Zero runtime dependencies — uses the Fetch API.

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Complete Integration Guide (Next.js)](#complete-integration-guide-nextjs)
  - [1. Register an OAuth Client](#1-register-an-oauth-client)
  - [2. Environment Variables](#2-environment-variables)
  - [3. Create the AuthClient Singleton](#3-create-the-authclient-singleton)
  - [4. Login Route (Redirect to Auth Server)](#4-login-route-redirect-to-auth-server)
  - [5. Callback Route (Exchange Code for Tokens)](#5-callback-route-exchange-code-for-tokens)
  - [6. Token Refresh Middleware](#6-token-refresh-middleware)
  - [7. Fetching User Info](#7-fetching-user-info)
  - [8. Logout](#8-logout)
- [PKCE Support](#pkce-support)
- [API Reference](#api-reference)
  - [`new AuthClient(config)`](#new-authclientconfig)
  - [`getOAuthConfig()`](#getoauthconfig)
  - [`getAuthorizationUrl(params?)`](#getauthorizationurlparams)
  - [`exchangeCodeForToken(params)`](#exchangecodefortokenparams)
  - [`refreshToken(params)`](#refreshtokenparams)
  - [`getUserInfo(accessToken)`](#getuserinfoaccesstoken)
  - [`revokeToken(token)`](#revoketokentoken)
- [Types](#types)
- [Error Handling](#error-handling)
- [Auth Server Endpoints](#auth-server-endpoints)
- [Token Lifecycle](#token-lifecycle)
- [Security Considerations](#security-considerations)
- [How SSO Works](#how-sso-works)

---

## Overview

The F3 Nation auth server implements the **OAuth 2.0 Authorization Code** flow with optional **PKCE** (Proof Key for Code Exchange) and **OpenID Connect** discovery. This package wraps the auth server's HTTP API into a type-safe TypeScript client.

**What this package does:**

- Builds the authorization URL to redirect users to the auth server
- Exchanges authorization codes for access + refresh tokens
- Refreshes expired access tokens using refresh tokens
- Fetches user profile data from the userinfo endpoint
- Revokes tokens on logout

**What this package does NOT do:**

- Store tokens — you manage token storage (cookies, database, etc.)
- Handle session management — you decide how to track logged-in users
- Provide React hooks or UI components — it's a pure HTTP client

---

## Installation

**Monorepo apps** (inside the f3-nation workspace):

```bash
pnpm add @acme/sso --filter your-app
```

Or add to your app's `package.json`:

```json
{
  "dependencies": {
    "@acme/sso": "workspace:*"
  }
}
```

Then run `pnpm install`.

**External apps** (outside the monorepo):

Copy `packages/sso/src/index.ts` into your project — it's a single file with zero dependencies. Then import `AuthClient` from wherever you placed it.

---

## Quick Start

```typescript
import { AuthClient } from "@acme/sso";

// 1. Create the client (server-side only — contains client_secret)
const auth = new AuthClient({
  clientId: "your-client-id",
  clientSecret: "your-client-secret",
  redirectUri: "http://localhost:3000/api/auth/callback",
  authServerUrl: "http://localhost:3100",
});

// 2. Get the URL to redirect users to for login
const loginUrl = auth.getAuthorizationUrl({ state: "random-state-value" });

// 3. After the user logs in, exchange the code from the callback
const tokens = await auth.exchangeCodeForToken({ code: "abc123" });
// tokens.accessToken  → JWT (1 hour TTL)
// tokens.refreshToken → opaque token (30 day TTL, rotated on each use)

// 4. Fetch the user's profile
const user = await auth.getUserInfo(tokens.accessToken);
// user.sub   → 42 (user ID)
// user.name  → "Tackle" (F3 name)
// user.email → "NotTackle@f3nation.com"

// 5. Refresh when the access token expires
const newTokens = await auth.refreshToken({
  refreshToken: tokens.refreshToken!,
});

// 6. Revoke the refresh token on logout
await auth.revokeToken(tokens.refreshToken!);
```

---

## Complete Integration Guide (Next.js)

This walks through integrating F3 SSO into a Next.js app from scratch using the App Router. Every code snippet is production-ready.

### 1. Register an OAuth Client

Before your app can use SSO, it needs a registered OAuth client on the auth server. An admin creates this in the `auth.oauth_clients` table:

```sql
INSERT INTO auth.oauth_clients (
  client_id,
  client_secret_hash,
  redirect_uris,
  allowed_origin,
  name
) VALUES (
  'my-app',
  -- hash the secret with SHA-256:
  encode(sha256('my-super-secret-client-secret'::bytea), 'hex'),
  ARRAY['http://localhost:3000/api/auth/callback'],
  'http://localhost:3000',
  'My F3 App'
);
```

You'll receive:

- **Client ID**: `my-app`
- **Client Secret**: `my-super-secret-client-secret` (keep this secret!)
- **Redirect URI**: `http://localhost:3000/api/auth/callback` (must match exactly)

### 2. Environment Variables

Add to your app's `.env`:

```bash
# Auth Server
AUTH_SERVER_URL=http://localhost:3100

# OAuth Client Credentials (from step 1)
OAUTH_CLIENT_ID=my-app
OAUTH_CLIENT_SECRET=my-super-secret-client-secret
OAUTH_REDIRECT_URI=http://localhost:3000/api/auth/callback
```

### 3. Create the AuthClient Singleton

Create `src/lib/auth.ts`:

```typescript
import { AuthClient } from "@acme/sso";

export const auth = new AuthClient({
  clientId: process.env.OAUTH_CLIENT_ID!,
  clientSecret: process.env.OAUTH_CLIENT_SECRET!,
  redirectUri: process.env.OAUTH_REDIRECT_URI!,
  authServerUrl: process.env.AUTH_SERVER_URL!,
});
```

> **Warning**: The `AuthClient` contains your `clientSecret`. Only use it in server-side code (API routes, server components, middleware). Never import it in client components.

### 4. Login Route (Redirect to Auth Server)

Create `src/app/api/auth/login/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";

import { auth } from "~/lib/auth";

export async function GET() {
  // Generate CSRF protection state
  const state = crypto.randomBytes(32).toString("hex");

  // Generate PKCE code verifier + challenge
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  // Store state + verifier in cookies (httpOnly, short-lived)
  const cookieStore = await cookies();
  cookieStore.set("oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });
  cookieStore.set("oauth_code_verifier", codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  // Build the authorization URL
  const url = auth.getAuthorizationUrl({
    state,
    codeChallenge,
    codeChallengeMethod: "S256",
  });

  return NextResponse.redirect(url);
}
```

In your UI, link to this route:

```tsx
<a href="/api/auth/login">Sign in with F3</a>
```

### 5. Callback Route (Exchange Code for Tokens)

Create `src/app/api/auth/callback/route.ts`:

```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";

import { auth } from "~/lib/auth";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // Handle auth server errors
  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error)}`, request.url),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=missing_code", request.url),
    );
  }

  // Verify state matches (CSRF protection)
  const cookieStore = await cookies();
  const savedState = cookieStore.get("oauth_state")?.value;
  if (!savedState || savedState !== state) {
    return NextResponse.redirect(
      new URL("/login?error=invalid_state", request.url),
    );
  }

  // Get the PKCE code verifier
  const codeVerifier = cookieStore.get("oauth_code_verifier")?.value;

  // Exchange the authorization code for tokens
  const tokens = await auth.exchangeCodeForToken({
    code,
    codeVerifier: codeVerifier ?? undefined,
  });

  // Clean up OAuth cookies
  cookieStore.delete("oauth_state");
  cookieStore.delete("oauth_code_verifier");

  // Store tokens in secure httpOnly cookies
  const response = NextResponse.redirect(new URL("/", request.url));

  response.cookies.set("access_token", tokens.accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: tokens.expiresIn ?? 3600, // 1 hour
    path: "/",
  });

  if (tokens.refreshToken) {
    response.cookies.set("refresh_token", tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: "/",
    });
  }

  return response;
}
```

### 6. Token Refresh Middleware

Create `src/middleware.ts` to automatically refresh expired tokens:

```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { auth } from "~/lib/auth";

export async function middleware(request: NextRequest) {
  const accessToken = request.cookies.get("access_token")?.value;
  const refreshToken = request.cookies.get("refresh_token")?.value;

  // No tokens at all — let the page handle it
  if (!accessToken && !refreshToken) {
    return NextResponse.next();
  }

  // Access token exists and isn't expired — continue
  if (accessToken) {
    return NextResponse.next();
  }

  // Access token missing/expired but we have a refresh token — refresh it
  if (refreshToken) {
    try {
      const tokens = await auth.refreshToken({ refreshToken });

      const response = NextResponse.next();
      response.cookies.set("access_token", tokens.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: tokens.expiresIn ?? 3600,
        path: "/",
      });

      if (tokens.refreshToken) {
        // Refresh token was rotated — store the new one
        response.cookies.set("refresh_token", tokens.refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 30 * 24 * 60 * 60,
          path: "/",
        });
      }

      return response;
    } catch {
      // Refresh failed (token revoked, expired, etc.) — clear everything
      const response = NextResponse.redirect(new URL("/login", request.url));
      response.cookies.delete("access_token");
      response.cookies.delete("refresh_token");
      return response;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
```

### 7. Fetching User Info

Use the access token to call the userinfo endpoint or pass it to the F3 API:

```typescript
// In a server component or API route:
import { cookies } from "next/headers";
import { auth } from "~/lib/auth";

async function getCurrentUser() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("access_token")?.value;
  if (!accessToken) return null;

  try {
    return await auth.getUserInfo(accessToken);
  } catch {
    return null;
  }
}

// Returns:
// {
//   sub: 42,             // user ID
//   name: "Dredd",       // F3 name
//   email: "dredd@f3nation.com",
//   emailVerified: true,
//   picture: "https://..."
// }
```

To call the F3 API with the access token:

```typescript
const res = await fetch("https://api.f3nation.com/v1/user", {
  headers: { Authorization: `Bearer ${accessToken}` },
});
```

The F3 API validates the JWT by checking its RS256 signature against the auth server's JWKS endpoint.

### 8. Logout

Create `src/app/api/auth/logout/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { auth } from "~/lib/auth";

export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("refresh_token")?.value;

  // Revoke the refresh token on the auth server
  if (refreshToken) {
    try {
      await auth.revokeToken(refreshToken);
    } catch {
      // Best-effort — continue with local logout even if revocation fails
    }
  }

  // Clear local session cookies
  const response = NextResponse.json({ loggedOut: true });
  response.cookies.delete("access_token");
  response.cookies.delete("refresh_token");
  return response;
}
```

In your UI:

```tsx
function LogoutButton() {
  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return <button onClick={handleLogout}>Sign Out</button>;
}
```

---

## PKCE Support

PKCE (Proof Key for Code Exchange) prevents authorization code interception attacks. It's recommended for all clients and required for public clients (mobile apps, SPAs).

The auth server supports two methods:

- **`S256`** (recommended): SHA-256 hash of the code verifier
- **`plain`**: Code verifier sent as-is (not recommended)

```typescript
import crypto from "node:crypto";
import { AuthClient } from "@acme/sso";

const auth = new AuthClient({/* ... */});

// 1. Generate a random code verifier (43-128 chars, URL-safe)
const codeVerifier = crypto.randomBytes(32).toString("base64url");

// 2. Hash it to create the code challenge
const codeChallenge = crypto
  .createHash("sha256")
  .update(codeVerifier)
  .digest("base64url");

// 3. Include the challenge in the authorization URL
const url = auth.getAuthorizationUrl({
  codeChallenge,
  codeChallengeMethod: "S256",
});

// 4. Include the verifier when exchanging the code
const tokens = await auth.exchangeCodeForToken({
  code: "...",
  codeVerifier,
});
```

Store the `codeVerifier` server-side (in a cookie or session) between steps 3 and 4. The auth server verifies that `SHA256(code_verifier) === code_challenge` before issuing tokens.

---

## API Reference

### `new AuthClient(config)`

Creates a new auth client instance.

| Parameter              | Type     | Required | Description                                                |
| ---------------------- | -------- | -------- | ---------------------------------------------------------- |
| `config.clientId`      | `string` | Yes      | OAuth client ID from registration                          |
| `config.clientSecret`  | `string` | Yes      | OAuth client secret (keep server-side)                     |
| `config.redirectUri`   | `string` | Yes      | Must match a registered redirect URI exactly               |
| `config.authServerUrl` | `string` | Yes      | Base URL of the auth server (e.g. `http://localhost:3100`) |

```typescript
const auth = new AuthClient({
  clientId: "my-app",
  clientSecret: "secret",
  redirectUri: "http://localhost:3000/api/auth/callback",
  authServerUrl: "http://localhost:3100",
});
```

---

### `getOAuthConfig()`

Returns the public OAuth config (no secrets). Safe to pass to client-side code.

**Returns:** `OAuthClient`

```typescript
const config = auth.getOAuthConfig();
// { clientId: "my-app", redirectUri: "http://...", authServerUrl: "http://..." }
```

---

### `getAuthorizationUrl(params?)`

Builds the URL to redirect users to for login.

| Parameter                    | Type     | Required | Description                                               |
| ---------------------------- | -------- | -------- | --------------------------------------------------------- |
| `params.scope`               | `string` | No       | Space-separated scopes. Default: `"openid profile email"` |
| `params.state`               | `string` | No       | CSRF protection token. Echoed back in the callback.       |
| `params.codeChallenge`       | `string` | No       | PKCE code challenge                                       |
| `params.codeChallengeMethod` | `string` | No       | `"S256"` or `"plain"`. Default: `"S256"`                  |

**Returns:** `string` — the full authorization URL

```typescript
const url = auth.getAuthorizationUrl({
  state: crypto.randomBytes(32).toString("hex"),
  codeChallenge: "...",
  codeChallengeMethod: "S256",
});
// "http://localhost:3100/api/oauth/authorize?response_type=code&client_id=..."
```

**Available scopes:**

| Scope     | Claims Returned           |
| --------- | ------------------------- |
| `openid`  | `sub` (user ID)           |
| `profile` | `name`, `picture`         |
| `email`   | `email`, `email_verified` |

---

### `exchangeCodeForToken(params)`

Exchanges an authorization code for access and refresh tokens. **Server-side only** — sends `client_secret`.

| Parameter             | Type     | Required | Description                                |
| --------------------- | -------- | -------- | ------------------------------------------ |
| `params.code`         | `string` | Yes      | Authorization code from the callback URL   |
| `params.codeVerifier` | `string` | No       | PKCE code verifier (if challenge was sent) |

**Returns:** `Promise<AuthTokens>`

```typescript
const tokens = await auth.exchangeCodeForToken({
  code: "abc123",
  codeVerifier: "stored-verifier",
});

// tokens.accessToken   → JWT string (1 hour TTL)
// tokens.refreshToken  → opaque string (30 day TTL)
// tokens.expiresIn     → 3600 (seconds)
// tokens.tokenType     → "Bearer"
// tokens.scope         → "openid profile email"
```

**Throws:** `AuthError` with codes:

- `invalid_grant` — code is expired, already used, or redirect_uri doesn't match
- `invalid_client` — bad client credentials
- `invalid_request` — missing required parameters

---

### `refreshToken(params)`

Uses a refresh token to get a new access token. **Server-side only**.

| Parameter             | Type     | Required | Description                                      |
| --------------------- | -------- | -------- | ------------------------------------------------ |
| `params.refreshToken` | `string` | Yes      | The refresh token from a previous token response |

**Returns:** `Promise<AuthTokens>`

```typescript
const newTokens = await auth.refreshToken({
  refreshToken: "old-refresh-token",
});

// newTokens.accessToken  → new JWT (1 hour TTL)
// newTokens.refreshToken → NEW refresh token (old one is now invalid)
```

> **Important:** The auth server rotates refresh tokens. Each call returns a new refresh token and invalidates the old one. Always store the new refresh token.

**Throws:** `AuthError` with codes:

- `invalid_grant` — refresh token is expired, revoked, or already used
- `invalid_client` — bad client credentials

---

### `getUserInfo(accessToken)`

Fetches the user's profile from the auth server. **Server-side only** (or client-side if you're comfortable exposing the access token).

| Parameter     | Type     | Required | Description              |
| ------------- | -------- | -------- | ------------------------ |
| `accessToken` | `string` | Yes      | A valid JWT access token |

**Returns:** `Promise<AuthUser>`

```typescript
const user = await auth.getUserInfo(tokens.accessToken);

// user.sub           → 42 (numeric user ID)
// user.name          → "Dredd" (F3 name, from `profile` scope)
// user.email         → "dredd@f3nation.com" (from `email` scope)
// user.emailVerified → true (from `email` scope)
// user.picture       → "https://..." (avatar URL, from `profile` scope)
```

**Throws:** `AuthError` with code `invalid_token` if the access token is expired or invalid.

---

### `revokeToken(token)`

Revokes a refresh token, preventing it from being used to get new access tokens. Always returns successfully per [RFC 7009](https://tools.ietf.org/html/rfc7009) — even if the token doesn't exist or was already revoked.

| Parameter | Type     | Required | Description                 |
| --------- | -------- | -------- | --------------------------- |
| `token`   | `string` | Yes      | The refresh token to revoke |

**Returns:** `Promise<void>`

```typescript
await auth.revokeToken(refreshToken);
```

> **Note:** Access tokens (JWTs) cannot be revoked — they expire naturally after 1 hour. Revoking the refresh token prevents new access tokens from being issued.

---

## Types

### `AuthClientConfig`

```typescript
interface AuthClientConfig {
  clientId: string; // OAuth client ID
  clientSecret: string; // OAuth client secret (never expose client-side)
  redirectUri: string; // Must match registered redirect URI exactly
  authServerUrl: string; // e.g. "http://localhost:3100"
}
```

### `AuthTokens`

```typescript
interface AuthTokens {
  accessToken: string; // JWT, signed with RS256
  refreshToken?: string; // Opaque token, rotated on each use
  expiresIn?: number; // Seconds until access token expires (3600)
  tokenType?: string; // Always "Bearer"
  scope?: string; // Granted scopes
}
```

### `AuthUser`

```typescript
interface AuthUser {
  sub: number; // User ID (always present)
  name?: string; // F3 name (requires `profile` scope)
  email?: string; // Email address (requires `email` scope)
  emailVerified?: boolean; // Email verification status (requires `email` scope)
  picture?: string; // Avatar URL (requires `profile` scope)
}
```

### `OAuthClient`

```typescript
interface OAuthClient {
  clientId: string; // Safe to send to the browser
  redirectUri: string;
  authServerUrl: string;
}
```

### `AuthError`

```typescript
class AuthError extends Error {
  code: string; // OAuth error code (e.g. "invalid_grant")
  statusCode?: number; // HTTP status code (e.g. 400, 401)
}
```

---

## Error Handling

All async methods throw `AuthError` on failure. Catch it to handle specific error codes:

```typescript
import { AuthClient, AuthError } from "@acme/sso";

try {
  const tokens = await auth.exchangeCodeForToken({ code });
} catch (err) {
  if (err instanceof AuthError) {
    switch (err.code) {
      case "invalid_grant":
        // Code expired or already used — redirect to login
        break;
      case "invalid_client":
        // Client credentials are wrong — check env vars
        break;
      case "rate_limit_exceeded":
        // Too many requests — back off
        break;
      default:
        console.error(`OAuth error: ${err.code} — ${err.message}`);
    }
  }
  throw err;
}
```

**Error codes returned by the auth server:**

| Code                     | HTTP Status | Meaning                                                    |
| ------------------------ | ----------- | ---------------------------------------------------------- |
| `invalid_request`        | 400         | Missing or invalid parameters                              |
| `invalid_client`         | 400         | Bad client ID or secret                                    |
| `invalid_grant`          | 400         | Code expired, already used, or refresh token revoked       |
| `unsupported_grant_type` | 400         | Only `authorization_code` and `refresh_token` supported    |
| `invalid_scope`          | 400         | Requested scope not allowed for this client                |
| `invalid_token`          | 401         | Access token expired or malformed (userinfo endpoint)      |
| `rate_limit_exceeded`    | 429         | Too many requests (60/min for token, 30/min for authorize) |

---

## Auth Server Endpoints

These are the raw HTTP endpoints the SDK calls. You normally don't need to call them directly.

| Endpoint                            | Method | Purpose                                               |
| ----------------------------------- | ------ | ----------------------------------------------------- |
| `/api/oauth/authorize`              | GET    | Authorization — redirects user to login, returns code |
| `/api/oauth/token`                  | POST   | Token exchange — code → tokens, or refresh → tokens   |
| `/api/oauth/userinfo`               | GET    | User profile — requires Bearer access token           |
| `/api/oauth/revoke`                 | POST   | Token revocation — invalidates a refresh token        |
| `/.well-known/openid-configuration` | GET    | OpenID Connect discovery document                     |
| `/.well-known/jwks.json`            | GET    | JSON Web Key Set for verifying JWT signatures         |

**Discovery:** You can fetch `/.well-known/openid-configuration` to dynamically discover all endpoint URLs. This is useful for generic OIDC client libraries.

**JWKS:** The F3 API (`apps/api`) uses the JWKS endpoint to verify access token signatures without sharing secrets with the auth server.

---

## Token Lifecycle

| Token                  | Format        | TTL        | Storage                   | Revocable?               |
| ---------------------- | ------------- | ---------- | ------------------------- | ------------------------ |
| **Authorization Code** | Opaque string | 10 minutes | Auth server DB            | Single-use, auto-deleted |
| **Access Token**       | RS256 JWT     | 1 hour     | Your app (cookie/memory)  | No — expires naturally   |
| **Refresh Token**      | Opaque string | 30 days    | Auth server DB + your app | Yes, via `revokeToken()` |

**Refresh token rotation:** Every time you call `refreshToken()`, the auth server issues a new refresh token and deletes the old one. This limits the damage if a refresh token is leaked — the attacker and the legitimate user can't both use it. Whichever one refreshes second will get `invalid_grant`, signaling a potential compromise.

---

## Security Considerations

### Client Secret Protection

The `clientSecret` must **never** leave the server. Don't import `AuthClient` in client components, don't send the config to the browser, don't log it.

### State Parameter

Always use the `state` parameter in `getAuthorizationUrl()` to prevent CSRF attacks. Generate a random value, store it in an httpOnly cookie, and verify it matches when the callback fires.

### PKCE

Use PKCE (`S256`) for all clients. It's required for public clients (mobile apps, SPAs) and strongly recommended for confidential (server-side) clients too. It prevents authorization code interception even if an attacker can observe the redirect.

### Token Storage

Store tokens in **httpOnly, secure, sameSite cookies**. Never store tokens in `localStorage` or `sessionStorage` — they're accessible to JavaScript and vulnerable to XSS.

### Refresh Token Rotation

The auth server rotates refresh tokens on every use. If you detect an `invalid_grant` error during refresh, it may mean the refresh token was already used by an attacker. Clear all tokens and force re-authentication.

### Access Token Validation

Access tokens are RS256 JWTs. The F3 API validates them by fetching the public key from the JWKS endpoint (`/.well-known/jwks.json`). If you need to validate tokens in your own API, fetch the JWKS and verify the JWT signature — don't just decode it.

For Next.js client apps that consume F3 SSO directly, use the shared helpers in
`@acme/sso` instead of duplicating JWKS verification logic:

```ts
import { verifyJwtPayload } from "@acme/sso";

const payload = await verifyJwtPayload(accessToken, {
  authServerUrl: process.env.AUTH_PROVIDER_URL!,
  clientId: process.env.OAUTH_CLIENT_ID!,
});

if (!payload) {
  // Token is invalid, expired, or does not match expected issuer/audience.
}
```

If you need structured failure reasons (for metrics/debugging), use
`verifyJwtWithJwks(...)` which returns `{ ok: false, code, message }` on
verification failures.

---

## How SSO Works

The auth server provides true Single Sign-On across all F3 apps. Here's how:

1. **User visits App A** → clicks "Sign in" → redirected to auth server
2. **Auth server** → user enters email, receives MFA code, logs in
3. **Auth server sets its own session cookie** → redirects back to App A with an authorization code
4. **App A** exchanges the code for tokens → user is logged in to App A

Later:

5. **User visits App B** → clicks "Sign in" → redirected to auth server
6. **Auth server** → session cookie already exists → **skips login entirely**
7. **Auth server** → redirects back to App B with an authorization code immediately
8. **App B** exchanges the code for tokens → user is logged in to App B without entering credentials

The SSO session lives on the auth server. Each app has its own tokens and session management, but the login step is shared. One login, all apps.
