import { deleteBetterAuthOAuthTokens, getAuth } from "~/lib/better-auth";
import { revokeAllUserTokens } from "~/lib/oauth";
import { env } from "~/env";

/**
 * Ends every OAuth token the user holds, for the two logout routes
 * (/api/oauth/logout and /api/logout).
 *
 * The hand-rolled tokens are revoked first and a failure throws, as it
 * always has. With AUTH_USE_BETTER_AUTH on, Better Auth's OAuth tokens are
 * deleted as well, because deleting its session spares offline_access
 * refresh tokens. That failure is returned, not thrown, so a caller that
 * still has to sign the browser out can finish doing so before reporting it.
 */
export async function revokeUserOAuthTokens(
  userId: string,
): Promise<{ betterAuthError?: unknown }> {
  const f3UserId = Number(userId);
  if (f3UserId) {
    await revokeAllUserTokens(f3UserId);
  }
  if (!env.AUTH_USE_BETTER_AUTH) return {};

  try {
    await deleteBetterAuthOAuthTokens(await getAuth(), userId);
    return {};
  } catch (betterAuthError) {
    return { betterAuthError };
  }
}
