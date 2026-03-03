import { NextRequest, NextResponse } from "next/server";
import { getOAuthConfig } from "@/lib/auth/oauth";
import {
  OAUTH_CSRF_COOKIE,
  OAUTH_CODE_VERIFIER_COOKIE,
} from "@/lib/auth/constants";

function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(plain: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const returnTo = searchParams.get("returnTo") ?? "/profile";

  const { CLIENT_ID, AUTH_SERVER_URL, REDIRECT_URI } = getOAuthConfig();

  // Generate CSRF state (includes returnTo and timestamp)
  const csrfToken = generateRandomString(32);
  const state = JSON.stringify({
    csrf: csrfToken,
    returnTo,
    ts: Date.now(),
  });
  const stateB64 = Buffer.from(state).toString("base64url");

  // Generate PKCE code verifier and challenge
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await sha256(codeVerifier);

  // Build authorize URL
  const authorizeUrl = new URL(`${AUTH_SERVER_URL}/api/oauth/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authorizeUrl.searchParams.set("state", stateB64);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("scope", "openid email profile");

  const response = NextResponse.redirect(authorizeUrl.toString());

  // Set cookies for callback validation
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600, // 10 minutes
  };

  response.cookies.set(OAUTH_CSRF_COOKIE, csrfToken, cookieOptions);
  response.cookies.set(OAUTH_CODE_VERIFIER_COOKIE, codeVerifier, cookieOptions);

  return response;
}
