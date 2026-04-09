import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomBytes, randomUUID, createHash } from "crypto";
import { getOAuthConfig } from "@/lib/auth/oauth";
import { safeReturnTo } from "@/lib/auth/validation";

export async function GET(request: NextRequest) {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));

  const csrfToken = randomUUID();
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  const { clientId, authServerUrl, redirectUri } = getOAuthConfig();

  const state = Buffer.from(
    JSON.stringify({
      csrfToken,
      clientId,
      returnTo,
      timestamp: Date.now(),
    }),
  ).toString("base64url");

  const authorizeUrl = new URL(`${authServerUrl}/api/oauth/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "openid profile email");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(authorizeUrl.toString(), 302);
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600, // 10 minutes
  };

  response.cookies.set("oauth_csrf", csrfToken, cookieOpts);
  response.cookies.set("oauth_code_verifier", codeVerifier, cookieOpts);

  return response;
}
