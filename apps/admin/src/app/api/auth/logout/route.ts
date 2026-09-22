import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { handleLogoutRoute, SSO_COOKIE_NAMES } from "@f3nation/sso-next";

import { env } from "~/env";
import { sso } from "~/lib/auth/oauth";

function buildPostLogoutUri(): string {
  const siteUrl = env.F3_ADMIN_BASE_URL;
  return `${siteUrl.replace(/\/+$/, "")}/auth/sign-in?logged_out=true`;
}

async function getRefreshToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(SSO_COOKIE_NAMES.refreshToken)?.value;
}

export async function POST() {
  return handleLogoutRoute(getRefreshToken, {
    adapter: sso,
    cookieNames: SSO_COOKIE_NAMES,
    postLogoutRedirectUri: buildPostLogoutUri(),
  });
}

// GET is used by navigateToSsoLogout() (browser navigation) — redirect
// directly to the auth-server logout URL instead of returning JSON.
export async function GET() {
  const result = await handleLogoutRoute(getRefreshToken, {
    adapter: sso,
    cookieNames: SSO_COOKIE_NAMES,
    postLogoutRedirectUri: buildPostLogoutUri(),
  });
  const { redirectTo } = (await result.json()) as { redirectTo: string };
  const redirect = NextResponse.redirect(redirectTo, 302);
  for (const cookie of result.headers.getSetCookie()) {
    redirect.headers.append("set-cookie", cookie);
  }
  return redirect;
}
