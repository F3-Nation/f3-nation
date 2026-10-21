import { NextResponse } from "next/server";

import { oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";

import { getAuth } from "~/lib/better-auth";
import { env } from "~/env";

export async function GET(request: Request) {
  const issuer = env.NEXT_PUBLIC_AUTH_URL;

  if (env.AUTH_USE_BETTER_AUTH) return betterAuthMetadata(request, issuer);

  return NextResponse.json({
    issuer,
    authorization_endpoint: `${issuer}/api/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    userinfo_endpoint: `${issuer}/api/oauth/userinfo`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "profile", "email"],
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
    ],
    claims_supported: ["sub", "name", "email", "email_verified", "picture"],
    code_challenge_methods_supported: ["S256"],
  });
}

/**
 * Better Auth's own metadata, which advertises its native
 * /api/auth2/oauth2/* endpoints: clients that read discovery go straight
 * there, and only callers that hardcode /api/oauth/* use the adapters. That
 * bypasses the adapters' per-IP rate limits and 500 backstop (an accepted
 * trade-off; Better Auth's own limiter and hooks still apply). Three fields
 * are replaced:
 *   - token_endpoint: the token adapter, because only it sends the CORS
 *     headers browser-based clients need (Better Auth sends none).
 *   - jwks_uri: Better Auth's would be /api/auth2/jwks, but relying parties
 *     fetch the origin-root document, which also serves the hand-rolled key.
 *   - end_session_endpoint: Better Auth's /oauth2/end-session only signs out
 *     for an id_token_hint from a client with enableEndSession (no migrated
 *     client has it), and otherwise stops at a confirmation step.
 *     /api/oauth/logout signs the user out and revokes their Better Auth
 *     OAuth tokens.
 */
async function betterAuthMetadata(request: Request, issuer: string) {
  const auth = await getAuth();
  const response = await oauthProviderOpenIdConfigMetadata(auth)(request);
  const metadata = (await response.json()) as Record<string, unknown>;
  return NextResponse.json(
    {
      ...metadata,
      token_endpoint: `${issuer}/api/oauth/token`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      end_session_endpoint: `${issuer}/api/oauth/logout`,
    },
    // The plugin's own caching headers.
    { headers: response.headers },
  );
}
