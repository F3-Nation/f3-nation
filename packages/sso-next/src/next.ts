/**
 * @f3nation/sso-next — minimal Next.js adapter for F3 SSO.
 *
 * Provides framework-bound helpers (login, callback, logout route handlers and
 * cookie utilities) on top of the framework-agnostic `@f3nation/sso` primitives.
 *
 * Policy decisions remain app-owned:
 *  - cookie names and lifetimes  (SsoCookieNames + config fields)
 *  - error redirect targets       (SsoCallbackRouteConfig.errorPath)
 *  - post-logout redirect URL     (SsoLogoutRouteConfig.postLogoutRedirectUri)
 *  - role / user validation       (SsoCallbackRouteConfig.validateUser)
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  AuthClient,
  createOAuthLoginFlowArtifacts,
  isOAuthStateExpired,
  parseOAuthState,
  sanitizeReturnPath,
} from "@f3nation/sso";
import type {
  AuthClientConfig,
  AuthTokens,
  AuthUser,
  OAuthClient,
} from "@f3nation/sso";

// ---------------------------------------------------------------------------
// Re-export for consumer convenience
// ---------------------------------------------------------------------------
export type { AuthClientConfig, AuthTokens, AuthUser, OAuthClient };

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

export interface SsoCookieNames {
  accessToken: string;
  refreshToken: string;
  oauthCsrf: string;
  oauthCodeVerifier: string;
}

/**
 * Returns standard httpOnly/secure/sameSite/path cookie options with the
 * given `maxAge`.  Use `maxAge: 0` to produce a clear-cookie instruction.
 */
export function buildSsoCookieOptions(maxAge: number): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

// ---------------------------------------------------------------------------
// SsoAdapter — wraps AuthClient with lazy initialisation
// ---------------------------------------------------------------------------

export interface SsoAdapter {
  getOAuthConfig(): OAuthClient;
  getAuthorizationUrl(params: {
    scope?: string;
    state?: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
  }): string;
  exchangeCodeForToken(params: {
    code: string;
    codeVerifier: string;
  }): Promise<AuthTokens>;
  getUserInfo(accessToken: string): Promise<AuthUser>;
  refreshToken(params: { refreshToken: string }): Promise<AuthTokens>;
  revokeToken(token: string): Promise<void>;
}

/**
 * Creates a lazily-initialised {@link SsoAdapter} from a config factory.
 * The factory is called once (on first use) so env reads happen at runtime,
 * not at module load time.
 *
 * @example
 * ```ts
 * // apps/my-app/src/lib/auth/oauth.ts
 * import { createSsoAdapter } from "@f3nation/sso-next";
 * import { env } from "@/env";
 *
 * export const sso = createSsoAdapter(() => ({
 *   clientId: env.OAUTH_CLIENT_ID,
 *   clientSecret: env.OAUTH_CLIENT_SECRET,
 *   redirectUri: env.OAUTH_REDIRECT_URI,
 *   authServerUrl: env.AUTH_PROVIDER_URL,
 * }));
 * ```
 */
export function createSsoAdapter(
  configFactory: () => AuthClientConfig,
): SsoAdapter {
  let _client: AuthClient | null = null;

  function getClient(): AuthClient {
    _client ??= new AuthClient(configFactory());
    return _client;
  }

  return {
    getOAuthConfig: () => getClient().getOAuthConfig(),
    getAuthorizationUrl: (params) => getClient().getAuthorizationUrl(params),
    exchangeCodeForToken: (params) => getClient().exchangeCodeForToken(params),
    getUserInfo: (token) => getClient().getUserInfo(token),
    refreshToken: (params) => getClient().refreshToken(params),
    revokeToken: (token) => getClient().revokeToken(token),
  };
}

// ---------------------------------------------------------------------------
// handleLoginRoute
// ---------------------------------------------------------------------------

export interface SsoLoginRouteConfig {
  /** Adapter (or any object with getAuthorizationUrl). */
  adapter: Pick<SsoAdapter, "getAuthorizationUrl">;
  cookieNames: Pick<SsoCookieNames, "oauthCsrf" | "oauthCodeVerifier">;
  /** Max-age for the short-lived PKCE / CSRF flow cookies, in seconds. */
  flowCookieMaxAge: number;
  /** Fallback returnTo path when none is supplied or the supplied value is unsafe. */
  defaultReturnTo?: string;
}

/**
 * Handles `GET /api/auth/login`:
 *  1. Generates PKCE code verifier + challenge and a CSRF-bearing state param.
 *  2. Sets short-lived httpOnly CSRF and code-verifier cookies.
 *  3. Redirects the browser to the auth server's authorisation endpoint.
 */
export async function handleLoginRoute(
  request: NextRequest,
  config: SsoLoginRouteConfig,
): Promise<NextResponse> {
  const rawReturnTo = request.nextUrl.searchParams.get("returnTo");
  const returnTo = sanitizeReturnPath(
    rawReturnTo,
    config.defaultReturnTo ?? "/",
  );

  const { csrfToken, codeVerifier, codeChallenge, state } =
    await createOAuthLoginFlowArtifacts({ returnTo });

  const authorizeUrl = config.adapter.getAuthorizationUrl({
    state,
    codeChallenge,
    codeChallengeMethod: "S256",
  });

  const response = NextResponse.redirect(authorizeUrl, 302);
  const cookieOpts = buildSsoCookieOptions(config.flowCookieMaxAge);

  response.cookies.set(config.cookieNames.oauthCsrf, csrfToken, cookieOpts);
  response.cookies.set(
    config.cookieNames.oauthCodeVerifier,
    codeVerifier,
    cookieOpts,
  );

  return response;
}

// ---------------------------------------------------------------------------
// handleCallbackRoute
// ---------------------------------------------------------------------------

export interface SsoCallbackRouteConfig {
  /** Adapter (or any object with exchangeCodeForToken + getUserInfo). */
  adapter: Pick<SsoAdapter, "exchangeCodeForToken" | "getUserInfo">;
  cookieNames: SsoCookieNames;
  /** Absolute origin of the app, e.g. `process.env.NEXT_PUBLIC_SITE_URL`. */
  publicOrigin: string;
  /**
   * Path (relative to `publicOrigin`) to redirect to on error.
   * @example "/" or "/auth/sign-in"
   */
  errorPath: string;
  /**
   * Query-param name used to surface the failed returnTo path in the error
   * redirect, so the error page can offer a retry link.
   * @default "returnTo"
   */
  errorReturnToParam?: string;
  /** Fallback returnTo when the state's returnTo is absent or unsafe. */
  defaultReturnTo?: string;
  /** Fallback access-token max-age (seconds) when the token response omits `expiresIn`. */
  accessTokenMaxAge: number;
  /** Max-age for the refresh-token cookie (seconds). */
  refreshTokenMaxAge: number;
  /**
   * Optional user-validation hook.  Return `false` to fail the callback with
   * `"user_not_found"`.  Defaults to requiring a non-empty `email` claim.
   * `returnTo` is the resolved return path so the hook can include it in logs.
   */
  validateUser?: (
    user: AuthUser,
    returnTo: string,
  ) => boolean | Promise<boolean>;
  /** Maximum accepted OAuth state age in milliseconds. @default 600_000 */
  stateMaxAgeMs?: number;
}

/**
 * Handles `GET /api/auth/callback`:
 *  1. Validates the state param (CSRF, expiry, signature).
 *  2. Exchanges the authorisation code for tokens.
 *  3. Fetches user info and runs optional `validateUser`.
 *  4. Sets access-token and refresh-token cookies, clears flow cookies.
 *  5. Redirects to the original returnTo path.
 */
export async function handleCallbackRoute(
  request: NextRequest,
  config: SsoCallbackRouteConfig,
): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const errorParam = searchParams.get("error");
  // Trim trailing slashes without a polynomial regex (CodeQL safe).
  let baseUrl = config.publicOrigin;
  while (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);
  const returnToParam = config.errorReturnToParam ?? "returnTo";

  function errorRedirect(error: string, returnTo?: string): NextResponse {
    const url = new URL(config.errorPath, baseUrl);
    url.searchParams.set("error", error);
    if (returnTo) url.searchParams.set(returnToParam, returnTo);
    return NextResponse.redirect(url.toString(), 302);
  }

  if (errorParam) return errorRedirect(errorParam);
  if (!code || !stateParam) return errorRedirect("missing_params");

  const state = parseOAuthState(stateParam);
  if (!state) return errorRedirect("invalid_state");
  if (isOAuthStateExpired(state, config.stateMaxAgeMs ?? 600_000))
    return errorRedirect("expired_state");

  const csrfCookie = request.cookies.get(config.cookieNames.oauthCsrf)?.value;
  if (!csrfCookie || csrfCookie !== state.csrfToken) {
    return errorRedirect("csrf_mismatch");
  }

  const returnTo = sanitizeReturnPath(
    state.returnTo,
    config.defaultReturnTo ?? "/",
  );

  const codeVerifier = request.cookies.get(
    config.cookieNames.oauthCodeVerifier,
  )?.value;
  if (!codeVerifier) return errorRedirect("missing_code_verifier", returnTo);

  let tokens: AuthTokens;
  try {
    tokens = await config.adapter.exchangeCodeForToken({ code, codeVerifier });
    if (!tokens.accessToken)
      return errorRedirect("token_exchange_failed", returnTo);
  } catch {
    return errorRedirect("token_exchange_failed", returnTo);
  }

  let user: AuthUser;
  try {
    user = await config.adapter.getUserInfo(tokens.accessToken);
  } catch {
    return errorRedirect("userinfo_failed", returnTo);
  }

  const isValid = config.validateUser
    ? await config.validateUser(user, returnTo)
    : Boolean(user.email);
  if (!isValid) return errorRedirect("user_not_found", returnTo);

  const response = NextResponse.redirect(
    new URL(returnTo, baseUrl).toString(),
    302,
  );
  const accessTokenMaxAge =
    typeof tokens.expiresIn === "number"
      ? tokens.expiresIn
      : config.accessTokenMaxAge;

  response.cookies.set(
    config.cookieNames.accessToken,
    tokens.accessToken,
    buildSsoCookieOptions(accessTokenMaxAge),
  );

  if (tokens.refreshToken) {
    response.cookies.set(
      config.cookieNames.refreshToken,
      tokens.refreshToken,
      buildSsoCookieOptions(config.refreshTokenMaxAge),
    );
  }

  const clearOpts = buildSsoCookieOptions(0);
  response.cookies.set(config.cookieNames.oauthCsrf, "", clearOpts);
  response.cookies.set(config.cookieNames.oauthCodeVerifier, "", clearOpts);

  return response;
}

// ---------------------------------------------------------------------------
// handleLogoutRoute
// ---------------------------------------------------------------------------

export interface SsoLogoutRouteConfig {
  /** Adapter (or any object with revokeToken + getOAuthConfig). */
  adapter: Pick<SsoAdapter, "revokeToken" | "getOAuthConfig">;
  cookieNames: SsoCookieNames;
  /**
   * Full URI the auth server should redirect back to after clearing its
   * session.  Apps build this from their own base URL + desired landing page.
   * @example `https://me.f3nation.com?logged_out=true`
   */
  postLogoutRedirectUri: string;
}

/**
 * Shared logout implementation:
 *  1. Reads the refresh token via `getRefreshToken()` and revokes it.
 *  2. Clears all auth + flow cookies from the response.
 *  3. Returns `{ ok: true, redirectTo }` JSON so the client can navigate to
 *     the auth server's post-logout endpoint.
 *
 * @param getRefreshToken  Async function that reads the refresh token from
 *                         the request cookies (use `next/headers` `cookies()`).
 */
export async function handleLogoutRoute(
  getRefreshToken: () => Promise<string | undefined>,
  config: SsoLogoutRouteConfig,
): Promise<NextResponse> {
  const refreshToken = await getRefreshToken();

  if (refreshToken) {
    try {
      await config.adapter.revokeToken(refreshToken);
    } catch {
      // Non-fatal: continue clearing cookies even if revocation fails.
    }
  }

  const { authServerUrl } = config.adapter.getOAuthConfig();
  const logoutUrl = new URL("/api/oauth/logout", authServerUrl);
  logoutUrl.searchParams.set(
    "post_logout_redirect_uri",
    config.postLogoutRedirectUri,
  );
  const redirectTo = logoutUrl.toString();

  const response = NextResponse.json({ ok: true, redirectTo });
  const clearOpts = buildSsoCookieOptions(0);

  response.cookies.set(config.cookieNames.accessToken, "", clearOpts);
  response.cookies.set(config.cookieNames.refreshToken, "", clearOpts);
  response.cookies.set(config.cookieNames.oauthCsrf, "", clearOpts);
  response.cookies.set(config.cookieNames.oauthCodeVerifier, "", clearOpts);

  return response;
}
