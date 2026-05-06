import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  ACCESS_TOKEN_DEFAULT_MAX_AGE,
  REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_MAX_AGE,
} from "@/lib/auth/constants";
import { refreshToken } from "@/lib/auth/oauth";
import { verifyAccessToken } from "@/lib/auth/tokens";

const PUBLIC_PATHS = ["/", "/api/auth/login", "/api/auth/callback"];
const STATIC_ASSET_PATTERN =
  /\.(?:css|js|mjs|map|txt|xml|json|png|jpe?g|gif|webp|svg|ico|bmp|avif|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|ogg|pdf)$/i;

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  // Allow all auth API routes
  if (pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  // Allow static files and Next.js internals
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    STATIC_ASSET_PATTERN.test(pathname)
  ) {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
  const refreshTokenCookie = request.cookies.get(
    REFRESH_TOKEN_COOKIE_NAME,
  )?.value;

  if (accessToken && (await verifyAccessToken(accessToken))) {
    return NextResponse.next();
  }

  if (refreshTokenCookie) {
    try {
      const tokens = await refreshToken({ refreshToken: refreshTokenCookie });
      if (tokens.accessToken) {
        // Forward refreshed tokens into the current request cycle so downstream
        // route handlers and Server Components see the new values immediately.
        const isSecure = process.env.NODE_ENV === "production";
        const existingCookie = request.headers.get("cookie") ?? "";
        const filteredCookie = existingCookie
          .split(";")
          .map((c) => c.trim())
          .filter(
            (c) =>
              !c.startsWith(`${ACCESS_TOKEN_COOKIE_NAME}=`) &&
              !c.startsWith(`${REFRESH_TOKEN_COOKIE_NAME}=`),
          )
          .join("; ");
        const newCookieParts = [
          filteredCookie,
          `${ACCESS_TOKEN_COOKIE_NAME}=${tokens.accessToken}`,
          ...(tokens.refreshToken
            ? [`${REFRESH_TOKEN_COOKIE_NAME}=${tokens.refreshToken}`]
            : []),
        ]
          .filter(Boolean)
          .join("; ");
        const requestHeaders = new Headers(request.headers);
        requestHeaders.set("cookie", newCookieParts);

        const response = NextResponse.next({
          request: { headers: requestHeaders },
        });
        response.cookies.set(ACCESS_TOKEN_COOKIE_NAME, tokens.accessToken, {
          httpOnly: true,
          secure: isSecure,
          sameSite: "lax",
          path: "/",
          maxAge: tokens.expiresIn ?? ACCESS_TOKEN_DEFAULT_MAX_AGE,
        });

        if (tokens.refreshToken) {
          response.cookies.set(REFRESH_TOKEN_COOKIE_NAME, tokens.refreshToken, {
            httpOnly: true,
            secure: isSecure,
            sameSite: "lax",
            path: "/",
            maxAge: REFRESH_TOKEN_MAX_AGE,
          });
        }

        return response;
      }
    } catch {
      // Fall through to clearing cookies + redirect.
    }
  }

  const redirectUrl = new URL("/", request.url);
  const clearCookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };

  if (pathname.startsWith("/api/")) {
    const response = NextResponse.json(
      { error: "unauthorized" },
      { status: 401 },
    );
    response.cookies.set(ACCESS_TOKEN_COOKIE_NAME, "", clearCookieOpts);
    response.cookies.set(REFRESH_TOKEN_COOKIE_NAME, "", clearCookieOpts);
    return response;
  }

  redirectUrl.searchParams.set("redirect", pathname + search);
  const response = NextResponse.redirect(redirectUrl);
  response.cookies.set(ACCESS_TOKEN_COOKIE_NAME, "", {
    ...clearCookieOpts,
  });
  response.cookies.set(REFRESH_TOKEN_COOKIE_NAME, "", {
    ...clearCookieOpts,
  });

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
