import { Auth, createActionURL } from "@auth/core";
import NextAuth from "next-auth";
import type { Session } from "next-auth";

import { authConfig } from "./config";

export type { Session } from "next-auth";
export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

/**
 * Framework-agnostic cookie-session resolution for callers outside a Next.js
 * request scope (e.g. apps/api, which cannot use the no-arg `auth()` once it
 * leaves Next). Ports next-auth's own private `getSession`/`parseSessionResponse`
 * (headers() -> synthetic Request -> `Auth()` against this same authConfig) so
 * the resolved session is guaranteed identical in shape to `auth()`'s — pinned
 * by apps/api/characterization/auth/session-parity.char.test.ts.
 *
 * Must be defined after `NextAuth(authConfig)` above: that call runs
 * `setEnvDefaults` on `authConfig` (fills in `secret`/`basePath`/`trustHost`
 * from env) as a side effect, and this package's only export surface is this
 * module, so no caller can reach `getSessionFromHeaders` before that has run.
 */
export async function getSessionFromHeaders(
  headers: Headers,
): Promise<Session | null> {
  const url = createActionURL(
    "session",
    headers.get("x-forwarded-proto") ?? "https",
    headers,
    process.env,
    authConfig,
  );
  const request = new Request(url, {
    headers: { cookie: headers.get("cookie") ?? "" },
  });

  const response = await Auth(request, {
    ...authConfig,
    callbacks: {
      ...authConfig.callbacks,
      async session(...args) {
        const session = (await authConfig.callbacks?.session?.(...args)) ?? {
          ...args[0].session,
          expires:
            args[0].session.expires?.toISOString?.() ?? args[0].session.expires,
        };
        const user = args[0].user ?? args[0].token;
        return { user, ...session };
      },
    },
  });

  if (!response.ok) return null;
  const session = (await response.json()) as Session | Record<string, never>;
  return session && Object.keys(session).length > 0
    ? (session as Session)
    : null;
}
