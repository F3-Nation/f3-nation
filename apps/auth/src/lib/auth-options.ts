import type { NextAuthConfig } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import { eq } from "@acme/db";
import { users } from "@acme/db/schema/schema";
import type { UserMeta } from "@acme/shared/app/types";

import { db } from "~/lib/db";
import { sendEmailCode, verifyEmailCode } from "~/lib/email-mfa";
import { env } from "~/env";

export const authOptions: NextAuthConfig = {
  secret: env.AUTH_SECRET,
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  basePath: "/api/auth",
  trustHost: true,
  cookies: {
    sessionToken: {
      name:
        env.NODE_ENV === "production" ? "__session" : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: env.NODE_ENV === "production" ? "none" : "lax",
        path: "/",
        secure: env.NODE_ENV === "production",
      },
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    CredentialsProvider({
      id: "email-mfa",
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        code: { label: "Code", type: "text" },
        action: { label: "Action", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email) return null;

        const email = (credentials.email as string).toLowerCase().trim();

        // Step 1: Send code (action=send or no code provided)
        if (credentials.action === "send" || !credentials.code) {
          try {
            await sendEmailCode(email);
          } catch (err) {
            console.error("sendEmailCode failed in authorize:", err);
            throw new Error(
              "Failed to send verification code. Please try again.",
            );
          }
          // Return null to signal "code sent" — not an error, just not authed yet
          return null;
        }

        // Step 2: Verify code
        const user = await verifyEmailCode(email, credentials.code as string);
        if (!user) return null;

        return {
          id: String(user.id),
          email: user.email ?? undefined,
          name: user.f3Name,
          roles: [],
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = Number(user.id);
        token.email = user.email ?? undefined;
        token.name = user.name;
      }

      // Enrich with fresh DB data on each request
      if (token.userId) {
        const [dbUser] = await db
          .select({
            id: users.id,
            f3Name: users.f3Name,
            email: users.email,
            avatarUrl: users.avatarUrl,
            meta: users.meta,
            status: users.status,
          })
          .from(users)
          .where(eq(users.id, token.userId as number))
          .limit(1);

        if (dbUser) {
          token.name = dbUser.f3Name;
          token.email = dbUser.email;
          token.picture = dbUser.avatarUrl;
          token.meta = dbUser.meta;
          token.status = dbUser.status;
          token.onboardingCompleted = !!(dbUser.meta as UserMeta | undefined)
            ?.onboarding_completed;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.userId);
        session.user.name = String(token.name);
        session.user.email = String(token.email);
        session.user.image = token.picture;
      }
      return {
        ...session,
        onboardingCompleted: !!token.onboardingCompleted,
      };
    },
  },
};
