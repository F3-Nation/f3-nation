import type { RequestHeadersPluginContext } from "@orpc/server/plugins";
import { ORPCError, os } from "@orpc/server";

import type { Session } from "@acme/auth";
import type { AppDb } from "@acme/db/client";
import { auth } from "@acme/auth";
import { db } from "@acme/db/client";
import { env } from "@acme/env";

type BaseContext = RequestHeadersPluginContext;

export interface Context {
  session: Session | null;
  db: AppDb;
}

const base = os.$context<BaseContext>();

export const withSessionAndDb = base.use(async ({ context, next }) => {
  const session = await auth();
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

export const apiKeyProcedure = publicProcedure.use(({ context, next }) => {
  const apiKey = context.reqHeaders?.get("x-api-key") ?? "unknown";

  const apiKeyStatus = apiKey === env.SUPER_ADMIN_API_KEY ? "valid" : "invalid";
  if (apiKeyStatus !== "valid") {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({ context });
});
