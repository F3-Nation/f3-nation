import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken, getUserInfo } from "@/lib/auth/oauth";
import { signSession } from "@/lib/auth/session";
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE,
  OAUTH_CSRF_COOKIE,
  OAUTH_CODE_VERIFIER_COOKIE,
} from "@/lib/auth/constants";

const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const error = searchParams.get("error");

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;

  // Handle OAuth errors
  if (error) {
    return NextResponse.redirect(
      `${baseUrl}/?error=${encodeURIComponent(error)}`,
    );
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(`${baseUrl}/?error=missing_params`);
  }

  try {
    // Validate state / CSRF
    const stateJson = Buffer.from(stateParam, "base64url").toString();
    const state = JSON.parse(stateJson) as {
      csrf: string;
      returnTo: string;
      ts: number;
    };

    const csrfCookie = request.cookies.get(OAUTH_CSRF_COOKIE)?.value;
    if (!csrfCookie || csrfCookie !== state.csrf) {
      return NextResponse.redirect(`${baseUrl}/?error=csrf_mismatch`);
    }

    // Check state timestamp (10 min expiry)
    if (Date.now() - state.ts > STATE_MAX_AGE_MS) {
      return NextResponse.redirect(`${baseUrl}/?error=state_expired`);
    }

    // Exchange code for token
    const tokens = await exchangeCodeForToken(code);

    // Fetch user info
    const userInfo = await getUserInfo(tokens.accessToken);

    // Create session
    const sessionToken = await signSession({
      sub: userInfo.sub,
      email: userInfo.email,
      name: userInfo.name,
      iat: Math.floor(Date.now() / 1000),
    });

    const returnTo = state.returnTo || "/profile";
    const response = NextResponse.redirect(`${baseUrl}${returnTo}`);

    // Set session cookie
    response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE,
    });

    // Clear OAuth cookies
    response.cookies.delete(OAUTH_CSRF_COOKIE);
    response.cookies.delete(OAUTH_CODE_VERIFIER_COOKIE);

    return response;
  } catch (err) {
    console.error("Auth callback error:", err);
    return NextResponse.redirect(`${baseUrl}/?error=callback_failed`);
  }
}
