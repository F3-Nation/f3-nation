import type { UserRole } from "@acme/shared/app/enums";
import { eq, schema } from "@acme/db";

import type { Context } from "./shared";

export interface SessionRole {
  orgId: number;
  roleName: UserRole;
}

/**
 * The role assignments that scope what the caller may see. An API key's
 * `session.id` is its owner, so keys use `session.roles`, which holds only the
 * roles granted to the key. User sessions read their current roles from the
 * database rather than roles captured at sign-in.
 */
export const getSessionRoles = async (ctx: Context): Promise<SessionRole[]> => {
  const session = ctx.session;
  if (!session?.user) return [];
  if (session.apiKey) return session.roles ?? [];

  return ctx.db
    .select({
      orgId: schema.rolesXUsersXOrg.orgId,
      roleName: schema.roles.name,
    })
    .from(schema.rolesXUsersXOrg)
    .innerJoin(schema.roles, eq(schema.rolesXUsersXOrg.roleId, schema.roles.id))
    .where(eq(schema.rolesXUsersXOrg.userId, session.id));
};
