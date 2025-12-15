import type { NextAuthConfig } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import type { Provider } from "next-auth/providers";
import { eq } from "drizzle-orm";
import CredentialsProvider from "next-auth/providers/credentials";

import type { UserRole } from "@acme/shared/app/enums";
import { db } from "@acme/db/client";
import { orgs } from "@acme/db/schema/schema";
import { env } from "@acme/env";
import { COOKIE_NAME } from "@acme/shared/common/constants";
import { ProviderId } from "@acme/shared/common/enums";

import { emailProvider } from "./lib/email-provider";
import { MDPGDrizzleAdapter } from "./lib/md-pg-drizzzle-adapter";
import OtpProvider from "./lib/otp-provider";

export type { Session } from "next-auth";

const isProd = env.NEXT_PUBLIC_CHANNEL === "prod";

// Cookie configuration for cross-subdomain auth (map.f3nation.com <-> api.f3nation.com)
// In production: use __Secure- prefix (requires HTTPS) and .f3nation.com domain
// In development with .f3nation.test: still use HTTPS (via Caddy/mkcert), so secure: true
/**
 * Extract hostname from URL, stripping protocol and path/port
 */
function extractHostname(url: string | undefined): string | undefined {
  if (!url) return undefined;
  // Remove protocol
  let hostname = url.replace(/^https?:\/\//, "");
  // Remove port and path
  hostname = hostname.split(":")[0] ?? hostname;
  hostname = hostname.split("/")[0] ?? hostname;
  return hostname || undefined;
}

/**
 * Determine the cookie domain dynamically, handling:
 * - localhost (dev): no domain (so cookies only for localhost)
 * - map.f3nation.com, api.f3nation.com, etc: use .f3nation.com
 * - map.f3nation.test, api.f3nation.test: use .f3nation.test
 *
 * If running in Vercel, use NEXT_PUBLIC_VERCEL_URL if available (or some runtime value if available).
 * Else, fallback to window.location if possible (for client-side usage), or process.env if on server.
 * If all else fails, default to undefined (scopes to current host).
 */
function getCookieDomain(): string | undefined {
  const hostname =
    typeof window !== "undefined"
      ? window.location.hostname
      : // Try Vercel env first (it won't have protocol in NEXT_PUBLIC_VERCEL_URL)
        extractHostname(process.env.NEXT_PUBLIC_VERCEL_URL) ??
        extractHostname(process.env.VERCEL_URL) ??
        extractHostname(env.NEXT_PUBLIC_API_URL) ??
        extractHostname(env.NEXT_PUBLIC_MAP_URL) ??
        undefined;

  if (
    !hostname ||
    hostname.startsWith("localhost") ||
    hostname === "127.0.0.1"
  ) {
    return undefined; // don't set domain in local dev (scopes to current host)
  }

  if (hostname.endsWith(".f3nation.com")) return ".f3nation.com";
  if (hostname.endsWith(".f3nation.test")) return ".f3nation.test";

  // fallback: scope cookie to current base domain (e.g. .example.com)
  const parts = hostname.split(".");
  if (parts.length > 2) {
    // e.g. api.sub.example.com => .example.com
    return "." + parts.slice(-2).join(".");
  }
  // e.g. my-demo.com => .my-demo.com
  if (parts.length === 2) return "." + hostname;

  return undefined;
}

/**
 * Determine if we should use secure cookies.
 * True when: production OR using HTTPS URLs (e.g., .f3nation.test with Caddy/mkcert)
 */
function shouldUseSecureCookies(): boolean {
  if (isProd) return true;

  // Check if any URL is HTTPS (for local HTTPS dev with .f3nation.test)
  const urls = [
    env.NEXT_PUBLIC_API_URL,
    env.NEXT_PUBLIC_MAP_URL,
    typeof window !== "undefined" ? window.location.href : undefined,
  ];

  return urls.some((url) => url?.startsWith("https://"));
}

const useSecureCookies = shouldUseSecureCookies();
const cookieDomain = getCookieDomain();

// Use __Secure- prefix only in production (requires HTTPS AND specific cookie attributes)
const cookiePrefix = isProd ? "__Secure-" : "";

const providers: Provider[] = [emailProvider, OtpProvider];

if (!isProd) {
  providers.push(
    CredentialsProvider({
      id: ProviderId.DEV_MODE,
      name: "Development Mode",
      credentials: {
        email: { label: "Email", type: "email" },
      },
      async authorize(credentials) {
        if (isProd) return null;

        const [f3Nation] = await db
          .select()
          .from(orgs)
          .where(eq(orgs.orgType, "nation"));
        if (!f3Nation) return null;

        // Return a mock user for development
        return {
          id: "1",
          email: credentials.email as string,
          name: "Dev User",
          roles: [
            {
              orgId: f3Nation.id,
              orgName: f3Nation.name,
              roleName: "admin",
            },
          ],
        };
      },
    }),
  );
}

export const authConfig: NextAuthConfig = {
  // Must cast since we use number for user ids
  // And next-auth expects string for user ids
  // And it is a nightmare (impossible?) to overwrite the type
  adapter: MDPGDrizzleAdapter(db) as Adapter,
  session: { strategy: "jwt" },
  // Needed to run on cloud build docker deployment (basePath and trustHost)
  // https://github.com/nextauthjs/next-auth/issues/9819#issuecomment-1912903196
  basePath: "/api/auth",
  trustHost: true,
  cookies: {
    sessionToken: {
      name: `${cookiePrefix}${COOKIE_NAME}.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
        domain: cookieDomain,
      },
    },
    callbackUrl: {
      name: `${cookiePrefix}${COOKIE_NAME}.callback-url`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
        domain: cookieDomain,
      },
    },
    csrfToken: {
      name: `${cookiePrefix}${COOKIE_NAME}.csrf-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
        domain: cookieDomain,
      },
    },
  },
  pages: {
    signIn: "/auth/sign-in",
    verifyRequest: "/auth/verify-request",
    signOut: "/auth/sign-out",
    error: "/auth/error",
  },
  providers,
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.email = user.email ?? undefined;
        token.name = user.name;
        token.roles = user.roles;
      }

      if (trigger === "update" && session && "roles" in session) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        token.roles = session.roles;
      }

      return Promise.resolve(token);
    },
    async session({ session, token }) {
      const result = {
        ...session,
        id: token.id as string | undefined,
        email: token.email,
        name: token.name as string | undefined,
        roles: token.roles as
          | { orgId: number; orgName: string; roleName: UserRole }[]
          | undefined,
      };
      return Promise.resolve(result);
    },
  },
};
