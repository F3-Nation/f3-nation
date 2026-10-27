import type { NextRequest } from "next/server";

import { redirectToPageWithAuthorizeCallback } from "~/lib/better-auth-oauth";

/**
 * Better Auth's oauthProvider `signup.page` (see lib/better-auth.ts), where
 * the onboarding gate sends a signed-in user whose `users.meta` has no
 * onboarding_completed. Sends them to /onboarding with the authorization
 * request as its callbackUrl, the same hand-off the hand-rolled authorize
 * route makes.
 */
export function GET(request: NextRequest) {
  return redirectToPageWithAuthorizeCallback(request, "/onboarding");
}
