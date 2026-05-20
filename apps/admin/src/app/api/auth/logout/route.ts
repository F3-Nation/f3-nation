import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { REFRESH_TOKEN_COOKIE_NAME } from "~/lib/auth/constants";
import { clearAuthCookies } from "~/lib/auth/cookies";
import { getOAuthConfig, revokeToken } from "~/lib/auth/oauth";

function getLogoutUrl(): string {
  const { authServerUrl } = getOAuthConfig();
  const siteUrl = (
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002"
  ).replace(/\/+$/, "");
  const postLogoutRedirectUri = `${siteUrl}/auth/sign-in?logged_out=true`;

  return `${authServerUrl}/api/oauth/logout?post_logout_redirect_uri=${encodeURIComponent(
    postLogoutRedirectUri,
  )}`;
}

async function revokeRefreshToken(): Promise<void> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE_NAME)?.value;
  if (!refreshToken) return;

  try {
    await revokeToken(refreshToken);
  } catch (error) {
    console.warn("Failed to revoke admin SSO refresh token", error);
  }
}

export async function POST() {
  await revokeRefreshToken();

  const response = NextResponse.json({
    ok: true,
    redirectTo: getLogoutUrl(),
  });
  clearAuthCookies(response);

  return response;
}

export async function GET() {
  await revokeRefreshToken();

  const response = NextResponse.redirect(getLogoutUrl());
  clearAuthCookies(response);

  return response;
}
