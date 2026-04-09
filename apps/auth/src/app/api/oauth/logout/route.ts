import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";

import { auth } from "~/lib/auth";
import { revokeAllUserTokens } from "~/lib/oauth";

/**
 * SSO logout endpoint.
 * Clears the auth session and redirects back to the client.
 *
 * GET /api/oauth/logout?post_logout_redirect_uri=http://localhost:3003
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const postLogoutRedirectUri =
    searchParams.get("post_logout_redirect_uri") ?? "/login";

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

  return NextResponse.redirect(postLogoutRedirectUri);
}
