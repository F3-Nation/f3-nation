import { ORPCError } from "@orpc/server";

import { eq, schema } from "@acme/db";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import type { Context } from "../shared";

export async function getEventInstanceOrgId(
  db: Context["db"],
  eventInstanceId: number,
): Promise<number | null> {
  const [eventInstance] = await db
    .select({ orgId: schema.eventInstances.orgId })
    .from(schema.eventInstances)
    .where(eq(schema.eventInstances.id, eventInstanceId));

  return eventInstance?.orgId ?? null;
}

export async function requireEventInstanceOrgId(
  db: Context["db"],
  eventInstanceId: number,
): Promise<number> {
  const orgId = await getEventInstanceOrgId(db, eventInstanceId);

  if (orgId == null) {
    throw new ORPCError("NOT_FOUND", {
      message: "Event instance not found",
    });
  }

  return orgId;
}

export async function assertEditorOnEventOrg({
  ctx,
  eventInstanceId,
  message = "You are not authorized to perform this action",
}: {
  ctx: Context;
  eventInstanceId: number;
  message?: string;
}): Promise<{ orgId: number }> {
  const orgId = await requireEventInstanceOrgId(ctx.db, eventInstanceId);

  const { success } = await checkHasRoleOnOrg({
    session: ctx.session,
    orgId,
    db: ctx.db,
    roleName: "editor",
  });

  if (!success) {
    throw new ORPCError("UNAUTHORIZED", { message });
  }

  return { orgId };
}

export async function assertSelfOrEditorOnEventOrg({
  ctx,
  eventInstanceId,
  targetUserId,
  message = "You are not authorized to perform this action",
}: {
  ctx: Context;
  eventInstanceId: number;
  targetUserId: number;
  message?: string;
}): Promise<{ orgId: number }> {
  const orgId = await requireEventInstanceOrgId(ctx.db, eventInstanceId);

  if (Number(ctx.session?.id) === targetUserId) {
    return { orgId };
  }

  const { success } = await checkHasRoleOnOrg({
    session: ctx.session,
    orgId,
    db: ctx.db,
    roleName: "editor",
  });

  if (!success) {
    throw new ORPCError("UNAUTHORIZED", { message });
  }

  return { orgId };
}
