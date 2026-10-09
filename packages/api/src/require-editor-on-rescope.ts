import { ORPCError } from "@orpc/server";

import { eq, schema } from "@acme/db";

import { checkHasRoleOnOrg } from "./check-has-role-on-org";
import type { Context } from "./shared";

/**
 * Authorizes a create or a possible move between orgs. A move both removes
 * the row from its current org and adds it to the target, so on update the
 * caller needs editor on both ends; on create, only the target.
 */
export const requireEditorOnRescope = async ({
  ctx,
  currentOrgId,
  targetOrgId,
  entity,
}: {
  ctx: Context;
  currentOrgId: number | null | undefined;
  targetOrgId: number;
  entity: string;
}): Promise<void> => {
  const isEditorOn = async (orgId: number) =>
    (
      await checkHasRoleOnOrg({
        orgId,
        session: ctx.session,
        db: ctx.db,
        roleName: "editor",
      })
    ).success;

  const [target] = await ctx.db
    .select({ id: schema.orgs.id })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, targetOrgId));
  if (!target) {
    throw new ORPCError("NOT_FOUND", { message: "Organization not found" });
  }

  if (currentOrgId == null) {
    if (!(await isEditorOn(targetOrgId))) {
      throw new ORPCError("UNAUTHORIZED", {
        message: `You are not authorized to create this ${entity}`,
      });
    }
    return;
  }

  if (!(await isEditorOn(currentOrgId))) {
    throw new ORPCError("UNAUTHORIZED", {
      message: `You are not authorized to update this ${entity}`,
    });
  }
  if (currentOrgId !== targetOrgId && !(await isEditorOn(targetOrgId))) {
    throw new ORPCError("UNAUTHORIZED", {
      message: `You are not authorized to move this ${entity} to the destination organization`,
    });
  }
};
