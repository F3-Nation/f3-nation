import { eq } from "drizzle-orm";

import type { RegionRole } from "@acme/shared/app/enums";

import type { AppDb } from "../client";
import { orgs, roles, rolesXUsersXOrg } from "../../drizzle/schema";

export interface UserRoleRow {
  orgId: number;
  orgName: string;
  roleName: RegionRole;
}

/**
 * A user's roles across every org, keyed to what isNationAdminFromSession
 * (packages/shared/src/app/role-checks.ts) and Session.roles both expect.
 * The one place this query lives — packages/api's getSessionFromJWT and
 * apps/auth's isNationAdminForUser both call it instead of each keeping
 * their own copy.
 */
export async function getUserRoles(
  db: AppDb,
  userId: number,
): Promise<UserRoleRow[]> {
  return db
    .select({
      orgId: orgs.id,
      orgName: orgs.name,
      roleName: roles.name,
    })
    .from(rolesXUsersXOrg)
    .innerJoin(orgs, eq(orgs.id, rolesXUsersXOrg.orgId))
    .innerJoin(roles, eq(roles.id, rolesXUsersXOrg.roleId))
    .where(eq(rolesXUsersXOrg.userId, userId));
}
