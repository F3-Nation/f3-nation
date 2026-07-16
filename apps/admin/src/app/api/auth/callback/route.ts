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
import { sso } from "~/lib/auth/oauth";

const COOKIE_NAMES = {
  accessToken: ACCESS_TOKEN_COOKIE_NAME,
  refreshToken: REFRESH_TOKEN_COOKIE_NAME,
  oauthCsrf: OAUTH_CSRF_COOKIE_NAME,
  oauthCodeVerifier: OAUTH_CODE_VERIFIER_COOKIE_NAME,
};

function getPublicOrigin(): string {
  return (process.env.F3_ADMIN_BASE_URL ?? "http://localhost:3002").replace(
    /\/+$/,
    "",
  );
}

export async function GET(request: NextRequest) {
  return handleCallbackRoute(request, {
    adapter: sso,
    cookieNames: COOKIE_NAMES,
    publicOrigin: getPublicOrigin(),
    errorPath: "/auth/sign-in",
    errorReturnToParam: "callbackUrl",
    defaultReturnTo: "/",
    accessTokenMaxAge: ACCESS_TOKEN_DEFAULT_MAX_AGE,
    refreshTokenMaxAge: REFRESH_TOKEN_MAX_AGE,
  });
}
