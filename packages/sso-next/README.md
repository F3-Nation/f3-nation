# @f3nation/sso-next

Next.js adapter for F3 SSO.

This package is the **single entry point** for F3 SSO in Next.js apps.
It wraps the framework-agnostic `@f3nation/sso` core and re-exports its
public API so apps only need one dependency.

## Installation

```bash
pnpm add @f3nation/sso-next --filter your-app
```

## Includes

Route handlers:

- `handleLoginRoute`
- `handleCallbackRoute`
- `handleLogoutRoute`

Adapter:

- `createSsoAdapter`
- `buildSsoCookieOptions`

Re-exported from `@f3nation/sso`:

- `verifyAccessToken`
- `isSafeReturnPath` / `sanitizeReturnPath`
- `createOAuthLoginFlowArtifacts`
- `AuthError`

## Peer Dependencies

- `next >= 15`

## Usage

### 1. Create the adapter (once per app)

```ts
// src/lib/auth/oauth.ts
import { createSsoAdapter } from "@f3nation/sso-next";
import { env } from "@/env";

export const sso = createSsoAdapter(() => ({
  clientId: env.OAUTH_CLIENT_ID,
  clientSecret: env.OAUTH_CLIENT_SECRET,
  redirectUri: env.OAUTH_REDIRECT_URI,
  authServerUrl: env.AUTH_PROVIDER_URL,
}));
```

### 2. Login route — `src/app/api/auth/login/route.ts`

```ts
import type { NextRequest } from "next/server";
import { handleLoginRoute } from "@f3nation/sso-next";
import { sso } from "@/lib/auth/oauth";

export async function GET(request: NextRequest) {
  return handleLoginRoute(request, {
    adapter: sso,
    cookieNames: {
      oauthCsrf: "oauth_csrf",
      oauthCodeVerifier: "oauth_code_verifier",
    },
    flowCookieMaxAge: 600,
    defaultReturnTo: "/",
  });
}
```

### 3. Callback route — `src/app/api/auth/callback/route.ts`

```ts
import type { NextRequest } from "next/server";
import { handleCallbackRoute } from "@f3nation/sso-next";
import { sso } from "@/lib/auth/oauth";

export async function GET(request: NextRequest) {
  return handleCallbackRoute(request, {
    adapter: sso,
    cookieNames: {
      accessToken: "access_token",
      refreshToken: "refresh_token",
      oauthCsrf: "oauth_csrf",
      oauthCodeVerifier: "oauth_code_verifier",
    },
    publicOrigin: env.NEXT_PUBLIC_SITE_URL, // use your validated env module
    errorPath: "/",
    accessTokenMaxAge: 3600,
    refreshTokenMaxAge: 30 * 24 * 3600,
  });
}
```

### 4. Logout route — `src/app/api/auth/logout/route.ts`

```ts
import { cookies } from "next/headers";
import { handleLogoutRoute } from "@f3nation/sso-next";
import { sso } from "@/lib/auth/oauth";

const COOKIE_NAMES = {
  accessToken: "access_token",
  refreshToken: "refresh_token",
  oauthCsrf: "oauth_csrf",
  oauthCodeVerifier: "oauth_cv",
};

export async function POST() {
  const cookieStore = await cookies();
  return handleLogoutRoute(
    async () => cookieStore.get(COOKIE_NAMES.refreshToken)?.value,
    {
      adapter: sso,
      cookieNames: COOKIE_NAMES,
      postLogoutRedirectUri: "https://app.example.com?logged_out=true",
    },
  );
}
```
