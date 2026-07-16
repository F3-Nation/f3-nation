import type { NextRequest } from "next/server";
import { handleLoginRoute } from "@f3nation/sso-next";
import {
  OAUTH_CODE_VERIFIER_COOKIE_NAME,
  OAUTH_CSRF_COOKIE_NAME,
  OAUTH_FLOW_COOKIE_MAX_AGE,
} from "@/lib/auth/constants";
import { sso } from "@/lib/auth/oauth";

export async function GET(request: NextRequest) {
  return handleLoginRoute(request, {
    adapter: sso,
    cookieNames: {
      oauthCsrf: OAUTH_CSRF_COOKIE_NAME,
      oauthCodeVerifier: OAUTH_CODE_VERIFIER_COOKIE_NAME,
    },
    flowCookieMaxAge: OAUTH_FLOW_COOKIE_MAX_AGE,
    defaultReturnTo: "/profile",
  });
}
