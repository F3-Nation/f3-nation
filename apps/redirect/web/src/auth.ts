import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { passkey } from "@better-auth/passkey";
import { db, schema } from "@/db";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      passkey: schema.passkey,
    },
  }),
  // TEMPORARY (prototyping): email + password sign-in so we can use the app
  // before Google OAuth credentials exist. Swap back to Google (or add the
  // passkey plugin) by flipping these — the rest of the app is unchanged.
  emailAndPassword: { enabled: true },
  // Only register Google when BOTH credentials are present — enabling it with
  // a client ID but empty secret yields a partially configured provider that
  // fails at runtime. (Lets us flip to Google later without code changes.)
  socialProviders:
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : undefined,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  // Cloud Run terminates TLS in front of us; trust the forwarded host.
  trustedOrigins: process.env.BETTER_AUTH_URL
    ? [process.env.BETTER_AUTH_URL]
    : undefined,
  plugins: [
    // Secondary, opt-in auth: users add a passkey after signing in with
    // email+password. rp/origin are env-configurable per environment.
    passkey({
      rpID: process.env.PASSKEY_RP_ID ?? "localhost",
      rpName: process.env.PASSKEY_RP_NAME ?? "F3 Redirect",
      origin:
        process.env.PASSKEY_ORIGIN ??
        process.env.BETTER_AUTH_URL ??
        "http://localhost:3000",
    }),
  ],
});
