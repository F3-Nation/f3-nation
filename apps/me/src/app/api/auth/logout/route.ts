import { cookies } from "next/headers";
import { handleLogoutRoute } from "@f3nation/sso-next";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
  OAUTH_CSRF_COOKIE_NAME,
  OAUTH_CODE_VERIFIER_COOKIE_NAME,
} from "@/lib/auth/constants";
import { sso } from "@/lib/auth/oauth";

const COOKIE_NAMES = {
  accessToken: ACCESS_TOKEN_COOKIE_NAME,
  refreshToken: REFRESH_TOKEN_COOKIE_NAME,
  oauthCsrf: OAUTH_CSRF_COOKIE_NAME,
  oauthCodeVerifier: OAUTH_CODE_VERIFIER_COOKIE_NAME,
};

function buildPostLogoutUri(): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3003";
  return `${siteUrl.replace(/\/+$/, "")}?logged_out=true`;
}

export async function POST() {
  return handleLogoutRoute(
    async () => {
      const cookieStore = await cookies();
      return cookieStore.get(COOKIE_NAMES.refreshToken)?.value;
    },
    {
      adapter: sso,
      cookieNames: COOKIE_NAMES,
      postLogoutRedirectUri: buildPostLogoutUri(),
    },
  );
}
