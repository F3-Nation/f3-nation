import type { NextRequest } from "next/server";
import { handleCallbackRoute } from "@f3nation/sso-next";

import {
  ACCESS_TOKEN_DEFAULT_MAX_AGE,
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
  OAUTH_CODE_VERIFIER_COOKIE_NAME,
  OAUTH_CSRF_COOKIE_NAME,
  REFRESH_TOKEN_MAX_AGE,
} from "~/lib/auth/constants";
import { env } from "~/env";
import { sso } from "~/lib/auth/oauth";

const COOKIE_NAMES = {
  accessToken: ACCESS_TOKEN_COOKIE_NAME,
  refreshToken: REFRESH_TOKEN_COOKIE_NAME,
  oauthCsrf: OAUTH_CSRF_COOKIE_NAME,
  oauthCodeVerifier: OAUTH_CODE_VERIFIER_COOKIE_NAME,
};

export async function GET(request: NextRequest) {
  return handleCallbackRoute(request, {
    adapter: sso,
    cookieNames: COOKIE_NAMES,
    publicOrigin: env.F3_ADMIN_BASE_URL,
    errorPath: "/auth/sign-in",
    errorReturnToParam: "callbackUrl",
    defaultReturnTo: "/",
    accessTokenMaxAge: ACCESS_TOKEN_DEFAULT_MAX_AGE,
    refreshTokenMaxAge: REFRESH_TOKEN_MAX_AGE,
  });
}
