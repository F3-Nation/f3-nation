import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { handleLogoutRoute } from "@f3nation/sso-next";

import {
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
  OAUTH_CSRF_COOKIE_NAME,
  OAUTH_CODE_VERIFIER_COOKIE_NAME,
} from "~/lib/auth/constants";
import { env } from "~/env";
import { sso } from "~/lib/auth/oauth";

const COOKIE_NAMES = {
  accessToken: ACCESS_TOKEN_COOKIE_NAME,
  refreshToken: REFRESH_TOKEN_COOKIE_NAME,
  oauthCsrf: OAUTH_CSRF_COOKIE_NAME,
  oauthCodeVerifier: OAUTH_CODE_VERIFIER_COOKIE_NAME,
};

function buildPostLogoutUri(): string {
  const siteUrl = env.F3_ADMIN_BASE_URL;
  return `${siteUrl.replace(/\/+$/, "")}/auth/sign-in?logged_out=true`;
}

async function getRefreshToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAMES.refreshToken)?.value;
}

export async function POST() {
  return handleLogoutRoute(getRefreshToken, {
    adapter: sso,
    cookieNames: COOKIE_NAMES,
    postLogoutRedirectUri: buildPostLogoutUri(),
  });
}

// GET is used by navigateToSsoLogout() (browser navigation) — redirect
// directly to the auth-server logout URL instead of returning JSON.
export async function GET() {
  const result = await handleLogoutRoute(getRefreshToken, {
    adapter: sso,
    cookieNames: COOKIE_NAMES,
    postLogoutRedirectUri: buildPostLogoutUri(),
  });
  const { redirectTo } = (await result.json()) as { redirectTo: string };
  const redirect = NextResponse.redirect(redirectTo, 302);
  for (const cookie of result.headers.getSetCookie()) {
    redirect.headers.append("set-cookie", cookie);
  }
  return redirect;
}
