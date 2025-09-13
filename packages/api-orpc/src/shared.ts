import { ORPCError, os } from "@orpc/server";

import type { Session } from "@acme/auth";
import type { AppDb } from "@acme/db/client";
import { auth } from "@acme/auth";
import { db } from "@acme/db/client";

type BaseContext = object;

export interface AppContext {
  session: Session | null;
  db: AppDb;
}

const base = os.$context<BaseContext>();

export const withSessionAndDb = base.use(async ({ context, next }) => {
  const session = await auth();
  const newContext: AppContext = { ...context, session, db };
  return next({ context: newContext });
});

export const publicOp = withSessionAndDb;

export const protectedOp = withSessionAndDb.use(({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({ context });
});

export const editorOp = protectedOp.use(({ context, next }) => {
  const isEditorOrAdmin = context.session?.roles?.some((r) =>
    ["editor", "admin"].includes(r.roleName),
  );
  if (!isEditorOrAdmin) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({ context });
});

export const adminOp = protectedOp.use(({ context, next }) => {
  const isAdmin = context.session?.roles?.some((r) => r.roleName === "admin");
  if (!isAdmin) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({ context });
});
