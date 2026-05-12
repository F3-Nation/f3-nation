import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  ACCESS_TOKEN_DEFAULT_MAX_AGE,
  OAUTH_CODE_VERIFIER_COOKIE_NAME,
  OAUTH_CSRF_COOKIE_NAME,
  REFRESH_TOKEN_MAX_AGE,
} from "~/lib/auth/constants";
import {
  setAccessTokenCookie,
  setRefreshTokenCookie,
} from "~/lib/auth/cookies";
import { exchangeCodeForToken, getUserInfo } from "~/lib/auth/oauth";
import { safeReturnTo } from "~/lib/auth/validation";

interface StatePayload {
  csrfToken: string;
  returnTo: string;
  timestamp: number;
}

function getPublicOrigin(): string {
  return (process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002").replace(
    /\/+$/,
    "",
  );
}

function errorRedirect(baseUrl: string, error: string, returnTo?: string) {
  const url = new URL("/auth/sign-in", baseUrl);
  url.searchParams.set("error", error);
  if (returnTo) url.searchParams.set("callbackUrl", returnTo);
  return NextResponse.redirect(url.toString());
}

function parseState(stateParam: string): StatePayload | null {
  try {
    const state = JSON.parse(
      Buffer.from(stateParam, "base64url").toString("utf-8"),
    ) as Partial<StatePayload>;

    if (
      typeof state.csrfToken !== "string" ||
      typeof state.returnTo !== "string" ||
      typeof state.timestamp !== "number"
    ) {
      return null;
    }

    return state as StatePayload;
  } catch {
    return null;
  }
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

  const state = parseState(stateParam);
  if (!state) {
    return errorRedirect(baseUrl, "invalid_state");
  }

  if (Date.now() - state.timestamp > 600_000) {
    return errorRedirect(baseUrl, "expired_state");
  }

  const csrfCookie = request.cookies.get(OAUTH_CSRF_COOKIE_NAME)?.value;
  if (!csrfCookie || csrfCookie !== state.csrfToken) {
    return errorRedirect(baseUrl, "csrf_mismatch");
  }

  const returnTo = safeReturnTo(state.returnTo);
  const codeVerifier = request.cookies.get(
    OAUTH_CODE_VERIFIER_COOKIE_NAME,
  )?.value;

  if (!codeVerifier) {
    return errorRedirect(baseUrl, "missing_code_verifier", returnTo);
  }

  let accessToken: string;
  let refreshToken: string | undefined;
  let expiresIn: number | undefined;

  try {
    const tokens = await exchangeCodeForToken({ code, codeVerifier });
    accessToken = tokens.accessToken;
    refreshToken = tokens.refreshToken;
    expiresIn =
      typeof tokens.expiresIn === "number" ? tokens.expiresIn : undefined;
  } catch (error) {
    console.warn("Admin SSO token exchange failed", error);
    return errorRedirect(baseUrl, "token_exchange_failed", returnTo);
  }

  try {
    const userInfo = await getUserInfo(accessToken);
    if (!userInfo.email) {
      return errorRedirect(baseUrl, "user_not_found", returnTo);
    }
  } catch (error) {
    console.warn("Admin SSO userinfo request failed", error);
    return errorRedirect(baseUrl, "userinfo_failed", returnTo);
  }

  const response = NextResponse.redirect(new URL(returnTo, baseUrl).toString());
  setAccessTokenCookie(
    response,
    accessToken,
    expiresIn ?? ACCESS_TOKEN_DEFAULT_MAX_AGE,
  );

  if (refreshToken) {
    setRefreshTokenCookie(response, refreshToken, REFRESH_TOKEN_MAX_AGE);
  }

  const clearFlowCookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
  response.cookies.set(OAUTH_CSRF_COOKIE_NAME, "", clearFlowCookieOptions);
  response.cookies.set(
    OAUTH_CODE_VERIFIER_COOKIE_NAME,
    "",
    clearFlowCookieOptions,
  );

  return response;
}
