import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  OAUTH_CODE_VERIFIER_COOKIE_NAME,
  OAUTH_CSRF_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from "@/lib/auth/constants";
import { getOAuthConfig, revokeToken } from "@/lib/auth/oauth";

export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE_NAME)?.value;
  const { authServerUrl } = getOAuthConfig();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3003";

  if (refreshToken) {
    try {
      await revokeToken(refreshToken);
    } catch (err) {
      console.error("Failed to revoke refresh token", err);
    }
  }

  const response = NextResponse.json({
    ok: true,
    redirectTo: `${authServerUrl}/api/oauth/logout?post_logout_redirect_uri=${encodeURIComponent(`${siteUrl}?logged_out=true`)}`,
  });
  const clearCookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
  response.cookies.set(ACCESS_TOKEN_COOKIE_NAME, "", clearCookieOpts);
  response.cookies.set(REFRESH_TOKEN_COOKIE_NAME, "", clearCookieOpts);
  response.cookies.set(OAUTH_CSRF_COOKIE_NAME, "", clearCookieOpts);
  response.cookies.set(OAUTH_CODE_VERIFIER_COOKIE_NAME, "", clearCookieOpts);
  return response;
}
