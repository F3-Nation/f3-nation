import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomBytes, randomUUID, createHash } from "crypto";
import { getAuthorizationUrl } from "@/lib/auth/oauth";
import { safeReturnTo } from "@/lib/auth/validation";

export async function GET(request: NextRequest) {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));

  const csrfToken = randomUUID();
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  const state = Buffer.from(
    JSON.stringify({
      csrfToken,
      returnTo,
      timestamp: Date.now(),
    }),
  ).toString("base64url");

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
    maxAge: 600, // 10 minutes
  };

  response.cookies.set("oauth_csrf", csrfToken, cookieOpts);
  response.cookies.set("oauth_code_verifier", codeVerifier, cookieOpts);

  return response;
}
