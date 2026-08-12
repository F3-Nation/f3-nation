import type { NextRequest } from "next/server";
import { handleLoginRoute, SSO_COOKIE_NAMES } from "@f3nation/sso-next";
import { OAUTH_FLOW_COOKIE_MAX_AGE } from "@/lib/auth/constants";
import { sso } from "@/lib/auth/oauth";

export async function GET(request: NextRequest) {
  return handleLoginRoute(request, {
    adapter: sso,
    cookieNames: SSO_COOKIE_NAMES,
    flowCookieMaxAge: OAUTH_FLOW_COOKIE_MAX_AGE,
    defaultReturnTo: "/profile",
  });
}
