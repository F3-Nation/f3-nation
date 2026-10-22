import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { forwardToBetterAuth } from "~/lib/better-auth-oauth";
import { exchangeAuthorizationCode, exchangeRefreshToken } from "~/lib/oauth";
import { getCorsHeaders, handlePreflight } from "~/lib/cors";
import { logError } from "~/lib/logging";
import { rateLimit } from "~/lib/rate-limit";
import { env } from "~/env";

export async function OPTIONS(request: NextRequest) {
  const headers = await getCorsHeaders(request);
  return handlePreflight(headers);
}

/**
 * The flag-on path: the same per-client rate limit and CORS handling as the
 * hand-rolled route below, around Better Auth's /oauth2/token (which sends
 * no CORS headers of its own).
 */
async function postToBetterAuth(request: NextRequest) {
  const form = new URLSearchParams(await request.text());
  const grantType = form.get("grant_type");

  // Credentials sent only in a Basic header are merged into the body, as the
  // hand-rolled route does, and the header is dropped so Better Auth sees one
  // authentication method for the client the limits and CORS are keyed on.
  // A Basic header with an empty secret is kept for Better Auth to reject,
  // but its client id still keys the limits and CORS below.
  let dropAuthorization = false;
  let basicClientId: string | null = null;
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
    const separator = decoded.indexOf(":");
    const id = decoded.slice(0, separator);
    const secret = decoded.slice(separator + 1);
    if (separator > 0) basicClientId = id;
    if (separator > 0 && secret) {
      if (!form.has("client_id")) form.set("client_id", id);
      if (!form.has("client_secret")) form.set("client_secret", secret);
      dropAuthorization = true;
    }
  }
  const body = form.toString();
  const clientId = form.get("client_id") ?? basicClientId;

  // Better Auth rejects a request with no client_id itself.
  if (clientId) {
    const { allowed } = rateLimit(`token:${clientId}`, 60, 60 * 1000);
    if (!allowed) {
      return NextResponse.json(
        { error: "rate_limit_exceeded" },
        { status: 429 },
      );
    }
  }

  const corsHeaders = clientId ? await getCorsHeaders(request, clientId) : {};

  try {
    const response = await forwardToBetterAuth(request, "token", {
      body,
      dropCookies: true,
      dropAuthorization,
    });
    const withCors = new Response(response.body, response);
    for (const [name, value] of Object.entries(corsHeaders)) {
      withCors.headers.set(name, value);
    }
    return withCors;
  } catch (err) {
    // Same backstop as the hand-rolled path below.
    logError("auth.oauth.token_endpoint_error", { grantType, clientId }, err);
    return NextResponse.json(
      { error: "server_error" },
      { status: 500, headers: corsHeaders },
    );
  }
}

export async function POST(request: NextRequest) {
  if (env.AUTH_USE_BETTER_AUTH) return postToBetterAuth(request);

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

  try {
    if (grantType === "authorization_code") {
      const code = formData.get("code") as string | null;
      const redirectUri = formData.get("redirect_uri") as string | null;
      const codeVerifier = formData.get("code_verifier") as string | null;

      // client_secret is intentionally not required here: public clients
      // (is_public = true) authenticate with PKCE alone. Whether a secret is
      // required for this client is decided in exchangeAuthorizationCode.
      if (!code || !redirectUri) {
        return NextResponse.json(
          { error: "invalid_request" },
          { status: 400, headers: corsHeaders },
        );
      }

      const result = await exchangeAuthorizationCode({
        code,
        clientId: resolvedClientId,
        clientSecret: resolvedClientSecret ?? undefined,
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

      if (!refreshToken) {
        return NextResponse.json(
          { error: "invalid_request" },
          { status: 400, headers: corsHeaders },
        );
      }

      const result = await exchangeRefreshToken({
        refreshToken,
        clientId: resolvedClientId,
        clientSecret: resolvedClientSecret ?? undefined,
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
  } catch (err) {
    // Nothing above should throw in normal operation (both exchange
    // functions return `{ error }` for expected rejections) — this is a
    // backstop so a DB blip or signing failure returns an OAuth-shaped
    // error with CORS headers instead of a bare framework 500 that native
    // clients can't parse and that strips the origin the client needs.
    logError(
      "auth.oauth.token_endpoint_error",
      { grantType, clientId: resolvedClientId },
      err,
    );
    return NextResponse.json(
      { error: "server_error" },
      { status: 500, headers: corsHeaders },
    );
  }
}
