import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { routes } from "@acme/shared/app/constants";

import {
  ACCESS_TOKEN_COOKIE_NAME,
  ACCESS_TOKEN_DEFAULT_MAX_AGE,
  REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_MAX_AGE,
} from "~/lib/auth/constants";
import { refreshToken } from "~/lib/auth/oauth";
import { verifyAccessTokenPayload } from "~/lib/auth/tokens";
import { logWarn } from "~/lib/logging";

const PUBLIC_PATHS = ["/auth/sign-in", routes.admin.noAccess.__path];
const STATIC_ASSET_PATTERN =
  /\.(?:css|js|mjs|map|txt|xml|json|png|jpe?g|gif|webp|svg|ico|bmp|avif|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|ogg|pdf)$/i;

const clearCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 0,
};

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname) || pathname.startsWith("/api/auth/");
}

function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    STATIC_ASSET_PATTERN.test(pathname)
  );
}

function clearAuthCookies(response: NextResponse): void {
  response.cookies.set(ACCESS_TOKEN_COOKIE_NAME, "", clearCookieOptions);
  response.cookies.set(REFRESH_TOKEN_COOKIE_NAME, "", clearCookieOptions);
}

function getAdminOrigin(request: NextRequest): string {
  return (
    process.env.F3_ADMIN_BASE_URL ??
    `${request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "")}://${request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host}`
  ).replace(/\/+$/, "");
}

function redirectToLogin(request: NextRequest): NextResponse {
  const loginUrl = new URL("/api/auth/login", getAdminOrigin(request));
  loginUrl.searchParams.set(
    "returnTo",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  const response = NextResponse.redirect(loginUrl);
  clearAuthCookies(response);
  return response;
}

function unauthorized(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const response = NextResponse.json(
      { error: "unauthorized" },
      { status: 401 },
    );
    clearAuthCookies(response);
    return response;
  }

  return redirectToLogin(request);
}

function getRequestHeadersWithPath(request: NextRequest): Headers {
  const headers = new Headers(request.headers);
  headers.set("x-admin-pathname", request.nextUrl.pathname);
  return headers;
}

function withRefreshedCookieHeader(
  request: NextRequest,
  accessToken: string,
  refreshTokenValue?: string,
): Headers {
  const existingCookie = request.headers.get("cookie") ?? "";
  const filteredCookie = existingCookie
    .split(";")
    .map((cookie) => cookie.trim())
    .filter(
      (cookie) =>
        !cookie.startsWith(`${ACCESS_TOKEN_COOKIE_NAME}=`) &&
        !cookie.startsWith(`${REFRESH_TOKEN_COOKIE_NAME}=`),
    )
    .join("; ");
  const newCookie = [
    filteredCookie,
    `${ACCESS_TOKEN_COOKIE_NAME}=${accessToken}`,
    ...(refreshTokenValue
      ? [`${REFRESH_TOKEN_COOKIE_NAME}=${refreshTokenValue}`]
      : []),
  ]
    .filter(Boolean)
    .join("; ");
  const headers = getRequestHeadersWithPath(request);
  headers.set("cookie", newCookie);
  return headers;
}

function setRefreshedCookies(
  response: NextResponse,
  accessToken: string,
  expiresIn?: number,
  refreshTokenValue?: string,
): void {
  response.cookies.set(ACCESS_TOKEN_COOKIE_NAME, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: expiresIn ?? ACCESS_TOKEN_DEFAULT_MAX_AGE,
  });

  if (refreshTokenValue) {
    response.cookies.set(REFRESH_TOKEN_COOKIE_NAME, refreshTokenValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: REFRESH_TOKEN_MAX_AGE,
    });
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname) || isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
  const refreshTokenCookie = request.cookies.get(
    REFRESH_TOKEN_COOKIE_NAME,
  )?.value;

  if (accessToken) {
    const payload = await verifyAccessTokenPayload(accessToken);
    if (payload) {
      return NextResponse.next({
        request: { headers: getRequestHeadersWithPath(request) },
      });
    }
  }

  if (refreshTokenCookie) {
    // Only clear auth cookies on navigation requests when refresh fails.
    // Concurrent sub-resource requests (API fetches, RSC prefetches) race to
    // redeem the same refresh token; all but one lose with invalid_grant.
    // If we clear cookies on every losing response we log the user out even
    // though the winning request may have already set fresh tokens (#375).
    const isNavigationRequest =
      request.headers.get("sec-fetch-mode") === "navigate";

    try {
      const tokens = await refreshToken({ refreshToken: refreshTokenCookie });
      if (!tokens.accessToken) {
        throw new Error("Refreshed access token missing");
      }

      const payload = await verifyAccessTokenPayload(tokens.accessToken);
      if (!payload) {
        throw new Error("Refreshed access token verification failed");
      }

      const requestHeaders = withRefreshedCookieHeader(
        request,
        tokens.accessToken,
        tokens.refreshToken,
      );
      const response = NextResponse.next({
        request: { headers: requestHeaders },
      });
      setRefreshedCookies(
        response,
        tokens.accessToken,
        tokens.expiresIn,
        tokens.refreshToken,
      );
      return response;
    } catch (err) {
      logWarn("admin.auth.refresh_failed", {
        isNavigationRequest,
        errorMessage: err instanceof Error ? err.message : String(err),
      });

      // Non-navigation requests (API, prefetch): return 401 without touching
      // cookies so the winning rotation's Set-Cookie headers are not clobbered.
      if (!isNavigationRequest) {
        if (request.nextUrl.pathname.startsWith("/api/")) {
          return NextResponse.json({ error: "unauthorized" }, { status: 401 });
        }
        return NextResponse.next();
      }
      // Navigation request: refresh genuinely dead — fall through to clear + redirect.
    }
  }

  return unauthorized(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
