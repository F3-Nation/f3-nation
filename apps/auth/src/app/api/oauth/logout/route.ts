import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies, headers } from "next/headers";

import { eq } from "@acme/db";
import { oauthClients } from "@acme/db/schema/schema";

import { getAuth } from "~/lib/better-auth";
import { getCurrentSession } from "~/lib/current-session";
import { db } from "~/lib/db";
import { logError } from "~/lib/logging";
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
  const session = await getCurrentSession();
  if (session?.user?.id) {
    const userId = Number(session.user.id);
    if (userId) {
      await revokeAllUserTokens(userId);
    }
  }

  const response = NextResponse.redirect(redirectUrl);

  // Revoke the Better Auth session row server-side and forward Better
  // Auth's own cookie-clearing Set-Cookie headers — they carry the correct
  // Secure/Path attributes for its cookie name, which the manual
  // prefix-matching loop below can't guarantee (see that loop's comment).
  // Without this, the session row survives and the next
  // /api/oauth/authorize silently re-authenticates the user.
  if (env.AUTH_USE_BETTER_AUTH) {
    try {
      const betterAuth = await getAuth();
      const signOutResponse = await betterAuth.api.signOut({
        headers: await headers(),
        asResponse: true,
      });
      for (const setCookie of signOutResponse.headers.getSetCookie()) {
        response.headers.append("set-cookie", setCookie);
      }
    } catch (err) {
      logError("auth.oauth_logout.better_auth_signout_failed", {}, err);
    }
  }

  // Clear every auth cookie from either backend, regardless of which one
  // AUTH_USE_BETTER_AUTH currently selects — a cookie left over from
  // switching the flag should never survive a logout. `secure: true` is
  // required for every "__Secure-"-prefixed name: browsers only accept a
  // change to a "__Secure-" cookie when the Secure attribute is present,
  // and cookieStore.delete(name) alone doesn't set it.
  const cookieStore = await cookies();
  for (const cookie of cookieStore.getAll()) {
    const isAuthCookie =
      cookie.name.startsWith("next-auth") ||
      cookie.name.startsWith("__Secure-next-auth") ||
      cookie.name.startsWith("authjs") ||
      cookie.name.startsWith("__Secure-authjs") ||
      cookie.name.startsWith("better-auth") ||
      cookie.name.startsWith("__Secure-better-auth");
    if (isAuthCookie) {
      cookieStore.delete({
        name: cookie.name,
        path: "/",
        secure: cookie.name.startsWith("__Secure-"),
      });
    }
  }

  return response;
}
