import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { exchangeCodeForToken, getUserInfo } from "@/lib/auth/oauth";
import { safeReturnTo } from "@/lib/auth/validation";

interface StatePayload {
  csrfToken: string;
  returnTo: string;
  timestamp: number;
}

function getPublicOrigin(): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) throw new Error("NEXT_PUBLIC_SITE_URL is not configured");
  return siteUrl.replace(/\/+$/, "");
}

function errorRedirect(baseUrl: string, error: string, returnTo?: string) {
  const url = new URL("/", baseUrl);
  url.searchParams.set("error", error);
  if (returnTo) url.searchParams.set("redirect", returnTo);
  return NextResponse.redirect(url.toString());
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const errorParam = searchParams.get("error");
  const baseUrl = getPublicOrigin();

  if (errorParam) {
    return errorRedirect(baseUrl, errorParam);
  }

  if (!code || !stateParam) {
    return errorRedirect(baseUrl, "missing_params");
  }

  // Decode and validate state
  let state: StatePayload;
  try {
    state = JSON.parse(
      Buffer.from(stateParam, "base64url").toString("utf-8"),
    ) as StatePayload;
  } catch {
    return errorRedirect(baseUrl, "invalid_state");
  }

  // Check timestamp (10 minute window)
  if (Date.now() - state.timestamp > 600_000) {
    return errorRedirect(baseUrl, "expired_state");
  }

  // Validate CSRF token against cookie
  const csrfCookie = request.cookies.get("oauth_csrf")?.value;
  if (!csrfCookie || csrfCookie !== state.csrfToken) {
    return errorRedirect(baseUrl, "csrf_mismatch");
  }

  // Re-validate returnTo from state (defense-in-depth against tampered state)
  const returnTo = safeReturnTo(state.returnTo);

  // Validate PKCE code verifier cookie
  const codeVerifier = request.cookies.get("oauth_code_verifier")?.value;
  if (!codeVerifier) {
    return errorRedirect(baseUrl, "missing_code_verifier", returnTo);
  }

  // Exchange code for tokens
  let accessToken: string;
  let refreshTokenValue: string | undefined;
  let expiresIn: number | undefined;
  try {
    const tokens = await exchangeCodeForToken({ code, codeVerifier });
    if (!tokens.accessToken) {
      return errorRedirect(baseUrl, "token_exchange_failed", returnTo);
    }
    accessToken = tokens.accessToken;
    refreshTokenValue = tokens.refreshToken;
    expiresIn =
      typeof tokens.expiresIn === "number" ? tokens.expiresIn : undefined;
  } catch (err) {
    console.error("Token exchange failed", err);
    return errorRedirect(baseUrl, "token_exchange_failed", returnTo);
  }

  // Fetch user info — sub is the numeric user ID
  let userInfo: { sub: number; email?: string; name?: string };
  try {
    userInfo = await getUserInfo(accessToken);
  } catch (err) {
    console.error("Failed to fetch user info", err);
    return errorRedirect(baseUrl, "userinfo_failed", returnTo);
  }

  if (!userInfo.email) {
    return errorRedirect(baseUrl, "user_not_found", returnTo);
  }

  const response = NextResponse.redirect(new URL(returnTo, baseUrl).toString());
  const accessTokenMaxAge = expiresIn ?? 60 * 60;
  const refreshTokenMaxAge = 30 * 24 * 60 * 60;

  response.cookies.set("access_token", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: accessTokenMaxAge,
  });

  if (refreshTokenValue) {
    response.cookies.set("refresh_token", refreshTokenValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: refreshTokenMaxAge,
    });
  }

  // Clear OAuth flow cookies
  const clearCookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
  response.cookies.set("oauth_csrf", "", clearCookieOpts);
  response.cookies.set("oauth_code_verifier", "", clearCookieOpts);

  return response;
}
