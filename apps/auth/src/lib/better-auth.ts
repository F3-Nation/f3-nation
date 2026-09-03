/**
 * Better Auth instance for the F3 SSO server — not wired into any live
 * route yet; gated behind AUTH_USE_BETTER_AUTH (see apps/auth/src/app/api/
 * auth2/[...all]/route.ts).
 *
 * This factory is deliberately adapter-injectable (see `createAuthInstance`
 * below) rather than exporting one hardwired instance:
 *   - Production (`auth`, at the bottom of this file) uses `drizzleAdapter`
 *     against the real `db` from `~/lib/db`, so every token this instance
 *     issues is backed by real Postgres rows under the `better_auth_*`
 *     tables in packages/db/drizzle/schema.ts.
 *   - Tests use `memoryAdapter` (see `apps/auth/__tests__/lib/
 *     better-auth.test.ts`) so the plugin/claim-shape/PKCE logic below is
 *     verifiable without a live Postgres.
 *
 * Plugin order matters: emailOTP -> jwt -> oauthProvider ->
 * accessTokenClaimShapePlugin -> bearer. accessTokenClaimShapePlugin must
 * come after oauthProvider() — extendOAuthProvider() throws otherwise.
 *
 * What this does NOT do (flagged, not silently skipped):
 *   - Does not touch `/api/oauth/*` — those routes still serve every
 *     request from the hand-rolled server in apps/auth/src/lib/oauth.ts,
 *     unconditionally, regardless of AUTH_USE_BETTER_AUTH. Rewiring the
 *     real OAuth endpoints to delegate here needs a path-mapping decision
 *     (oauth-provider's endpoints live under their own fixed /oauth2/*
 *     sub-path, not at /api/oauth/authorize directly) that's out of scope
 *     here.
 *   - Does not implement the onboarding-completed gate that
 *     apps/auth/src/app/api/oauth/authorize/route.ts enforces today
 *     (redirect to /onboarding when `meta.onboarding_completed` is unset).
 *     Better Auth's own authorize flow has no hook for this app-specific
 *     business rule out of the box.
 *   - Does not migrate existing oauth_clients rows — see
 *     apps/auth/scripts/migrate-oauth-clients-to-better-auth.ts, provided
 *     but not run by anything here.
 *
 * Prefers Better Auth's own defaults over matching the hand-rolled server's
 * exact behavior, even where that means disruption at cutover (forced
 * re-login, confidential clients needing new secrets) — except where a
 * default would be a security regression (PKCE) or would break basic
 * integration with the existing `users` table (the sub/identity bridge
 * below), neither of which applies here.
 */
import type { BetterAuthPlugin } from "better-auth";
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
import { emailOTP } from "better-auth/plugins/email-otp";
import { jwt } from "better-auth/plugins/jwt";
import {
  extendOAuthProvider,
  oauthProvider,
} from "@better-auth/oauth-provider";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { MemoryDB } from "better-auth/adapters/memory";
import { eq } from "drizzle-orm";

import {
  betterAuthAccount,
  betterAuthJwks,
  betterAuthOauthAccessToken,
  betterAuthOauthClient,
  betterAuthOauthClientAssertion,
  betterAuthOauthClientResource,
  betterAuthOauthConsent,
  betterAuthOauthRefreshToken,
  betterAuthOauthResource,
  betterAuthSession,
  betterAuthUser,
  betterAuthVerification,
  users,
} from "@acme/db/schema/schema";

// The OAuth Provider plugin's `claims.accessToken` extension is strictly
// additive (can't override an AS-owned/reserved claim) and is only
// registrable from a companion plugin's own init() hook — there's no
// top-level `oauthProvider({ claims })` shortcut. This is that companion
// plugin, reproducing the claim shape packages/sso's isAccessTokenPayload /
// apps/auth/src/lib/jwt.ts's signAccessToken already expect.
const accessTokenClaimShapePlugin: BetterAuthPlugin = {
  id: "f3-access-token-claim-shape",
  init(ctx) {
    extendOAuthProvider(ctx, {
      claims: {
        accessToken: ({ user }) => ({
          token_use: "access" as const,
          email: user?.email,
        }),
      },
    });
    return undefined;
  },
};

export interface CreateAuthInstanceOptions {
  /** The app's real origin, e.g. NEXT_PUBLIC_AUTH_URL. NOT the mount path — see basePath. */
  baseURL: string;
  /**
   * Path this instance's handler is mounted under, relative to baseURL.
   * Better Auth defaults this to "/api/auth", which would collide with
   * NextAuth's own /api/auth/* routes that stay live regardless of
   * AUTH_USE_BETTER_AUTH — must be set to something else (e.g. "/api/auth2",
   * matching apps/auth/src/app/api/auth2/[...all]/route.ts).
   */
  basePath: string;
  /** BetterAuth's own session-signing secret — distinct from AUTH_SECRET (NextAuth's). */
  secret: string;
  /** Issuer claim on every signed JWT (id_token and access_token alike). */
  issuer: string;
  /** better-auth adapter-producing function — drizzleAdapter(db, ...) in prod, memoryAdapter({}) in tests. */
  database:
    ReturnType<typeof drizzleAdapter> | ReturnType<typeof memoryAdapter>;
  /**
   * Called with a freshly generated OTP to deliver by email. Production
   * wires this to the same EMAIL_SERVER transport apps/auth/src/lib/
   * email-mfa.ts already uses (see sendBetterAuthOtpEmail below); tests
   * pass a no-op.
   */
  sendVerificationOTP: (data: {
    email: string;
    otp: string;
    type: "sign-in" | "email-verification" | "forget-password" | "change-email";
  }) => Promise<void>;
  /**
   * Looks up the real `users.id` for a freshly-OTP-verified email. Returns
   * null when no `users` row exists for that email — mirroring
   * apps/auth/src/lib/email-mfa.ts's verifyEmailCode exactly (new-user
   * registration is a separate flow; a bare MFA code should never be able
   * to conjure a new identity on its own).
   *
   * This deliberately does NOT use emailOTP's own `disableSignUp` option to
   * enforce that rule: `disableSignUp` only checks whether Better Auth's
   * own shadow `user` table already has a row for the email — which is
   * empty for every existing F3 user's *first* Better Auth sign-in, flag or
   * no flag. Checking there would reject every real user on day one, not
   * just genuinely unregistered emails. The real gate has to run against
   * the real `users` table, which only `databaseHooks.user.create.before`
   * below has access to — so `disableSignUp` stays false (let Better Auth
   * create its own bookkeeping row) and this function's `null` result is
   * what makes that `before` hook refuse the sign-in instead.
   */
  findF3UserId: (email: string) => Promise<number | null>;
}

/**
 * Split out from createAuthInstance so tests can pre-seed a memoryAdapter's
 * backing object with `getAuthTables(buildBetterAuthOptions(...))` before
 * constructing the instance: memoryAdapter throws on any findOne() against
 * a model whose array key is entirely absent from the backing object,
 * rather than returning "not found".
 */
export function buildBetterAuthOptions(options: CreateAuthInstanceOptions) {
  // The one resource this app's Better Auth config registers. Without a
  // registered resource + signingAlgorithm, oauth-provider issues opaque
  // reference access tokens instead of self-contained JWTs — the
  // hand-rolled server (apps/auth/src/lib/jwt.ts) has always signed real
  // JWTs, so parity requires this.
  const resource = options.issuer;

  return {
    baseURL: options.baseURL,
    basePath: options.basePath,
    secret: options.secret,
    database: options.database,
    emailAndPassword: { enabled: false },
    databaseHooks: {
      user: {
        create: {
          // Two jobs at once: (1) refuse to create a Better Auth user for
          // any email with no real `users` row — see findF3UserId's doc
          // comment for why this, not emailOTP's disableSignUp, is where
          // that rule has to live; (2) for an email that IS a real user,
          // make the new Better Auth `user.id` literally equal to
          // `users.id` (as a string) instead of a separately-minted id in
          // an unrelated identity space — see the block comment on
          // betterAuthUser in packages/db/drizzle/schema.ts for why that
          // matters (it's what jwt().getSubject below reads).
          before: async (user: { email: string } & Record<string, unknown>) => {
            const f3UserId = await options.findF3UserId(user.email);
            if (f3UserId === null) return false;
            return { data: { ...user, id: String(f3UserId) } };
          },
        },
      },
    },
    plugins: [
      emailOTP({
        sendVerificationOTP: options.sendVerificationOTP,
        otpLength: 6, // matches apps/auth/src/lib/email-mfa.ts's 6-digit code
        expiresIn: 600, // 10 minutes, matches CODE_TTL_MINUTES in email-mfa.ts
        allowedAttempts: 5, // matches MAX_ATTEMPTS in email-mfa.ts
        storeOTP: "hashed", // never store the plaintext code, matches hashCode() in email-mfa.ts
        // NOT disableSignUp: true — see findF3UserId's doc comment above
        // for why the "no account, no sign-in" rule has to be enforced in
        // databaseHooks.user.create.before instead of here.
      }),
      jwt({
        jwks: {
          keyPairConfig: { alg: "RS256" }, // matches signAccessToken's RS256 (apps/auth/src/lib/jwt.ts)
        },
        jwt: {
          issuer: options.issuer,
          // The real users.id, as a string — see databaseHooks.user.create
          // above. This is the line that makes sub continuity hold.
          getSubject: (session) => session.user.id,
        },
      }),
      // Must precede accessTokenClaimShapePlugin — see that plugin's comment.
      oauthProvider({
        loginPage: "/login/email",
        consentPage: "/consent",
        scopes: ["openid", "profile", "email", "offline_access"],
        accessTokenExpiresIn: 3600, // matches ACCESS_TOKEN_TTL in apps/auth/src/lib/oauth.ts
        resources: [{ identifier: resource, signingAlgorithm: "RS256" }],
        clientRegistrationDefaultResources: [resource],
        // PKCE defaults to required per client already (oauth-provider's
        // own default), and is always enforced for public clients /
        // offline_access regardless of this setting — matching the
        // hand-rolled server's unconditional PKCE requirement (see
        // apps/auth/src/lib/oauth.ts's exchangeAuthorizationCode). Set
        // explicitly here anyway so the intent is documented, not implicit.
        clientRegistrationRequirePKCE: true,
        // Deliberately no storeClientSecret override — prefers Better
        // Auth's own default secret hashing over matching the hand-rolled
        // server's sha256 scheme, even though it means confidential clients
        // (admin, me) need new secrets issued at cutover instead of
        // carrying today's forward unchanged. See
        // apps/auth/scripts/migrate-oauth-clients-to-better-auth.ts, which
        // no longer copies client_secret_hash for exactly this reason.
      }),
      accessTokenClaimShapePlugin,
      // Lets callers authenticate with a plain `Authorization: Bearer
      // <token>` header — needed for /userinfo-equivalent calls without a
      // real cookie jar (mirrors validateAccessToken's Bearer handling).
      bearer(),
    ],
  };
}

export function createAuthInstance(options: CreateAuthInstanceOptions) {
  return betterAuth(buildBetterAuthOptions(options));
}

// ---------------------------------------------------------------------------
// Production wiring — constructed lazily so importing this module (e.g. from
// a test that only wants the pure helpers above) doesn't require DATABASE_*
// env vars or open a DB connection as a side effect.
// ---------------------------------------------------------------------------

let _auth: ReturnType<typeof createAuthInstance> | null = null;

/**
 * The production Better Auth instance, backed by the real database via
 * drizzleAdapter. Only constructed when first called — see
 * apps/auth/src/app/api/auth2/[...all]/route.ts, which is the only current
 * call site, and which itself only runs when AUTH_USE_BETTER_AUTH is set.
 */
export async function getAuth() {
  if (_auth) return _auth;

  const { db } = await import("~/lib/db");
  const { env } = await import("~/env");
  const { sendBetterAuthOtpEmail } = await import("~/lib/better-auth-email");

  if (!env.BETTER_AUTH_SECRET) {
    throw new Error(
      "BETTER_AUTH_SECRET is not configured — required to turn on AUTH_USE_BETTER_AUTH.",
    );
  }

  const basePath = "/api/auth2";
  // Distinct from NEXT_PUBLIC_AUTH_URL alone (the legacy issuer) so a token
  // from this isolated, pre-cutover instance can never be mistaken for one
  // the hand-rolled server signed, even though both currently share a
  // baseURL origin.
  const issuer = `${env.NEXT_PUBLIC_AUTH_URL}${basePath}`;

  _auth = createAuthInstance({
    baseURL: env.NEXT_PUBLIC_AUTH_URL,
    basePath,
    // Deliberately separate from AUTH_SECRET (NextAuth's own signing key) —
    // see env.ts's comment on BETTER_AUTH_SECRET.
    secret: env.BETTER_AUTH_SECRET,
    issuer,
    database: drizzleAdapter(db, {
      provider: "pg",
      schemaName: "auth",
      schema: {
        user: betterAuthUser,
        session: betterAuthSession,
        account: betterAuthAccount,
        verification: betterAuthVerification,
        jwks: betterAuthJwks,
        oauthClient: betterAuthOauthClient,
        oauthResource: betterAuthOauthResource,
        oauthClientResource: betterAuthOauthClientResource,
        oauthRefreshToken: betterAuthOauthRefreshToken,
        oauthAccessToken: betterAuthOauthAccessToken,
        oauthConsent: betterAuthOauthConsent,
        oauthClientAssertion: betterAuthOauthClientAssertion,
      },
    }),
    sendVerificationOTP: async ({ email, otp }) => {
      await sendBetterAuthOtpEmail(email, otp);
    },
    findF3UserId: async (email) => {
      const normalizedEmail = email.toLowerCase().trim();
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);
      return existing ? existing.id : null;
    },
  });

  return _auth;
}

// Re-exported so tests can construct an isolated in-memory instance without
// duplicating the memoryAdapter pre-seeding dance above.
export { memoryAdapter };
export type { MemoryDB };
