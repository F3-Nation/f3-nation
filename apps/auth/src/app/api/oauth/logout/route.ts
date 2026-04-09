import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";

import { eq } from "@acme/db";
import { oauthClients } from "@acme/db/schema/schema";

import { auth } from "~/lib/auth";
import { db } from "~/lib/db";
import { revokeAllUserTokens } from "~/lib/oauth";
import { env } from "~/env";

/**
 * Collect every origin that appears in the redirect_uris of active
 * OAuth clients.  These are the origins we allow for
 * post_logout_redirect_uri so that cross-origin SSO clients (e.g.
 * me.f3nation.com → auth.f3nation.com) can be redirected back after
 * logout without being blocked by a same-origin check.
 */
async function getAllowedOrigins(): Promise<Set<string>> {
  const clients = await db
    .select({ redirectUris: oauthClients.redirectUris })
    .from(oauthClients)
    .where(eq(oauthClients.isActive, true));

  const origins = new Set<string>();
  for (const c of clients) {
    try {
      const uris: unknown = JSON.parse(c.redirectUris);
      if (!Array.isArray(uris)) continue;
      for (const u of uris) {
        if (typeof u === "string") {
          try {
            origins.add(new URL(u).origin);
          } catch {
            // skip malformed URIs
          }
        }
      }
    } catch {
      // skip unparseable JSON
    }
  }
  return origins;
}

/**
 * SSO logout endpoint.
 * Clears the auth session and redirects back to the client.
 *
 * GET /api/oauth/logout?post_logout_redirect_uri=http://localhost:3003
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const postLogoutRedirectUri = searchParams.get("post_logout_redirect_uri");

  const publicUrl = env.NEXT_PUBLIC_AUTH_URL;

  // Validate the redirect target against registered client origins.
  const allowedOrigins = await getAllowedOrigins();
  const requestOrigin = new URL(publicUrl).origin;
  allowedOrigins.add(requestOrigin); // always allow same-origin

  let redirectUrl: URL;
  try {
    const candidate = new URL(postLogoutRedirectUri ?? "/login", publicUrl);
    redirectUrl = allowedOrigins.has(candidate.origin)
      ? candidate
      : new URL("/login", publicUrl);
  } catch {
    redirectUrl = new URL("/login", publicUrl);
  }

  // Revoke tokens if user is authenticated
  const session = await auth();
  if (session?.user?.id) {
    const userId = Number(session.user.id);
    if (userId) {
      await revokeAllUserTokens(userId);
    }
  }

  // Clear the NextAuth session cookie
  const cookieStore = await cookies();
  for (const cookie of cookieStore.getAll()) {
    if (
      cookie.name.startsWith("next-auth") ||
      cookie.name.startsWith("__Secure-next-auth") ||
      cookie.name.startsWith("authjs")
    ) {
      cookieStore.delete(cookie.name);
    }
  }

  return NextResponse.redirect(redirectUrl);
}
