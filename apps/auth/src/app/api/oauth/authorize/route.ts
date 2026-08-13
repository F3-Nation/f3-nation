import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { eq } from "@acme/db";
import { users } from "@acme/db/schema/schema";

import { auth } from "~/lib/auth";
import { db } from "~/lib/db";
import {
  createAuthorizationCode,
  getClient,
  validateRedirectUri,
  validateScopes,
} from "~/lib/oauth";
import { rateLimit } from "~/lib/rate-limit";
import { env } from "~/env";

export async function GET(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ??
    "unknown";
  const { allowed } = rateLimit(`authorize:${ip}`, 30, 60 * 1000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const publicUrl = env.NEXT_PUBLIC_AUTH_URL;
  const reqUrl = new URL(request.url);
  const { searchParams } = reqUrl;
  const responseType = searchParams.get("response_type");
  const clientId = searchParams.get("client_id");
  const redirectUri = searchParams.get("redirect_uri");
  const scope = searchParams.get("scope") ?? "openid profile email";
  const state = searchParams.get("state");
  const nonce = searchParams.get("nonce");
  const codeChallenge = searchParams.get("code_challenge");
  const codeChallengeMethod =
    searchParams.get("code_challenge_method") ?? "plain";

  // Require PKCE for all authorization requests.
  // Only S256 is accepted — plain transfers the verifier in the clear and
  // provides no meaningful protection (RFC 7636 §4.2 / OAuth 2.1 §4.1.1).
  if (!codeChallenge) {
    return NextResponse.json(
      {
        error: "invalid_request",
        error_description: "code_challenge is required",
      },
      { status: 400 },
    );
  }
  if (codeChallengeMethod !== "S256") {
    return NextResponse.json(
      {
        error: "invalid_request",
        error_description:
          "Unsupported code_challenge_method — only S256 is accepted",
      },
      { status: 400 },
    );
  }

  // Validate required params
  if (responseType !== "code") {
    return NextResponse.json(
      { error: "unsupported_response_type" },
      { status: 400 },
    );
  }

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      {
        error: "invalid_request",
        error_description: "Missing client_id or redirect_uri",
      },
      { status: 400 },
    );
  }

  // Validate client
  const client = await getClient(clientId);
  if (!client) {
    return NextResponse.json({ error: "invalid_client" }, { status: 400 });
  }

  if (!validateRedirectUri(client, redirectUri)) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Invalid redirect_uri" },
      { status: 400 },
    );
  }

  if (!validateScopes(client, scope)) {
    return NextResponse.json({ error: "invalid_scope" }, { status: 400 });
  }

  // Check if user is authenticated
  const session = await auth();
  if (!session?.user?.id) {
    // Redirect to login with callback to this authorize URL
    const callbackUrl = `${publicUrl}${reqUrl.pathname}${reqUrl.search}`;
    const loginUrl = new URL("/login/email", publicUrl);
    loginUrl.searchParams.set("callbackUrl", callbackUrl);
    return NextResponse.redirect(loginUrl);
  }

  const userId = Number(session.user.id);

  // Check onboarding status
  const [dbUser] = await db
    .select({ meta: users.meta })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // User not found in DB — session is stale (e.g. after a DB wipe). Force re-login.
  if (!dbUser) {
    const callbackUrl = `${publicUrl}${reqUrl.pathname}${reqUrl.search}`;
    const loginUrl = new URL("/login/email", publicUrl);
    loginUrl.searchParams.set("callbackUrl", callbackUrl);
    return NextResponse.redirect(loginUrl);
  }

  const meta = (dbUser.meta ?? {}) as Record<string, unknown>;
  if (!meta.onboarding_completed) {
    const callbackUrl = `${publicUrl}${reqUrl.pathname}${reqUrl.search}`;
    const onboardingUrl = new URL("/onboarding", publicUrl);
    onboardingUrl.searchParams.set("callbackUrl", callbackUrl);
    return NextResponse.redirect(onboardingUrl);
  }

  // Generate authorization code
  const code = await createAuthorizationCode({
    clientId,
    userId: userId,
    redirectUri,
    scopes: scope,
    codeChallenge: codeChallenge ?? undefined,
    codeChallengeMethod: codeChallenge ? codeChallengeMethod : undefined,
    nonce: nonce ?? undefined,
    authTime: session.authTime,
  });

  // Redirect back to client
  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  if (state) redirect.searchParams.set("state", state);

  return NextResponse.redirect(redirect);
}
