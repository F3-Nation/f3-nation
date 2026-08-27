/**
 * Phase 1 spike for #876: does Better Auth's OAuth 2.1 Provider plugin issue
 * access tokens that satisfy @f3nation/sso's AccessTokenPayload? See README.md.
 *
 * Deliberately uses the in-memory adapter — no @acme/db, no drizzle-orm — so
 * this package's dependency graph never touches the real apps' shared
 * drizzle-orm pin.
 */
import type { MemoryDB } from "better-auth/adapters/memory";
import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth";
import type { BetterAuthPlugin } from "better-auth";
import { getAuthTables } from "@better-auth/core/db";
import { bearer } from "better-auth/plugins/bearer";
import { emailOTP } from "better-auth/plugins/email-otp";
import { jwt } from "better-auth/plugins/jwt";
import {
  extendOAuthProvider,
  oauthProvider,
} from "@better-auth/oauth-provider";

const memoryDb: MemoryDB = {};

export const SPIKE_RESOURCE = "https://spike-api.f3nation.test";

// The OAuth Provider plugin's `claims.accessToken` extension is strictly
// additive (can't override an AS-owned/reserved claim) and is only
// registrable from a companion plugin's own init() hook -- there's no
// top-level `oauthProvider({ claims })` shortcut. This is that companion
// plugin. It must be registered *after* oauthProvider() in the `plugins`
// array below, since extendOAuthProvider() throws if the oauth-provider
// plugin isn't installed yet.
const accessTokenClaimShapePlugin: BetterAuthPlugin = {
  id: "f3-access-token-claim-shape",
  init(ctx) {
    extendOAuthProvider(ctx, {
      claims: {
        // signAccessToken (apps/auth/src/lib/jwt.ts) always stamps
        // token_use: "access" and email, regardless of granted scope --
        // isAccessTokenPayload (@f3nation/sso) treats token_use as the
        // required discriminator that tells an access token apart from an
        // ID Token sharing the same signing key/kid/issuer. Mirror both
        // here so a Better Auth-issued token satisfies that check exactly
        // the way the real signer's output does.
        accessToken: ({ user }) => ({
          token_use: "access" as const,
          email: user?.email,
        }),
      },
    });
    return undefined;
  },
};

export function createSpikeAuthInstance() {
  // Deliberately not annotated `: BetterAuthOptions` -- that would widen the
  // plugins array to the general interface and erase the literal types
  // betterAuth() needs to generate a fully-typed `.api` surface (the whole
  // reason auth.api.createOAuthClient etc. exist as named methods at all).
  const authOptions = {
    baseURL: "http://localhost:3999",
    secret: "spike-only-not-a-real-secret-do-not-reuse",
    database: memoryAdapter(memoryDb),
    emailAndPassword: { enabled: false },
    plugins: [
      emailOTP({
        // Real apps/auth sends this over SMTP (Mailpit locally, SendGrid in
        // prod) -- irrelevant here since the test drives sign-in through
        // createVerificationOTP (mints the code directly, no transport)
        // rather than exercising delivery.
        sendVerificationOTP() {
          return Promise.resolve();
        },
      }),
      jwt({
        jwks: {
          // Real signAccessToken/getJWKS (apps/auth/src/lib/jwt.ts) sign
          // RS256 -- match it so the resulting JWKS/JWT shape is comparable.
          keyPairConfig: { alg: "RS256" },
        },
        jwt: {
          // Mirrors signAccessToken's sub: the app's own user id, as a
          // string. Better Auth's in-memory adapter mints its own string
          // user ids (not the real @acme/db `users.serial` id this spike
          // has no connection to) -- Phase 3, wired to the real DB, is
          // where sub becomes the real numeric-string id again.
          getSubject: (session) => session.user.id,
        },
      }),
      // Must precede accessTokenClaimShapePlugin -- see that plugin's comment.
      oauthProvider({
        // Required by OAuthOptions but never actually rendered or visited --
        // the test extracts the signed oauth_query straight off the
        // /oauth2/authorize redirect and POSTs it to /oauth2/consent itself
        // rather than following the redirect to a real page.
        loginPage: "/login",
        consentPage: "/consent",
        scopes: ["openid", "profile", "email", "offline_access"],
        accessTokenExpiresIn: 3600,
        // Without a resource, access tokens are opaque reference tokens by
        // default (found empirically -- the only JWT in an unconfigured
        // token response is the id_token). The real apps/auth always signs
        // a self-contained JWT access token, so this spike's whole parity
        // question only engages once a resource with signingAlgorithm is
        // registered and requested via the `resource` param.
        resources: [
          {
            identifier: SPIKE_RESOURCE,
            signingAlgorithm: "RS256",
          },
        ],
        // enforcePerClientResources defaults to true (RFC 8707 §3) -- link
        // every newly registered client to the spike resource automatically
        // rather than hand-linking one in the test.
        clientRegistrationDefaultResources: [SPIKE_RESOURCE],
      }),
      accessTokenClaimShapePlugin,
      // Lets the test authenticate follow-up calls with a plain
      // `Authorization: Bearer <token>` header instead of constructing a
      // real cookie jar.
      bearer(),
    ],
  };

  // The memory adapter throws on any findOne() against a model whose array
  // key is entirely absent from `db` (as opposed to present-but-empty) --
  // pre-seed every model the merged core + plugin schema declares so a
  // lookup against a table nothing has been written to yet (e.g. `user`
  // before any sign-in) doesn't crash instead of returning "not found".
  for (const table of Object.keys(getAuthTables(authOptions))) {
    memoryDb[table] ??= [];
  }

  return betterAuth(authOptions);
}
