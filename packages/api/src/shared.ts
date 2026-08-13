import { MemoryRatelimiter } from "@orpc/experimental-ratelimit/memory";
import { ORPCError, os } from "@orpc/server";
import type { RequestHeadersPluginContext } from "@orpc/server/plugins";
import { createRemoteJWKSet, jwtVerify } from "jose";

import type { Session } from "@acme/auth";
import { auth } from "@acme/auth";
import { and, eq, gt, isNull, or, schema, sql } from "@acme/db";
import type { AppDb } from "@acme/db/client";
import { db } from "@acme/db/client";
import { env } from "@acme/env";
import { isNationAdminFromSession } from "@acme/shared/app/role-checks";
import { isDevelopment } from "@acme/shared/common/constants";
import { Client, Header } from "@acme/shared/common/enums";

import { logWarn } from "./logger";

type BaseContext = RequestHeadersPluginContext;

export interface Context {
  session: Session | null;
  db: AppDb;
}

/**
 * Returns a mock session for development mode.
 * This allows the app to work without an API key when running locally.
 * The mock session has admin access to all endpoints.
 */
const getDevMockSession = (): Session => ({
  id: 0,
  email: "dev@localhost",
  roles: [],
  user: {
    id: "0",
    email: "dev@localhost",
    name: "Dev User",
    roles: [],
  },
  expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString(),
});

// Rate limit configuration
// WARNING: This is an in-memory rate limiter. In multi-instance deployments
// (k8s, serverless, etc.), each instance maintains separate counters.
// Effective limit = RATE_LIMIT_MAX_REQUESTS * number_of_instances.
// For true distributed rate limiting, use Redis/Upstash instead.
const RATE_LIMIT_WINDOW_MS = 60000; // 60 seconds
const RATE_LIMIT_MAX_REQUESTS = isDevelopment ? 10000 : 200;

// Keep expiry checks anchored to one canonical DB clock source to avoid
// app-server clock skew and cross-check inconsistencies.
const DB_NOW = sql`timezone('utc'::text, now())`;

// The auth server's base URL (e.g. https://auth.f3nation.com).
// Read from process.env to avoid t3-env client/server type mismatch.
const authIssuer = process.env.NEXT_PUBLIC_AUTH_URL ?? null;

// Cached JWKS fetcher for f3-nation-auth JWT verification.
// jose caches the key set automatically after the first fetch.
const authJwks = authIssuer
  ? createRemoteJWKSet(new URL(`${authIssuer}/.well-known/jwks.json`))
  : null;

const limiter = new MemoryRatelimiter({
  maxRequests: RATE_LIMIT_MAX_REQUESTS,
  window: RATE_LIMIT_WINDOW_MS,
});

/**
 * Extract client IP from request headers.
 * Handles x-forwarded-for chains by taking the first (client) IP.
 */
const getClientIP = (headers: Headers | null): string => {
  const forwarded = headers?.get("x-forwarded-for");
  if (forwarded) {
    // Take first IP in chain (closest to client)
    // x-forwarded-for format: "client, proxy1, proxy2"
    const firstIP = forwarded.split(",")[0]?.trim();
    if (firstIP) return firstIP;
  }
  return headers?.get("x-real-ip") ?? "anonymous";
};

const base = os.$context<BaseContext>().use(async ({ context, next }) => {
  const key = getClientIP(context.reqHeaders ?? null);

  const result = await limiter.limit(key);

  if (!result.success) {
    const retryAfterMs = result.reset
      ? result.reset - Date.now()
      : RATE_LIMIT_WINDOW_MS;
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message: `Rate limit exceeded. Try again in ${Math.ceil(retryAfterMs / 1000)}s`,
    });
  }

  return next({ context });
});

const withSessionAndDb = base.use(async ({ context, next }) => {
  const session = await getSession({ context });
  const newContext: Context = { ...context, session, db };
  return next({ context: newContext });
});

export const publicProcedure = base;

export const protectedProcedure = withSessionAndDb.use(({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({ context });
});

export const editorProcedure = withSessionAndDb.use(({ context, next }) => {
  const isEditorOrAdmin = context.session?.roles?.some((r) =>
    ["editor", "admin"].includes(r.roleName),
  );
  if (!isEditorOrAdmin) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({ context });
});

export const adminProcedure = withSessionAndDb.use(({ context, next }) => {
  const isAdmin = context.session?.roles?.some((r) => r.roleName === "admin");
  if (!isAdmin) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({ context });
});

/**
 * Allows either SUPER_ADMIN_API_KEY (x-api-key header) OR authenticated session
 * with nation admin role. Used for the revalidate endpoint.
 */
export const revalidateAuthProcedure = withSessionAndDb.use(
  ({ context, next }) => {
    const apiKey = context.reqHeaders?.get("x-api-key") ?? "";
    if (env.SUPER_ADMIN_API_KEY && apiKey === env.SUPER_ADMIN_API_KEY) {
      return next({ context });
    }

    // No valid API key - require session with nation admin role
    if (!context.session?.user) {
      throw new ORPCError("UNAUTHORIZED");
    }

    if (!isNationAdminFromSession(context.session)) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "You are not authorized to revalidate this Nation",
      });
    }

    return next({ context });
  },
);

export const nationAdminProcedure = withSessionAndDb.use(
  ({ context, next }) => {
    if (!isNationAdminFromSession(context.session)) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "This action requires F3 Nation admin privileges",
      });
    }
    return next({ context });
  },
);

const getSession = async ({ context }: { context: BaseContext }) => {
  let session: Session | null = null;

  // Skip auth() call for SSG requests to allow static generation
  // The SSG client uses API key auth instead of session auth
  const isSSGRequest =
    context.reqHeaders?.get(Header.Client) === Client.ORPC_SSG;
  if (!isSSGRequest) {
    session = await auth();
    if (session) return session;
  }

  // Extract bearer token from Authorization header
  const authHeader =
    context.reqHeaders?.get(Header.Authorization) ??
    context.reqHeaders?.get(Header.Authorization.toLowerCase());

  let bearerToken: string | null = null;
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    bearerToken = authHeader.slice(7).trim();
  }

  // No session or bearer token provided
  if (!bearerToken) {
    if (isDevelopment) return getDevMockSession();
    return null;
  }

  // -----------------------------------------------------------------------
  // Try f3-nation-auth JWT (RS256, verified via remote JWKS)
  // -----------------------------------------------------------------------
  session = await getSessionFromJWT(bearerToken);
  if (session) return session;

  // -----------------------------------------------------------------------
  // Try API key auth (Scalar, scripts, custom apps)
  // -----------------------------------------------------------------------
  const appClient = context.reqHeaders?.get(Header.Client);

  if (!appClient) {
    throw new ORPCError("UNAUTHORIZED", {
      message:
        "Invalid or expired bearer token. Or, if using API Key auth, ensure the 'client' header is set.",
    });
  }

  const [apiKeyRecord] = await db
    .select({
      apiKeyId: schema.apiKeys.id,
      ownerId: schema.apiKeys.ownerId,
      apiKey: schema.apiKeys.key,
      userId: schema.users.id,
      email: schema.users.email,
      f3Name: schema.users.f3Name,
      revokedAt: schema.apiKeys.revokedAt,
      expiresAt: schema.apiKeys.expiresAt,
    })
    .from(schema.apiKeys)
    .innerJoin(schema.users, eq(schema.users.id, schema.apiKeys.ownerId))
    .where(
      and(
        eq(schema.apiKeys.key, bearerToken),
        isNull(schema.apiKeys.revokedAt),
        or(
          isNull(schema.apiKeys.expiresAt),
          gt(schema.apiKeys.expiresAt, DB_NOW),
        ),
      ),
    );

  if (!apiKeyRecord) {
    logWarn("api.auth.api_key_not_found", {
      apiKey: `${bearerToken.slice(0, 4)}...${bearerToken.slice(-4)}`,
      appClient,
    });
    return null;
  }

  // Get orgs and roles associated with this API key via join table
  const orgRoles = await db
    .select({
      orgId: schema.orgs.id,
      orgName: schema.orgs.name,
      roleName: schema.roles.name,
    })
    .from(schema.rolesXApiKeysXOrg)
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.rolesXApiKeysXOrg.orgId))
    .innerJoin(
      schema.roles,
      eq(schema.roles.id, schema.rolesXApiKeysXOrg.roleId),
    )
    .where(eq(schema.rolesXApiKeysXOrg.apiKeyId, apiKeyRecord.apiKeyId));

  const roles =
    orgRoles.length > 0
      ? orgRoles.map((or) => ({
          orgId: or.orgId,
          orgName: or.orgName,
          roleName: or.roleName,
        }))
      : [];

  session = {
    id: apiKeyRecord.userId,
    email: apiKeyRecord.email ?? undefined,
    roles,
    user: {
      id: apiKeyRecord.ownerId?.toString() ?? undefined,
      email: apiKeyRecord.email ?? undefined,
      name: apiKeyRecord.f3Name ?? undefined,
      roles,
    },
    apiKey: {
      id: apiKeyRecord.apiKeyId,
      key: `${apiKeyRecord.apiKey.slice(0, 4)}...${apiKeyRecord.apiKey.slice(-4)}`,
      ownerId: apiKeyRecord.ownerId,
      revokedAt: apiKeyRecord.revokedAt,
      expiresAt: apiKeyRecord.expiresAt,
      orgIds: orgRoles.map((or) => or.orgId),
    },
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
  };
  return session;
};

/**
 * Resolve a session from an f3-nation-auth RS256 JWT access token.
 * Verifies the token signature via remote JWKS, then fetches the user's
 * roles from roles_x_users_x_org.
 * Returns null if JWKS is not configured, or the token is invalid/expired.
 */
async function getSessionFromJWT(token: string): Promise<Session | null> {
  if (!authJwks) return null;

  let payload;
  try {
    const result = await jwtVerify(token, authJwks, {
      issuer: authIssuer ?? undefined,
      algorithms: ["RS256"],
    });
    payload = result.payload;
  } catch {
    return null;
  }

  // ID Tokens share this issuer's signing key and protected header with
  // access tokens, so signature + issuer alone doesn't tell them apart —
  // without this check, an ID Token (meant to be safe to expose to
  // client-side code, id_token_hint query strings, and logs) would work
  // as a fully privileged API credential here.
  if (payload.token_use !== "access") return null;

  const userId = Number(payload.sub);
  if (!userId) return null;

  // Look up the user to get their current email and f3Name
  const [user] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      f3Name: schema.users.f3Name,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!user) return null;

  // Fetch user roles (same pattern as PR #184's getSessionFromOAuthToken)
  const userRoles = await db
    .select({
      orgId: schema.orgs.id,
      orgName: schema.orgs.name,
      roleName: schema.roles.name,
    })
    .from(schema.rolesXUsersXOrg)
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.rolesXUsersXOrg.orgId))
    .innerJoin(schema.roles, eq(schema.roles.id, schema.rolesXUsersXOrg.roleId))
    .where(eq(schema.rolesXUsersXOrg.userId, userId));

  const roles = userRoles.map((r) => ({
    orgId: r.orgId,
    orgName: r.orgName,
    roleName: r.roleName,
  }));

  return {
    id: user.id,
    email: user.email,
    roles,
    user: {
      id: user.id.toString(),
      email: user.email,
      name: user.f3Name ?? undefined,
      roles,
    },
    expires: new Date((payload.exp ?? 0) * 1000).toISOString(),
  };
}
