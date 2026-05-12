import type { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_TOKEN_COOKIE_NAME,
  ACCESS_TOKEN_DEFAULT_MAX_AGE,
  OAUTH_CODE_VERIFIER_COOKIE_NAME,
  OAUTH_CSRF_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_MAX_AGE,
} from "./constants";

const authCookieBaseOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

function getAuthCookieOptions(maxAge: number) {
  return {
    ...authCookieBaseOptions,
    maxAge,
  };
}

export function getClearAuthCookieOptions() {
  return getAuthCookieOptions(0);
}

export function getAccessTokenCookie(request: NextRequest): string | null {
  return request.cookies.get(ACCESS_TOKEN_COOKIE_NAME)?.value ?? null;
}

export function getRefreshTokenCookie(request: NextRequest): string | null {
  return request.cookies.get(REFRESH_TOKEN_COOKIE_NAME)?.value ?? null;
}

export function setAccessTokenCookie(
  response: NextResponse,
  accessToken: string,
  maxAge = ACCESS_TOKEN_DEFAULT_MAX_AGE,
): void {
  response.cookies.set(
    ACCESS_TOKEN_COOKIE_NAME,
    accessToken,
    getAuthCookieOptions(maxAge),
  );
}

export function setRefreshTokenCookie(
  response: NextResponse,
  refreshToken: string,
  maxAge = REFRESH_TOKEN_MAX_AGE,
): void {
  response.cookies.set(
    REFRESH_TOKEN_COOKIE_NAME,
    refreshToken,
    getAuthCookieOptions(maxAge),
  );
}

export function clearAuthCookies(response: NextResponse): void {
  const options = getClearAuthCookieOptions();

  response.cookies.set(ACCESS_TOKEN_COOKIE_NAME, "", options);
  response.cookies.set(REFRESH_TOKEN_COOKIE_NAME, "", options);
  response.cookies.set(OAUTH_CSRF_COOKIE_NAME, "", options);
  response.cookies.set(OAUTH_CODE_VERIFIER_COOKIE_NAME, "", options);
}
