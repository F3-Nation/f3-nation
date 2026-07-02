import type { Session } from "@acme/auth";
import type { UserRole } from "@acme/shared/app/enums";
import { aliasedTable, eq, schema } from "@acme/db";
import type { Context } from "./shared";

import { logDebug } from "./logger";

/**
 * Check if a role matches the requested role name.
 * Returns true if:
 * - No specific role is required (roleName is undefined), OR
 * - The role is "admin" (admin has access to everything), OR
 * - The role exactly matches the requested roleName
 */
function matchesRoleName(
  roleNameToCheck: UserRole,
  requestedRoleName: UserRole | undefined,
): boolean {
  return (
    requestedRoleName === undefined ||
    roleNameToCheck === "admin" ||
    roleNameToCheck === requestedRoleName
  );
}

export const checkHasRoleOnOrg = async ({
  session,
  orgId,
  db,
  roleName,
}: {
  session: Session | null;
  /** Role required on the org. Omit to accept any role (direct or ancestor). */
  roleName?: UserRole;
  orgId: number;
  db: Context["db"];
}): Promise<{
  success: boolean;
  orgId: number | null;
  roleName: UserRole | null;
  mode: "direct-permission" | "org-admin" | "no-permission";
}> => {
  if (!session) {
    return {
      success: false,
      orgId: null,
      roleName: null,
      mode: "no-permission",
    };
  }

  logDebug("api.role_check.checking", {
    userId: session.id,
    orgId,
    roleName,
    roles: session.roles,
  });

  const directMatch = session.roles?.find(
    (r) => matchesRoleName(r.roleName, roleName) && r.orgId === orgId,
  );
  if (directMatch)
    return {
      success: true,
      orgId: orgId,
      roleName: directMatch.roleName,
      mode: "direct-permission",
    };

  // Next, see if the user has a role for an org that is a parent or ancestor of the org in question
  // Assume the org is an AO and trace up the hierarchy
  const level1Org = aliasedTable(schema.orgs, "level_1_org"); // AO
  const level2Org = aliasedTable(schema.orgs, "level_2_org"); // Region
  const level3Org = aliasedTable(schema.orgs, "level_3_org"); // Sector
  const level4Org = aliasedTable(schema.orgs, "level_4_org"); // Area
  const level5Org = aliasedTable(schema.orgs, "level_5_org"); // Nation

  // TS6.0: aliasedTable complex conditional types require explicit annotation
  const allParentOrgIds = (await db
    .select({
      level1Id: level1Org.id,
      level2Id: level2Org.id,
      level3Id: level3Org.id,
      level4Id: level4Org.id,
      level5Id: level5Org.id,
    })
    .from(level1Org)
    .leftJoin(level2Org, eq(level1Org.parentId, level2Org.id))
    .leftJoin(level3Org, eq(level2Org.parentId, level3Org.id))
    .leftJoin(level4Org, eq(level3Org.parentId, level4Org.id))
    .leftJoin(level5Org, eq(level4Org.parentId, level5Org.id))
    .where(eq(level1Org.id, orgId))) as {
    level1Id: number;
    level2Id: number | null;
    level3Id: number | null;
    level4Id: number | null;
    level5Id: number | null;
  }[];

  const allAncestorOrgIds = allParentOrgIds.flatMap((o) => [
    o.level1Id,
    o.level2Id,
    o.level3Id,
    o.level4Id,
    o.level5Id,
  ]) as number[];

  const matchingPermission = session.roles?.find(
    (r) =>
      matchesRoleName(r.roleName, roleName) &&
      allAncestorOrgIds.includes(r.orgId),
  );

  if (matchingPermission) {
    return {
      success: true,
      orgId: matchingPermission.orgId,
      roleName: matchingPermission.roleName,
      mode: "org-admin",
    };
  }

  return { success: false, orgId: null, roleName: null, mode: "no-permission" };
};
