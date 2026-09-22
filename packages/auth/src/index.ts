import { Auth, createActionURL } from "@auth/core";
import NextAuth from "next-auth";
import type { Session } from "next-auth";

import { authConfig } from "./config";
import { logWarn } from "./logger";

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
 * from env) as a side effect. `getSessionFromHeaders` is reachable only via
 * this module's default export path (`.`), and this module's body evaluates
 * top-to-bottom before any importer's code runs, so no caller can reach it
 * before `NextAuth(authConfig)` has. Do not re-export it from a subpath
 * entry (e.g. `./config`, `./lib/*`) without re-verifying this ordering.
 *
 * Read-only and non-rolling: any `Set-Cookie` headers Auth() would emit
 * (rolling JWT refresh, clearing an invalid session cookie) are not
 * propagated to the caller -- see the return statement below for why.
 */
export async function getSessionFromHeaders(
  headers: Headers,
): Promise<Session | null> {
  const trimmedProto =
    headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "";
  const proto = trimmedProto.length > 0 ? trimmedProto : "https";
  // createActionURL reads x-forwarded-proto directly off `headers` and
  // ignores the `proto` param whenever the header is present, so the
  // normalized value above must also be reflected back onto the headers
  // passed in -- otherwise a comma-separated or whitespace-only header
  // (e.g. from a proxy chain) reaches `new URL()` unnormalized and throws.
  const normalizedHeaders = new Headers(headers);
  normalizedHeaders.set("x-forwarded-proto", proto);
  const url = createActionURL(
    "session",
    proto,
    normalizedHeaders,
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
        // Unreachable with our current authConfig -- kept for parity in case
        // a future authConfig omits its own session callback or user field.
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

  if (!response.ok) {
    logWarn("auth.session.non_ok_response", { status: response.status });
    return null;
  }
  // Auth() may set Set-Cookie headers here (rolling JWT refresh, or clearing
  // an invalid session cookie) -- intentionally dropped. This function is
  // only used as an oRPC middleware authorization gate, which has no
  // Response object of its own to carry Set-Cookie back to the client.
  return (await response.json()) as Session | null;
}
