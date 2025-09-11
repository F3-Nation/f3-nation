import type { NextAuthConfig } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import type { Provider } from "next-auth/providers";
import { eq } from "drizzle-orm";
import CredentialsProvider from "next-auth/providers/credentials";

import type { UserRole } from "@acme/shared/app/enums";
import { db } from "@acme/db/client";
import { orgs } from "@acme/db/schema/schema";
import { env } from "@acme/env";
import { ProviderId } from "@acme/shared/common/enums";

import { emailProvider } from "./lib/email-provider";
import { MDPGDrizzleAdapter } from "./lib/md-pg-drizzzle-adapter";
import OtpProvider from "./lib/otp-provider";

export type { Session } from "next-auth";

const isProd = env.NEXT_PUBLIC_CHANNEL === "prod";

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
