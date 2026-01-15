import { MemoryRatelimiter } from "@orpc/experimental-ratelimit/memory";
import { ORPCError, os } from "@orpc/server";
import type { RequestHeadersPluginContext } from "@orpc/server/plugins";

import type { Session } from "@acme/auth";
import { auth } from "@acme/auth";
import { and, eq, gt, isNull, or, schema, sql } from "@acme/db";
import type { AppDb } from "@acme/db/client";
import { db } from "@acme/db/client";
import { env } from "@acme/env";
import { Client, Header } from "@acme/shared/common/enums";

type BaseContext = RequestHeadersPluginContext;

export interface Context {
  session: Session | null;
  db: AppDb;
}

const isDev = process.env.NODE_ENV === "development";

// Rate limit configuration
// WARNING: This is an in-memory rate limiter. In multi-instance deployments
// (k8s, serverless, etc.), each instance maintains separate counters.
// Effective limit = RATE_LIMIT_MAX_REQUESTS * number_of_instances.
// For true distributed rate limiting, use Redis/Upstash instead.
const RATE_LIMIT_WINDOW_MS = 60000; // 60 seconds
const RATE_LIMIT_MAX_REQUESTS = isDev ? 10000 : 200;

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

export const withSessionAndDb = base.use(async ({ context, next }) => {
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

export const apiKeyProcedure = withSessionAndDb.use(
  async ({ context, next }) => {
    const apiKey = context.reqHeaders?.get("x-api-key") ?? "";

    if (!apiKey) {
      throw new ORPCError("UNAUTHORIZED");
    }

    if (env.SUPER_ADMIN_API_KEY && apiKey === env.SUPER_ADMIN_API_KEY) {
      return next({ context });
    }

    const [dbKey] = await context.db
      .select({ id: schema.apiKeys.id })
      .from(schema.apiKeys)
      .where(
        and(
          eq(schema.apiKeys.key, apiKey),
          isNull(schema.apiKeys.revokedAt),
          or(
            isNull(schema.apiKeys.expiresAt),
            gt(schema.apiKeys.expiresAt, sql`timezone('utc'::text, now())`),
          ),
        ),
      )
      .limit(1);

    if (!dbKey) {
      throw new ORPCError("UNAUTHORIZED");
    }

    return next({ context });
  },
);

export const getSession = async ({ context }: { context: BaseContext }) => {
  let session: Session | null = null;

  // Skip auth() call for SSG requests to allow static generation
  // The SSG client uses API key auth instead of session auth
  const isSSGRequest =
    context.reqHeaders?.get(Header.Client) === Client.ORPC_SSG;
  if (!isSSGRequest) {
    session = await auth();
    if (session) return session;
  }

  // If there is no session, check for Bearer token ("api key") and attempt to build a replica session
  const authHeader =
    context.reqHeaders?.get(Header.Authorization) ??
    context.reqHeaders?.get(Header.Authorization.toLowerCase());

  const appClient = context.reqHeaders?.get(Header.Client);

  let apiKey: string | null = null;
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    apiKey = authHeader.slice(7).trim();
  }

  // No session or API key provided - return with no session
  if (!apiKey) return null;

  // API key provided but no client header
  if (apiKey && !appClient) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "You must provide a client header when using an API key",
    });
  }

  // Get the api key info and associated owner and orgs
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
        eq(schema.apiKeys.key, apiKey),
        isNull(schema.apiKeys.revokedAt),
        or(
          isNull(schema.apiKeys.expiresAt),
          gt(schema.apiKeys.expiresAt, sql`timezone('utc'::text, now())`),
        ),
      ),
    );

  if (!apiKeyRecord) {
    if (apiKey) {
      console.log("getSession", {
        apiKey: apiKey ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : null,
        appClient,
        message: "API key not found in database or invalid",
      });
    }
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
