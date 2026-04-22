import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  ACCESS_TOKEN_DEFAULT_MAX_AGE,
  REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_MAX_AGE,
} from "@/lib/auth/constants";
import { refreshToken } from "@/lib/auth/oauth";
import { isAccessTokenExpired } from "@/lib/auth/tokens";

const PUBLIC_PATHS = ["/", "/api/auth/login", "/api/auth/callback"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
  const refreshTokenCookie = request.cookies.get(
    REFRESH_TOKEN_COOKIE_NAME,
  )?.value;

  if (accessToken && !isAccessTokenExpired(accessToken)) {
    return NextResponse.next();
  }

  if (refreshTokenCookie) {
    try {
      const tokens = await refreshToken({ refreshToken: refreshTokenCookie });
      if (tokens.accessToken) {
        const response = NextResponse.next();
        response.cookies.set(ACCESS_TOKEN_COOKIE_NAME, tokens.accessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: tokens.expiresIn ?? ACCESS_TOKEN_DEFAULT_MAX_AGE,
        });

        if (tokens.refreshToken) {
          response.cookies.set(REFRESH_TOKEN_COOKIE_NAME, tokens.refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
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
  if (!pathname.startsWith("/api/")) {
    redirectUrl.searchParams.set("redirect", pathname);
  }

  const response = NextResponse.redirect(redirectUrl);
  response.cookies.set(ACCESS_TOKEN_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(REFRESH_TOKEN_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
