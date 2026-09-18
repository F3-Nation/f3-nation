import { headers } from "next/headers";

import { auth } from "~/lib/auth";
import { getAuth } from "~/lib/better-auth";
import { env } from "~/env";

export interface CurrentSession {
  user: {
    id: string;
    email: string | null;
    name: string | null;
  };
  /**
   * ISO timestamp of when this session was first established — the source
   * for the OIDC `auth_time` claim (see createAuthorizationCode in
   * apps/auth/src/lib/oauth.ts). NextAuth sets this once in its JWT
   * callback and never touches it again on later session-check calls;
   * Better Auth's own session row's createdAt is the equivalent value.
   */
  authTime?: string;
}

/**
 * Reads the active session from whichever backend AUTH_USE_BETTER_AUTH
 * currently selects, instead of NextAuth's auth() alone. Without this, a
 * user who signed in through Better Auth (apps/auth/src/app/login/email,
 * .../verify, apps/auth/src/app/register, when the flag is on) is
 * recognized on none of the endpoints that only ever checked auth() —
 * the homepage and every route below would treat them as signed out and
 * loop them back to login, even though sign-in itself succeeded.
 *
 * Every call site in this app that reads the current user's session
 * should go through this instead of importing auth() directly:
 * apps/auth/src/app/page.tsx, api/session, api/oauth/authorize,
 * api/oauth/logout, api/onboarding, api/logout.
 */
export async function getCurrentSession(): Promise<CurrentSession | null> {
  if (env.AUTH_USE_BETTER_AUTH) {
    const betterAuth = await getAuth();
    const result = await betterAuth.api.getSession({
      headers: await headers(),
    });
    if (!result?.user) return null;
    return {
      user: {
        id: result.user.id,
        email: result.user.email ?? null,
        name: result.user.name ?? null,
      },
      authTime: result.session.createdAt.toISOString(),
    };
  }

  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    user: {
      id: session.user.id,
      email: session.user.email ?? null,
      name: session.user.name ?? null,
    },
    authTime: session.authTime,
  };
}
