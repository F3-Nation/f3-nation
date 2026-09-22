import type { NextRequest } from "next/server";
import { handleCallbackRoute, SSO_COOKIE_NAMES } from "@f3nation/sso-next";

import {
  ACCESS_TOKEN_DEFAULT_MAX_AGE,
  REFRESH_TOKEN_MAX_AGE,
} from "~/lib/auth/constants";
import { env } from "~/env";
import { sso } from "~/lib/auth/oauth";

export async function GET(request: NextRequest) {
  return handleCallbackRoute(request, {
    adapter: sso,
    cookieNames: SSO_COOKIE_NAMES,
    publicOrigin: env.F3_ADMIN_BASE_URL,
    errorPath: "/auth/sign-in",
    errorReturnToParam: "callbackUrl",
    defaultReturnTo: "/",
    accessTokenMaxAge: ACCESS_TOKEN_DEFAULT_MAX_AGE,
    refreshTokenMaxAge: REFRESH_TOKEN_MAX_AGE,
  });
}
