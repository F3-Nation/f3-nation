import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createOAuthLoginFlowArtifacts } from "@acme/sso";
import {
  OAUTH_CODE_VERIFIER_COOKIE_NAME,
  OAUTH_CSRF_COOKIE_NAME,
  OAUTH_FLOW_COOKIE_MAX_AGE,
} from "@/lib/auth/constants";
import { getAuthorizationUrl } from "@/lib/auth/oauth";
import { safeReturnTo } from "@/lib/auth/validation";

export async function GET(request: NextRequest) {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  const { csrfToken, codeVerifier, codeChallenge, state } =
    await createOAuthLoginFlowArtifacts({ returnTo });

  const authorizeUrl = getAuthorizationUrl({
    state,
    codeChallenge,
    codeChallengeMethod: "S256",
  });

  const response = NextResponse.redirect(authorizeUrl, 302);
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: OAUTH_FLOW_COOKIE_MAX_AGE,
  };

  response.cookies.set(OAUTH_CSRF_COOKIE_NAME, csrfToken, cookieOpts);
  response.cookies.set(
    OAUTH_CODE_VERIFIER_COOKIE_NAME,
    codeVerifier,
    cookieOpts,
  );

  return response;
}
