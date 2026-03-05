import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { exchangeCodeForToken, getUserInfo } from "@/lib/auth/oauth";
import { createSessionValue } from "@/lib/auth/session";
import {
  SESSION_COOKIE_MAX_AGE,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/constants";

interface StatePayload {
  csrfToken: string;
  clientId: string;
  returnTo: string;
  timestamp: number;
}

function getPublicOrigin(request: NextRequest): string {
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host =
    request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (host) return `${proto}://${host}`;
  return request.nextUrl.origin;
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
  const baseUrl = getPublicOrigin(request);

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

  const returnTo = state.returnTo || "/profile";

  // Validate PKCE code verifier cookie
  const codeVerifier = request.cookies.get("oauth_code_verifier")?.value;
  if (!codeVerifier) {
    return errorRedirect(baseUrl, "missing_code_verifier", returnTo);
  }

  // Exchange code for tokens
  let accessToken: string;
  try {
    const tokens = await exchangeCodeForToken({ code, codeVerifier });
    accessToken = (tokens.access_token ?? tokens.accessToken) as string;
    if (!accessToken) {
      return errorRedirect(baseUrl, "token_exchange_failed", returnTo);
    }
  } catch (err) {
    console.error("Token exchange failed", err);
    return errorRedirect(baseUrl, "token_exchange_failed", returnTo);
  }

  // Fetch user info
  let userInfo: { sub: string; email: string; name?: string };
  try {
    userInfo = await getUserInfo(accessToken);
  } catch (err) {
    console.error("Failed to fetch user info", err);
    return errorRedirect(baseUrl, "userinfo_failed", returnTo);
  }

  // Create HMAC session cookie
  const sessionValue = createSessionValue({
    sub: userInfo.sub,
    email: userInfo.email,
    name: userInfo.name,
  });

  const response = NextResponse.redirect(new URL(returnTo, baseUrl).toString());

  response.cookies.set(SESSION_COOKIE_NAME, sessionValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE,
  });

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
