/**
 * Better Auth instance for the F3 SSO server. With AUTH_USE_BETTER_AUTH on,
 * it backs first-party sign-in, registration, sign-out and session reads
 * (see lib/current-session.ts), and /api/oauth/{authorize,token,userinfo,
 * revoke} forward to its /oauth2/* endpoints (see lib/better-auth-oauth.ts).
 * With the flag off, /api/oauth/* runs on lib/oauth.ts as before.
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
 * The onboarding gate that apps/auth/src/app/api/oauth/authorize/route.ts
 * enforces (redirect to /onboarding while `meta.onboarding_completed` is
 * unset) runs here as oauthProvider's `signup.shouldRedirect`, which the
 * plugin re-checks on every authorize pass, including /oauth2/continue and
 * /oauth2/consent resumes. Login and onboarding both round-trip through
 * /api/oauth/authorize (see app/oauth/login and app/oauth/onboarding).
 *
 * Existing oauth_clients rows are migrated by
 * apps/auth/scripts/migrate-oauth-clients-to-better-auth.ts, which nothing
 * here runs.
 *
 * Prefers Better Auth's own defaults over matching the hand-rolled server's
 * exact behavior, even where that means disruption at cutover (forced
 * re-login, confidential clients needing new secrets) — except where a
 * default would be a security regression (PKCE) or would break basic
 * integration with the existing `users` table (the sub/identity bridge
 * below), neither of which applies here.
 */
import type { BetterAuthPlugin } from "better-auth";
import { APIError, betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
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

// Type-only — erased at compile time, so this does NOT import ~/lib/db (and
// its DATABASE_* env requirement) as a module-load side effect. See getAuth's
// own dynamic `await import("~/lib/db")` below for the actual runtime import.
import type { db as authDbType } from "~/lib/db";
import { logInfo, logWarn } from "~/lib/logging";
import { F3_NATION_CLIENT_REFERENCE_ID } from "~/lib/oauth-client-reference";

import { getUserRoles } from "@acme/db";
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
import { isNationAdminFromSession } from "@acme/shared/app/role-checks";

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
  /**
   * Returns whether the given F3 `users.id` currently holds the nation-admin
   * role — the same check `nationAdminProcedure` uses (packages/api/src/
   * shared.ts), just against a raw user id instead of a `Session`, since
   * oauth-provider's `clientReference` callback below only gets Better
   * Auth's own `{ user, session }` shape, not an F3 `Session` with a
   * populated `roles` array.
   */
  isNationAdmin: (f3UserId: number) => Promise<boolean>;
  /**
   * Gates every OAuth client action via oauth-provider's `clientPrivileges`
   * hook — called with the attempted action, returns whether it's allowed.
   * Production is an allowlist of read/list/rotate (see
   * allowProductionClientAction's comment): "create" is denied because
   * dynamic self-serve client creation isn't part of the design (letting it
   * through would auto-tag whatever an admin creates as F3-managed via
   * clientReference below, not just the intended F3-managed clients), and
   * "update"/"delete"/"configure-client-credentials-scopes" are denied
   * because once a client is F3-managed, oauth-provider's own per-client
   * ownership check no longer limits who can use them — every nation admin
   * passes it — so those actions need this allowlist to stay closed
   * instead. Tests pass a permissive policy so fixtures can exercise client
   * creation directly.
   */
  allowClientAction: (
    action:
      | "create"
      | "read"
      | "update"
      | "delete"
      | "list"
      | "rotate"
      | "configure-client-credentials-scopes",
  ) => Promise<boolean>;
  /**
   * Reads the F3 `users` row behind a Better Auth user (whose id is the
   * `users.id`, see databaseHooks below). Feeds the onboarding gate and the
   * userinfo / id_token profile claims, which the hand-rolled server has
   * always read from `users` (f3Name, avatarUrl), not from Better Auth's
   * own `user.name` / `image` (empty for OTP sign-ups). Returns null when
   * no row exists.
   */
  findF3Profile: (f3UserId: number) => Promise<F3Profile | null>;
}

export interface F3Profile {
  f3Name: string | null;
  avatarUrl: string | null;
  email: string;
  emailVerified: boolean;
  onboardingCompleted: boolean;
}

/**
 * Where oauthProvider sends the browser for login and for onboarding. Both
 * are route handlers (app/oauth/login, app/oauth/onboarding) that turn the
 * plugin's signed query back into an /api/oauth/authorize callbackUrl for
 * the existing pages.
 */
export const OAUTH_LOGIN_PAGE = "/oauth/login";
export const OAUTH_ONBOARDING_PAGE = "/oauth/onboarding";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Fills the default resource and drops an empty nonce on one authorize
 * parameter object. Edits in place: a hook's returned context is merged
 * with the original as defaults, so it can't remove a key.
 */
function normalizeAuthorizeParams(
  params: Record<string, unknown>,
  resource: string,
) {
  params.resource ??= resource;
  if (params.nonce === "") delete params.nonce;
}

async function findProfileForUser(
  options: CreateAuthInstanceOptions,
  userId: string,
): Promise<F3Profile | null> {
  const f3UserId = Number(userId);
  if (!Number.isInteger(f3UserId)) return null;
  return options.findF3Profile(f3UserId);
}

/**
 * Profile claims from the F3 `users` row, gated by scope the way the
 * hand-rolled userinfo route and signIdToken gate them.
 */
function f3ProfileClaims(profile: F3Profile, scopes: string[]) {
  const claims: Record<string, unknown> = {};
  if (scopes.includes("profile")) {
    claims.name = profile.f3Name;
    claims.picture = profile.avatarUrl;
  }
  if (scopes.includes("email")) {
    claims.email = profile.email;
    claims.email_verified = profile.emailVerified;
  }
  return claims;
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
    hooks: {
      // Runs before every endpoint, so it also covers callers of the
      // BA-native /api/auth2/oauth2/* paths advertised in discovery, not just
      // the /api/oauth/* adapters.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/oauth2/authorize") {
          // Without a resource the plugin sets no `aud` and issues an opaque
          // access token that no relying party can verify; packages/sso never
          // sends one. An empty nonce gives no replay protection and would be
          // echoed into the id_token as "nonce": ""; the hand-rolled
          // authorize route treats it as omitted, and so does this.
          //
          // The plugin reads a POST's parameters from the form body and
          // everything else (GET, and the consent/continue resumes, which
          // replay the stored query) from the query, so both are covered.
          for (const params of [ctx.query, ctx.body]) {
            if (isRecord(params)) normalizeAuthorizeParams(params, resource);
          }
          return;
        }
        if (ctx.path === "/oauth2/token" && isRecord(ctx.body)) {
          ctx.body.resource ??= resource;
        }
      }),
    },
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
            if (f3UserId === null) {
              // Not `return false`: Better Auth's internal createWithHooks
              // treats that as "silently return null," and signInEmailOTP
              // then dereferences `newUser.id` on that null unconditionally
              // — an unregistered email crashes with an unhandled TypeError
              // (500) instead of a clean error. Throwing here is what
              // surfaces a real 4xx to the caller. The registration
              // hand-off (see apps/auth/src/app/login/email/verify/
              // verify-email-form.tsx) avoids ever hitting this path in
              // normal use by checking /api/check-user before calling
              // signIn.emailOtp, so this is a safety net for
              // anyone calling the Better Auth API directly, not the
              // primary mechanism.
              throw new APIError("BAD_REQUEST", {
                code: "NO_F3_ACCOUNT",
                message:
                  "No F3 account exists for this email yet — register first.",
              });
            }
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
        loginPage: OAUTH_LOGIN_PAGE,
        // There is no consent page: every migrated client has skipConsent
        // (see scripts/migrate-oauth-clients-to-better-auth.ts), and
        // production can't create new clients. A client without it, or a
        // request with prompt=consent, lands on a 404 and gets no code.
        consentPage: "/consent",
        signup: {
          page: OAUTH_ONBOARDING_PAGE,
          // Re-checked on every authorize pass, /oauth2/continue included,
          // and answered with interaction_required under prompt=none. A
          // missing users row counts as not onboarded, so the gate fails
          // closed.
          shouldRedirect: async ({ user }) =>
            !(await findProfileForUser(options, user.id))?.onboardingCompleted,
        },
        scopes: ["openid", "profile", "email", "offline_access"],
        accessTokenExpiresIn: 3600, // matches ACCESS_TOKEN_TTL in apps/auth/src/lib/oauth.ts
        idTokenExpiresIn: 3600, // matches signIdToken's ACCESS_TOKEN_TTL lifetime in lib/oauth.ts
        // Merged over Better Auth's own claims, which read better_auth_user.
        customUserInfoClaims: async ({ user, scopes }) => {
          const profile = await findProfileForUser(options, user.id);
          // No users row (e.g. after a DB wipe): reject like the hand-rolled
          // userinfo route instead of answering with a bare sub.
          if (!profile) {
            throw new APIError("UNAUTHORIZED", {
              error: "invalid_token",
              error_description: "user not found",
            });
          }
          return f3ProfileClaims(profile, scopes);
        },
        // Better Auth puts no profile claims in the id_token. signIdToken
        // does, omitting null ones, and marks the token token_use "id" so a
        // verifier that requires token_use "access" never takes it as an
        // access token.
        customIdTokenClaims: async ({ user, scopes }) => {
          const profile = await findProfileForUser(options, user.id);
          const claims = profile ? f3ProfileClaims(profile, scopes) : {};
          return {
            token_use: "id",
            ...Object.fromEntries(
              Object.entries(claims).filter(([, value]) => value != null),
            ),
          };
        },
        resources: [{ identifier: resource, signingAlgorithm: "RS256" }],
        clientRegistrationDefaultResources: [resource],
        // PKCE defaults to required per client already (oauth-provider's
        // own default), and is always enforced for public clients /
        // offline_access regardless of this setting — matching the
        // hand-rolled server's unconditional PKCE requirement (see
        // apps/auth/src/lib/oauth.ts's exchangeAuthorizationCode). Set
        // explicitly here anyway so the intent is documented, not implicit.
        clientRegistrationRequirePKCE: true,
        // Any nation admin can read/list/rotate a shared, F3-Nation-owned
        // client instead of it being tied to whichever individual admin
        // happened to create it — see F3_NATION_CLIENT_REFERENCE_ID in lib/oauth-client-reference.ts.
        // A session that isn't a nation admin gets `undefined` here, so
        // oauth-provider falls back to its normal per-user ownership
        // (session.user.id) for any client that admin creates for
        // themselves.
        //
        // This callback only ever sees the calling session, never the
        // client being created/mutated, so it can't tell an intended
        // F3-managed client apart from any other client a nation admin
        // happens to create — see allowClientAction's doc comment above for
        // why production denies "create" outright instead of relying on
        // this callback alone. This callback's create-time return value
        // only matters where a caller injects a permissive allowClientAction
        // (the test fixtures) — production never takes that path.
        //
        // An F3-managed client's referenceId has to be set directly, by a
        // provisioning script writing to the database, before this callback
        // (or a rotate call) can ever apply to it.
        clientReference: async ({ user }) => {
          if (!user) return undefined;
          const f3UserId = Number(user.id);
          if (!Number.isInteger(f3UserId)) return undefined;
          return (await options.isNationAdmin(f3UserId))
            ? F3_NATION_CLIENT_REFERENCE_ID
            : undefined;
        },
        // See allowClientAction's doc comment above.
        clientPrivileges: async ({ action, user }) => {
          const allowed = await options.allowClientAction(action);
          // Denials and non-read attempts are worth an audit trail — an
          // action here hands out or replaces an app's credentials, and
          // oauth-provider itself doesn't log the UNAUTHORIZED it throws
          // when this returns false. This hook runs before oauth-provider's
          // own ownership check, so an "attempted" log records an attempt,
          // not necessarily a success.
          if (!allowed) {
            logWarn("auth.oauth_client.action_denied", {
              action,
              userId: user?.id,
            });
          } else if (action !== "read" && action !== "list") {
            logInfo("auth.oauth_client.action_attempted", {
              action,
              userId: user?.id,
            });
          }
          return allowed;
        },
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

/**
 * Deletes every OAuth access and refresh token row Better Auth holds for a
 * user. Signing out only deletes the session, and the plugin's session
 * delete hook deliberately spares offline_access refresh tokens, so logout
 * calls this to end those too. Access token rows go first: they reference
 * their refresh token.
 */
export async function deleteBetterAuthOAuthTokens(
  auth: Pick<ReturnType<typeof createAuthInstance>, "$context">,
  userId: string,
) {
  const { adapter } = await auth.$context;
  const where = [{ field: "userId", value: userId }];
  // Both are attempted even if the first fails, so one bad table doesn't
  // leave the other's tokens alive; the first failure is then thrown.
  const failures: unknown[] = [];
  for (const model of ["oauthAccessToken", "oauthRefreshToken"]) {
    try {
      await adapter.deleteMany({ model, where });
    } catch (err) {
      failures.push(err);
    }
  }
  if (failures.length > 0) throw failures[0];
}

// ---------------------------------------------------------------------------
// Production wiring — constructed lazily so importing this module (e.g. from
// a test that only wants the pure helpers above) doesn't require DATABASE_*
// env vars or open a DB connection as a side effect.
// ---------------------------------------------------------------------------

/**
 * Better Auth model name -> Drizzle table, as handed to drizzleAdapter.
 * Exported so tests run Better Auth's schema check against the exact
 * mapping production uses.
 */
export const betterAuthDrizzleSchema = {
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
};

/** Where app/api/auth2/[...all]/route.ts mounts the production instance. */
export const BETTER_AUTH_BASE_PATH = "/api/auth2";

let _auth: ReturnType<typeof createAuthInstance> | null = null;

type AuthDb = typeof authDbType;

/**
 * Kept as a standalone function — rather than inline in getAuth's
 * `isNationAdmin` field — so it can be unit-tested with a stubbed db without
 * constructing a whole Better Auth instance. The roles query itself lives
 * in @acme/db's getUserRoles, shared with packages/api's getSessionFromJWT,
 * so there's one place to change it, not two.
 */
export async function isNationAdminForUser(
  database: AuthDb,
  f3UserId: number,
): Promise<boolean> {
  const userRoles = await getUserRoles(database, f3UserId);
  return isNationAdminFromSession({ roles: userRoles });
}

/** Production's findF3Profile, split out so it's testable with a stubbed db. */
export async function findF3ProfileInDb(
  database: AuthDb,
  f3UserId: number,
): Promise<F3Profile | null> {
  const [row] = await database
    .select({
      f3Name: users.f3Name,
      avatarUrl: users.avatarUrl,
      email: users.email,
      emailVerified: users.emailVerified,
      meta: users.meta,
    })
    .from(users)
    .where(eq(users.id, f3UserId))
    .limit(1);
  if (!row) return null;
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  return {
    f3Name: row.f3Name,
    avatarUrl: row.avatarUrl,
    email: row.email,
    emailVerified: !!row.emailVerified,
    // Same truthiness test as the hand-rolled authorize route.
    onboardingCompleted: !!meta.onboarding_completed,
  };
}

/**
 * Production's allowClientAction policy. An allowlist, not a denylist: once
 * a client is F3-managed, "ownership" just means "is a nation admin" (see
 * clientReference above), so `update` and `delete` aren't safe defaults to
 * leave open. `update` covers redirect_uris in this version of
 * oauth-provider — an admin could repoint an F3-managed client's
 * redirect_uris at a URL they control, then rotate its secret, and
 * intercept another F3 user's authorization code on their next sign-in. The
 * only actions the stated goal (issuing a secret for an existing client)
 * needs are read/list/rotate — everything else, including any future
 * oauth-provider action, is denied by default rather than silently
 * permitted. Split out from getAuth() (which needs a live DB connection to
 * construct at all) so this pure decision is independently testable.
 */
export function allowProductionClientAction(
  action: Parameters<CreateAuthInstanceOptions["allowClientAction"]>[0],
): Promise<boolean> {
  return Promise.resolve(
    action === "read" || action === "list" || action === "rotate",
  );
}

/**
 * The production Better Auth instance, backed by the real database via
 * drizzleAdapter. Only constructed when first called, and only called on
 * paths that run while AUTH_USE_BETTER_AUTH is set (the /api/auth2 mount,
 * the /api/oauth/* adapters, /.well-known/*, current-session.ts).
 */
export async function getAuth() {
  if (_auth) return _auth;

  const { db } = await import("~/lib/db");
  const { env } = await import("~/env");
  const { deliverBetterAuthOtp } = await import("~/lib/better-auth-email");

  if (!env.BETTER_AUTH_SECRET) {
    throw new Error(
      "BETTER_AUTH_SECRET is not configured — required to turn on AUTH_USE_BETTER_AUTH.",
    );
  }

  // The bare origin, same as the hand-rolled server's issuer. Relying
  // parties (packages/sso, packages/api) expect iss === their auth URL and
  // fetch keys from <origin>/.well-known/jwks.json, which also serves this
  // instance's keys while the flag is on (see that route). The flag is only
  // turned on for f3-auth3, which has its own origin (see
  // scripts/cloud-run-env-auth3.sh), so no other service claims this issuer.
  // Better Auth's own discovery metadata is NOT reachable at the origin: its
  // hook only matches paths under the issuer's path, and root-level requests
  // never reach the /api/auth2 mount. Until cutover, discovery is the
  // hand-written /.well-known/openid-configuration; it must point at the
  // /api/auth2/oauth2/* endpoints (or serve oauthProviderOpenIdConfigMetadata)
  // before relying parties move.
  const issuer = env.NEXT_PUBLIC_AUTH_URL;

  _auth = createAuthInstance({
    baseURL: env.NEXT_PUBLIC_AUTH_URL,
    basePath: BETTER_AUTH_BASE_PATH,
    // Deliberately separate from AUTH_SECRET (NextAuth's own signing key) —
    // see env.ts's comment on BETTER_AUTH_SECRET.
    secret: env.BETTER_AUTH_SECRET,
    issuer,
    database: drizzleAdapter(db, {
      provider: "pg",
      schemaName: "auth",
      schema: betterAuthDrizzleSchema,
    }),
    sendVerificationOTP: deliverBetterAuthOtp,
    findF3UserId: async (email) => {
      const normalizedEmail = email.toLowerCase().trim();
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);
      return existing ? existing.id : null;
    },
    isNationAdmin: (f3UserId) => isNationAdminForUser(db, f3UserId),
    allowClientAction: allowProductionClientAction,
    findF3Profile: (f3UserId) => findF3ProfileInDb(db, f3UserId),
  });

  return _auth;
}

// Re-exported so tests can construct an isolated in-memory instance without
// duplicating the memoryAdapter pre-seeding dance above.
export { memoryAdapter };
export type { MemoryDB };
