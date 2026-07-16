import { cookies } from "next/headers";
import { handleLogoutRoute } from "@f3nation/sso-next";

import {
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
  OAUTH_CSRF_COOKIE_NAME,
  OAUTH_CODE_VERIFIER_COOKIE_NAME,
} from "~/lib/auth/constants";
import { sso } from "~/lib/auth/oauth";

const COOKIE_NAMES = {
  accessToken: ACCESS_TOKEN_COOKIE_NAME,
  refreshToken: REFRESH_TOKEN_COOKIE_NAME,
  oauthCsrf: OAUTH_CSRF_COOKIE_NAME,
  oauthCodeVerifier: OAUTH_CODE_VERIFIER_COOKIE_NAME,
};

function buildPostLogoutUri(): string {
  const siteUrl = process.env.F3_ADMIN_BASE_URL ?? "http://localhost:3002";
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

export async function GET() {
  return handleLogoutRoute(getRefreshToken, {
    adapter: sso,
    cookieNames: COOKIE_NAMES,
    postLogoutRedirectUri: buildPostLogoutUri(),
  });
}
