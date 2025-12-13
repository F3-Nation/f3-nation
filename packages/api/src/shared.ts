import type { RequestHeadersPluginContext } from "@orpc/server/plugins";
import { ORPCError, os } from "@orpc/server";

import type { Session } from "@acme/auth";
import type { AppDb } from "@acme/db/client";
import { auth } from "@acme/auth";
import { and, eq, gt, inArray, isNull, or, schema, sql } from "@acme/db";
import { db } from "@acme/db/client";
import { env } from "@acme/env";

type BaseContext = RequestHeadersPluginContext;

export interface Context {
  session: Session | null;
  db: AppDb;
}

const base = os.$context<BaseContext>();

export const withSessionAndDb = base.use(async ({ context, next }) => {
  const session = await getSession({ context });
  const newContext: Context = { ...context, session, db };
  return next({ context: newContext });
});

export const publicProcedure = withSessionAndDb;

export const protectedProcedure = withSessionAndDb.use(({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({ context });
});

export const editorProcedure = protectedProcedure.use(({ context, next }) => {
  const isEditorOrAdmin = context.session?.roles?.some((r) =>
    ["editor", "admin"].includes(r.roleName),
  );
  if (!isEditorOrAdmin) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({ context });
});

export const adminProcedure = protectedProcedure.use(({ context, next }) => {
  const isAdmin = context.session?.roles?.some((r) => r.roleName === "admin");
  if (!isAdmin) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({ context });
});

export const apiKeyProcedure = publicProcedure.use(
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
  let session = await auth();
  if (session) return session;

  // If there is no session, check for Bearer token ("api key") and attempt to build a replica session
  const authHeader =
    context.reqHeaders?.get("authorization") ??
    context.reqHeaders?.get("Authorization");

  let apiKey: string | null = null;
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    apiKey = authHeader.slice(7).trim();
  }

  if (!apiKey) return null;

  // Get the api key info and associated owner and orgs
  // (to condense: we fetch all matching orgs and aggregate to one object)
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
      orgIds: schema.apiKeys.orgIds,
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

  if (!apiKeyRecord) return null;

  const orgs = apiKeyRecord?.orgIds?.length
    ? await db
        .select({ id: schema.orgs.id, name: schema.orgs.name })
        .from(schema.orgs)
        .where(inArray(schema.orgs.id, apiKeyRecord.orgIds))
    : [];

  const roles =
    orgs.length > 0
      ? orgs.map((o) => ({
          orgId: o.id,
          orgName: o.name,
          roleName: "admin" as const,
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
    // @ts-expect-error - TODO: fix this by allowing apiKey to be optional in the session type
    apiKey: {
      id: apiKeyRecord.apiKeyId,
      key: `${apiKeyRecord.apiKey.slice(0, 4)}...${apiKeyRecord.apiKey.slice(-4)}`,
      ownerId: apiKeyRecord.ownerId,
      revokedAt: apiKeyRecord.revokedAt,
      expiresAt: apiKeyRecord.expiresAt,
      orgIds: apiKeyRecord.orgIds,
    },
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
  };
  return session;
};
