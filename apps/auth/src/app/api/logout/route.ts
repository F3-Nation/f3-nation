import { NextResponse } from "next/server";

import { getCurrentSession } from "~/lib/current-session";
import { logError } from "~/lib/logging";
import { revokeUserOAuthTokens } from "~/lib/revoke-user-oauth-tokens";

export async function POST() {
  const session = await getCurrentSession();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { betterAuthError } = await revokeUserOAuthTokens(session.user.id);
  if (betterAuthError) {
    // The sign-out button shows an error and keeps the session, so the user
    // can retry instead of believing offline_access tokens were revoked.
    logError(
      "auth.logout.better_auth_token_deletion_failed",
      {},
      betterAuthError,
    );
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  return NextResponse.json({ loggedOut: true });
}
