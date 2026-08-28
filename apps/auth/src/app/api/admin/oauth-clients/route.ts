/**
 * Admin CRUD surface for OAuth client registrations (#876 Phase 3 admin
 * UI) — the "similar to Logto's Applications screen" ask. Gated by
 * requireSuperAdminApiKey, called server-to-server from apps/admin's own
 * oRPC backend (packages/api/src/router/oauth-client.ts), never directly
 * from a browser.
 *
 * List reads better_auth_oauth_client directly rather than going through
 * Better Auth's own API: getOAuthClients is session-scoped (only returns
 * clients the calling *user* registered via dynamic client registration),
 * with no admin-wide "list every client" equivalent — confirmed against
 * @better-auth/oauth-provider's installed type definitions, not assumed.
 * Create goes through the real adminCreateOAuthClient API instead of a raw
 * insert, so secret generation and hashing (via the storeClientSecret hooks
 * configured in apps/auth/src/lib/better-auth.ts) happen exactly the way a
 * real dynamic registration would, not reimplemented by hand here.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { betterAuthOauthClient } from "@acme/db/schema/schema";

import { db } from "~/lib/db";
import { getAuth } from "~/lib/better-auth";
import { logError } from "~/lib/logging";
import { requireSuperAdminApiKey } from "~/lib/require-super-admin";

export async function GET(request: NextRequest) {
  const unauthorized = requireSuperAdminApiKey(request);
  if (unauthorized) return unauthorized;

  const clients = await db
    .select({
      clientId: betterAuthOauthClient.clientId,
      name: betterAuthOauthClient.name,
      redirectUris: betterAuthOauthClient.redirectUris,
      scopes: betterAuthOauthClient.scopes,
      tokenEndpointAuthMethod: betterAuthOauthClient.tokenEndpointAuthMethod,
      applicationType: betterAuthOauthClient.applicationType,
      disabled: betterAuthOauthClient.disabled,
      createdAt: betterAuthOauthClient.createdAt,
      updatedAt: betterAuthOauthClient.updatedAt,
    })
    .from(betterAuthOauthClient);

  // clientSecret is never returned here, list or otherwise — only the
  // create response below carries it, once, the same way apps/auth's own
  // add-client.ts script only ever prints a generated secret at creation.
  return NextResponse.json({
    clients: clients.map((c) => ({
      ...c,
      isPublic: c.tokenEndpointAuthMethod === "none",
    })),
  });
}

interface CreateOAuthClientBody {
  name: string;
  redirectUris: string[];
  scope: string;
  isPublic: boolean;
}

export async function POST(request: NextRequest) {
  const unauthorized = requireSuperAdminApiKey(request);
  if (unauthorized) return unauthorized;

  const body = (await request.json()) as CreateOAuthClientBody;

  if (!body.name?.trim()) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "name is required" },
      { status: 400 },
    );
  }
  if (!Array.isArray(body.redirectUris) || body.redirectUris.length === 0) {
    return NextResponse.json(
      {
        error: "invalid_request",
        error_description: "at least one redirect URI is required",
      },
      { status: 400 },
    );
  }

  try {
    const auth = await getAuth();
    const client = await auth.api.adminCreateOAuthClient({
      body: {
        client_name: body.name.trim(),
        redirect_uris: body.redirectUris,
        scope: body.scope || "openid profile email",
        application_type: body.isPublic ? "native" : "web",
        token_endpoint_auth_method: body.isPublic
          ? "none"
          : "client_secret_basic",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        // requirePKCE isn't part of adminCreateOAuthClient's own schema —
        // oauth-provider defaults it to true per client already (and always
        // enforces it for public clients regardless), matching this app's
        // "PKCE required for everyone" policy with nothing extra to set.
      },
    });

    return NextResponse.json({ client }, { status: 201 });
  } catch (err) {
    logError("auth.admin.oauth_client_create_failed", { name: body.name }, err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
