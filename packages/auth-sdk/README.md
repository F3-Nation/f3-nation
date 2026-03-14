# @f3-nation/auth-sdk

TypeScript SDK for authenticating against the F3 Nation OAuth 2.0 / OpenID Connect server (`apps/auth`). Provides a type-safe client for the full authorization code grant flow with PKCE support.

- **Zero runtime dependencies** — uses only the Fetch API
- **Server-side only** — keeps client secrets safe (never send to the browser)
- **Full OAuth 2.0 flow** — authorize, exchange, refresh, userinfo, revoke

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Complete Integration Guide](#complete-integration-guide)
- [API Reference](#api-reference)
- [Types](#types)
- [Error Handling](#error-handling)
- [PKCE Support](#pkce-support)
- [Token Lifecycle](#token-lifecycle)

---

## Installation

Within the monorepo, add the workspace dependency:

```bash
pnpm add @f3-nation/auth-sdk --filter your-app
```

Or reference it in your app's `package.json`:

```json
{
  "dependencies": {
    "@f3-nation/auth-sdk": "workspace:*"
  }
}
```

---

## Quick Start

```typescript
import { AuthClient } from "@f3-nation/auth-sdk";

const auth = new AuthClient({
  clientId: "my-app",
  clientSecret: process.env.AUTH_CLIENT_SECRET!,
  redirectUri: "https://myapp.com/auth/callback",
  authServerUrl: "https://auth.f3nation.com",
});

// 1. Generate the authorization URL and redirect the user
const url = auth.getAuthorizationUrl({ state: "random-csrf-token" });
// → redirect user to this URL

// 2. Handle the callback — exchange the code for tokens
const tokens = await auth.exchangeCodeForToken({
  code: "AUTH_CODE_FROM_CALLBACK",
});

// 3. Fetch the authenticated user's profile
const user = await auth.getUserInfo(tokens.accessToken);
console.log(user);
// { sub: 12345, name: "Dredd", email: "dredd@f3nation.com", picture: "..." }

// 4. Refresh tokens when they expire
const newTokens = await auth.refreshToken({
  refreshToken: tokens.refreshToken!,
});

// 5. Revoke tokens on sign-out
await auth.revokeToken(tokens.accessToken);
```

---

## Complete Integration Guide

This guide shows how to integrate F3 Auth into a Next.js app (e.g. `apps/me`). The pattern works for any server-rendered framework.

### 1. Register Your OAuth Client

Before your app can authenticate, you need a registered client. Use the CLI from `apps/auth`:

```bash
pnpm -C apps/auth add-client
```

You'll receive a `clientId` and `clientSecret`. Store the secret securely (never expose it to the browser).

### 2. Set Up Environment Variables

```env
AUTH_SERVER_URL=https://auth.f3nation.com
AUTH_CLIENT_ID=my-app
AUTH_CLIENT_SECRET=your-secret-here
AUTH_REDIRECT_URI=https://myapp.com/auth/callback
```

### 3. Create the Auth Client

```typescript
// lib/auth.ts (server-side only)
import { AuthClient } from "@f3-nation/auth-sdk";

export const authClient = new AuthClient({
  clientId: process.env.AUTH_CLIENT_ID!,
  clientSecret: process.env.AUTH_CLIENT_SECRET!,
  redirectUri: process.env.AUTH_REDIRECT_URI!,
  authServerUrl: process.env.AUTH_SERVER_URL!,
});
```

### 4. Redirect to Login

Create a login route that redirects to the auth server:

```typescript
// app/auth/login/route.ts
import { redirect } from "next/navigation";
import { authClient } from "~/lib/auth";

export async function GET() {
  const state = crypto.randomUUID();
  // Store state in a cookie for CSRF validation on callback

  const url = authClient.getAuthorizationUrl({
    state,
    scope: "openid profile email",
  });

  redirect(url);
}
```

### 5. Handle the Callback

Exchange the authorization code for tokens:

```typescript
// app/auth/callback/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authClient } from "~/lib/auth";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  // Validate state against stored cookie (CSRF protection)

  const tokens = await authClient.exchangeCodeForToken({ code });
  const user = await authClient.getUserInfo(tokens.accessToken);

  // Store tokens in an HTTP-only session cookie or your session store
  // Redirect the user to the app

  return NextResponse.redirect(new URL("/", request.url));
}
```

### 6. Refresh Tokens

Access tokens expire after 1 hour. Use the refresh token to get a new one:

```typescript
import { authClient, AuthError } from "~/lib/auth";

async function refreshSession(refreshToken: string) {
  try {
    const tokens = await authClient.refreshToken({ refreshToken });
    // Update stored tokens
    return tokens;
  } catch (error) {
    if (error instanceof AuthError && error.code === "invalid_grant") {
      // Refresh token expired or revoked — redirect to login
    }
    throw error;
  }
}
```

### 7. Sign Out

```typescript
import { authClient } from "~/lib/auth";

async function signOut(accessToken: string, refreshToken?: string) {
  await authClient.revokeToken(accessToken);
  if (refreshToken) {
    await authClient.revokeToken(refreshToken);
  }
  // Clear session cookie
}
```

### 8. Get Public Config (Client-Side Safe)

If you need OAuth config on the client (e.g. for displaying the auth server URL), use `getOAuthConfig()` which strips the secret:

```typescript
const publicConfig = authClient.getOAuthConfig();
// { clientId: "my-app", redirectUri: "...", authServerUrl: "..." }
// Safe to serialize and send to the browser
```

---

## API Reference

### `AuthClient`

#### `constructor(config: AuthClientConfig)`

Creates a new OAuth 2.0 client instance.

| Parameter              | Type     | Description                                                    |
| ---------------------- | -------- | -------------------------------------------------------------- |
| `config.clientId`      | `string` | Registered OAuth client ID                                     |
| `config.clientSecret`  | `string` | OAuth client secret (keep server-side)                         |
| `config.redirectUri`   | `string` | Callback URL registered with the auth server                   |
| `config.authServerUrl` | `string` | Base URL of the auth server (e.g. `https://auth.f3nation.com`) |

---

#### `getOAuthConfig(): OauthClient`

Returns the public OAuth configuration (safe for client-side use, excludes `clientSecret`).

**Returns**: `{ clientId, redirectUri, authServerUrl }`

---

#### `getAuthorizationUrl(params?): string`

Builds the authorization URL to redirect users to.

| Parameter                    | Type     | Default                  | Description                     |
| ---------------------------- | -------- | ------------------------ | ------------------------------- |
| `params.scope`               | `string` | `"openid profile email"` | Space-separated OAuth scopes    |
| `params.state`               | `string` | —                        | CSRF protection state parameter |
| `params.codeChallenge`       | `string` | —                        | PKCE code challenge             |
| `params.codeChallengeMethod` | `string` | `"S256"`                 | PKCE method (`S256` or `plain`) |

**Returns**: Full authorization URL string

**Example**:

```typescript
const url = auth.getAuthorizationUrl({ state: "abc123" });
// "https://auth.f3nation.com/api/oauth/authorize?response_type=code&client_id=my-app&..."
```

---

#### `exchangeCodeForToken(params): Promise<AuthTokens>`

Exchanges an authorization code for access and refresh tokens. **Server-side only.**

| Parameter             | Type      | Description                                                |
| --------------------- | --------- | ---------------------------------------------------------- |
| `params.code`         | `string`  | Authorization code from the callback redirect              |
| `params.codeVerifier` | `string?` | PKCE code verifier (required if `code_challenge` was sent) |

**Returns**: `AuthTokens` — `{ accessToken, refreshToken?, expiresIn?, tokenType?, scope? }`

**Throws**: `AuthError` on failure

---

#### `refreshToken(params): Promise<AuthTokens>`

Gets new tokens using a refresh token. **Server-side only.** The auth server implements token rotation — each refresh returns a new refresh token and invalidates the old one.

| Parameter             | Type     | Description                   |
| --------------------- | -------- | ----------------------------- |
| `params.refreshToken` | `string` | The refresh token to exchange |

**Returns**: `AuthTokens` — new access token (and rotated refresh token)

**Throws**: `AuthError` on failure (e.g. `invalid_grant` if refresh token is expired/revoked)

---

#### `getUserInfo(accessToken): Promise<AuthUser>`

Fetches the authenticated user's profile from the userinfo endpoint. **Server-side only.**

| Parameter     | Type     | Description              |
| ------------- | -------- | ------------------------ |
| `accessToken` | `string` | Valid OAuth access token |

**Returns**: `AuthUser` — `{ sub, name?, email?, emailVerified?, picture? }`

The fields returned depend on the scopes granted:

- `openid`: `sub` (user ID)
- `profile`: `name`, `picture`
- `email`: `email`, `emailVerified`

**Throws**: `AuthError` on failure (e.g. `invalid_token` if expired)

---

#### `revokeToken(token): Promise<void>`

Revokes an access or refresh token. **Server-side only.** Per RFC 7009, this always resolves successfully (even if the token is already invalid).

| Parameter | Type     | Description                             |
| --------- | -------- | --------------------------------------- |
| `token`   | `string` | The token to revoke (access or refresh) |

**Throws**: `AuthError` only on network/server errors

---

## Types

### `AuthClientConfig`

```typescript
interface AuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authServerUrl: string;
}
```

### `AuthTokens`

```typescript
interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number; // seconds until expiry (typically 3600)
  tokenType?: string; // "Bearer"
  scope?: string; // granted scopes
}
```

### `AuthUser`

```typescript
interface AuthUser {
  sub: number; // user ID
  name?: string; // F3 name
  email?: string;
  emailVerified?: boolean;
  picture?: string; // avatar URL
}
```

### `OauthClient`

```typescript
interface OauthClient {
  clientId: string;
  redirectUri: string;
  authServerUrl: string;
}
```

### `AuthError`

```typescript
class AuthError extends Error {
  code: string; // OAuth error code (e.g. "invalid_grant")
  statusCode?: number; // HTTP status code
}
```

---

## Error Handling

All async methods throw `AuthError` on failure. The error includes the OAuth error code and HTTP status:

```typescript
import { AuthClient, AuthError } from "@f3-nation/auth-sdk";

try {
  const tokens = await auth.exchangeCodeForToken({ code });
} catch (error) {
  if (error instanceof AuthError) {
    switch (error.code) {
      case "invalid_grant":
        // Code expired or already used
        break;
      case "invalid_client":
        // Bad client_id or client_secret
        break;
      case "invalid_request":
        // Missing or malformed parameters
        break;
      default:
        console.error(`Auth error [${error.code}]: ${error.message}`);
    }
  }
}
```

Common error codes:

| Code              | When                                                  | Suggested Action     |
| ----------------- | ----------------------------------------------------- | -------------------- |
| `invalid_grant`   | Auth code expired/used, refresh token expired/revoked | Redirect to login    |
| `invalid_client`  | Wrong client_id or client_secret                      | Check configuration  |
| `invalid_request` | Missing required parameters                           | Check request params |
| `invalid_scope`   | Requested scopes not allowed for this client          | Reduce scope         |
| `invalid_token`   | Access token expired or revoked (userinfo)            | Refresh the token    |

---

## PKCE Support

For public clients or enhanced security, use PKCE (Proof Key for Code Exchange):

```typescript
import { AuthClient } from "@f3-nation/auth-sdk";

// 1. Generate a code verifier (random string, 43-128 chars)
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// 2. Create the code challenge (SHA-256 hash of verifier)
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// 3. Use in the flow
const codeVerifier = generateCodeVerifier();
const codeChallenge = await generateCodeChallenge(codeVerifier);

// Store codeVerifier in session/cookie (you'll need it for token exchange)

const url = auth.getAuthorizationUrl({
  codeChallenge,
  codeChallengeMethod: "S256",
  state: crypto.randomUUID(),
});
// → redirect user

// 4. On callback, include the verifier
const tokens = await auth.exchangeCodeForToken({
  code: callbackCode,
  codeVerifier, // proves possession of the original challenge
});
```

---

## Token Lifecycle

| Token              | TTL        | Storage | Rotation                                |
| ------------------ | ---------- | ------- | --------------------------------------- |
| Authorization Code | 10 minutes | DB      | Single-use (consumed on exchange)       |
| Access Token       | 1 hour     | DB      | Not rotated; request new via refresh    |
| Refresh Token      | 30 days    | DB      | Rotated on each use (old token revoked) |

**Best practices**:

- Store tokens in HTTP-only cookies or encrypted server-side sessions
- Never expose tokens to client-side JavaScript
- Refresh proactively (e.g. when `expiresIn` < 5 minutes)
- Revoke both access and refresh tokens on sign-out
- Handle `invalid_grant` errors by redirecting to login
