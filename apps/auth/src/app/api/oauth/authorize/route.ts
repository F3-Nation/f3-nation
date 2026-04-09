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

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const { allowed } = rateLimit(`authorize:${ip}`, 30, 60 * 1000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const responseType = searchParams.get("response_type");
  const clientId = searchParams.get("client_id");
  const redirectUri = searchParams.get("redirect_uri");
  const scope = searchParams.get("scope") ?? "openid profile email";
  const state = searchParams.get("state");
  const codeChallenge = searchParams.get("code_challenge");
  const codeChallengeMethod =
    searchParams.get("code_challenge_method") ?? "plain";

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
    const callbackUrl = request.url;
    const loginUrl = new URL("/login/email", request.url);
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

  const meta = (dbUser?.meta ?? {}) as Record<string, unknown>;
  if (!meta.onboarding_completed) {
    const callbackUrl = request.url;
    const onboardingUrl = new URL("/onboarding", request.url);
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
  });

  // Redirect back to client
  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  if (state) redirect.searchParams.set("state", state);

  return NextResponse.redirect(redirect);
}
