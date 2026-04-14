/**
 * OAuth callback — copied from apps/me, rebranded imports only.
 * Validates CSRF + PKCE, exchanges the code for tokens, resolves the user,
 * then writes a signed session cookie and redirects to the original
 * `returnTo` path (defaulting to /domains).
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { exchangeCodeForToken, getUserInfo } from "@/lib/auth/oauth";
import { createSessionValue } from "@/lib/auth/session";
import {
  SESSION_COOKIE_MAX_AGE,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/constants";
import { safeReturnTo } from "@/lib/auth/validation";

interface StatePayload {
  csrfToken: string;
  clientId: string;
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

  let state: StatePayload;
  try {
    state = JSON.parse(
      Buffer.from(stateParam, "base64url").toString("utf-8"),
    ) as StatePayload;
  } catch {
    return errorRedirect(baseUrl, "invalid_state");
  }

  if (Date.now() - state.timestamp > 600_000) {
    return errorRedirect(baseUrl, "expired_state");
  }

  const csrfCookie = request.cookies.get("oauth_csrf")?.value;
  if (!csrfCookie || csrfCookie !== state.csrfToken) {
    return errorRedirect(baseUrl, "csrf_mismatch");
  }

  const returnTo = safeReturnTo(state.returnTo);

  const codeVerifier = request.cookies.get("oauth_code_verifier")?.value;
  if (!codeVerifier) {
    return errorRedirect(baseUrl, "missing_code_verifier", returnTo);
  }

  let accessToken: string;
  try {
    const tokens = await exchangeCodeForToken({ code, codeVerifier });
    if (!tokens.accessToken) {
      return errorRedirect(baseUrl, "token_exchange_failed", returnTo);
    }
    accessToken = tokens.accessToken;
  } catch (err) {
    console.error("Token exchange failed", err);
    return errorRedirect(baseUrl, "token_exchange_failed", returnTo);
  }

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

  const sessionValue = createSessionValue({
    sub: String(userInfo.sub),
    email: userInfo.email,
    name: userInfo.name,
    userId: userInfo.sub,
  });

  const response = NextResponse.redirect(new URL(returnTo, baseUrl).toString());

  response.cookies.set(SESSION_COOKIE_NAME, sessionValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE,
  });

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
