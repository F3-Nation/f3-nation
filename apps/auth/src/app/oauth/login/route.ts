import type { NextRequest } from "next/server";

import { redirectToPageWithAuthorizeCallback } from "~/lib/better-auth-oauth";

/**
 * Better Auth's oauthProvider `loginPage` (see lib/better-auth.ts). Sends
 * the user to the email login page with the authorization request as its
 * callbackUrl, the same hand-off the hand-rolled authorize route makes.
 */
export function GET(request: NextRequest) {
  return redirectToPageWithAuthorizeCallback(request, "/login/email");
}
