import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { exchangeAuthorizationCode, exchangeRefreshToken } from "~/lib/oauth";
import { getCorsHeaders, handlePreflight } from "~/lib/cors";
import { rateLimit } from "~/lib/rate-limit";

export async function OPTIONS(request: NextRequest) {
  const headers = await getCorsHeaders(request);
  return handlePreflight(headers);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const grantType = formData.get("grant_type") as string | null;
  const clientId = formData.get("client_id") as string | null;
  const clientSecret = formData.get("client_secret") as string | null;

  // Also support Basic auth
  let resolvedClientId = clientId;
  let resolvedClientSecret = clientSecret;

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
    const [id, secret] = decoded.split(":");
    if (id && secret) {
      resolvedClientId = resolvedClientId ?? id;
      resolvedClientSecret = resolvedClientSecret ?? secret;
    }
  }

  if (!resolvedClientId) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Missing client_id" },
      { status: 400 },
    );
  }

  // Rate limit per client
  const { allowed } = rateLimit(`token:${resolvedClientId}`, 60, 60 * 1000);
  if (!allowed) {
    return NextResponse.json({ error: "rate_limit_exceeded" }, { status: 429 });
  }

  const corsHeaders = await getCorsHeaders(request, resolvedClientId);

  if (grantType === "authorization_code") {
    const code = formData.get("code") as string | null;
    const redirectUri = formData.get("redirect_uri") as string | null;
    const codeVerifier = formData.get("code_verifier") as string | null;

    if (!code || !redirectUri || !resolvedClientSecret) {
      return NextResponse.json(
        { error: "invalid_request" },
        { status: 400, headers: corsHeaders },
      );
    }

    const result = await exchangeAuthorizationCode({
      code,
      clientId: resolvedClientId,
      clientSecret: resolvedClientSecret,
      redirectUri,
      codeVerifier: codeVerifier ?? undefined,
    });

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error },
        { status: 400, headers: corsHeaders },
      );
    }

    return NextResponse.json(result, { headers: corsHeaders });
  }

  if (grantType === "refresh_token") {
    const refreshToken = formData.get("refresh_token") as string | null;

    if (!refreshToken || !resolvedClientSecret) {
      return NextResponse.json(
        { error: "invalid_request" },
        { status: 400, headers: corsHeaders },
      );
    }

    const result = await exchangeRefreshToken({
      refreshToken,
      clientId: resolvedClientId,
      clientSecret: resolvedClientSecret,
    });

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error },
        { status: 400, headers: corsHeaders },
      );
    }

    return NextResponse.json(result, { headers: corsHeaders });
  }

  return NextResponse.json(
    { error: "unsupported_grant_type" },
    { status: 400, headers: corsHeaders },
  );
}
