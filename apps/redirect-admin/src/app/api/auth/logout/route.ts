import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { getOAuthConfig } from "@/lib/auth/oauth";

export async function POST() {
  const { authServerUrl } = getOAuthConfig();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3006";

  const response = NextResponse.json({
    ok: true,
    redirectTo: `${authServerUrl}/api/oauth/logout?post_logout_redirect_uri=${encodeURIComponent(siteUrl)}`,
  });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
