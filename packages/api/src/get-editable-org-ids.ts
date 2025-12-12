import { aliasedTable, and, eq, inArray, not, schema } from "@acme/db";

import type { OrgType } from "../../shared/src/app/enums";
import type { Context } from "./shared";

/**
 * Get the organization IDs that a user can edit
 *
 * @param ctx - The ORPC context containing the database and session
 * @returns An object with editable region IDs and a flag indicating if user has nation-level admin privileges
 */
export const getEditableOrgIdsForUser = async (
  ctx: Context,
): Promise<{
  editableOrgs: { id: number; type: OrgType }[];
  isNationAdmin: boolean;
}> => {
  if (!ctx.session?.user) {
    return { editableOrgs: [], isNationAdmin: false };
  }

  const userRoles = await ctx.db
    .select({
      roleName: schema.roles.name,
      orgId: schema.rolesXUsersXOrg.orgId,
    })
    .from(schema.rolesXUsersXOrg)
    .innerJoin(schema.roles, eq(schema.rolesXUsersXOrg.roleId, schema.roles.id))
    .where(eq(schema.rolesXUsersXOrg.userId, ctx.session.id));

  const rolesWithEditPermission = userRoles.filter(
    (role) => role.roleName === "admin" || role.roleName === "editor",
  );

  if (rolesWithEditPermission.length === 0) {
    // No roles with edit permissions (neither admin nor editor)
    return { editableOrgs: [], isNationAdmin: false };
  }

  // First check if user is a nation admin - if so, we don't need to filter
  const nationOrgs = await ctx.db
    .select({
      id: schema.orgs.id,
      orgType: schema.orgs.orgType,
    })
    .from(schema.orgs)
    .where(eq(schema.orgs.orgType, "nation"));

  const nationOrgIds = nationOrgs.map((org) => org.id);

  // Check if the user has admin rights on any nation (must be admin, not just editor)
  const isNationAdmin = rolesWithEditPermission.some(
    (role) =>
      (role.roleName === "admin" || role.roleName === "editor") &&
      nationOrgIds.includes(role.orgId),
  );

  if (isNationAdmin) {
    // Nation admins can see all requests, so we don't need to filter by region
    return { editableOrgs: [], isNationAdmin: true };
  }

  // Get all org relationships to build a hierarchy
  const level0Orgs = aliasedTable(schema.orgs, "level0_orgs");
  const level1Orgs = aliasedTable(schema.orgs, "level1_orgs");
  const level2Orgs = aliasedTable(schema.orgs, "level2_orgs");
  const allOrgs = await ctx.db
    .select({
      level0OrgId: level0Orgs.id,
      level0OrgType: level0Orgs.orgType,
      level1OrgId: level1Orgs.id,
      level1OrgType: level1Orgs.orgType,
      level2OrgId: level2Orgs.id,
      level2OrgType: level2Orgs.orgType,
    })
    .from(level0Orgs)
    .leftJoin(
      level1Orgs,
      and(
        eq(level0Orgs.id, level1Orgs.parentId),
        not(eq(level1Orgs.orgType, "ao")),
      ),
    )
    .leftJoin(
      level2Orgs,
      and(
        eq(level1Orgs.id, level2Orgs.parentId),
        not(eq(level2Orgs.orgType, "ao")),
      ),
    )
    .where(
      inArray(
        level0Orgs.id,
        rolesWithEditPermission.map((r) => r.orgId),
      ),
    );

  const editableOrgs = allOrgs
    .flatMap((orgData) => [
      { id: orgData.level0OrgId, type: orgData.level0OrgType },
      { id: orgData.level1OrgId, type: orgData.level1OrgType },
      { id: orgData.level2OrgId, type: orgData.level2OrgType },
    ])
    .filter((org, idx, arr) => {
      const found = arr.findIndex((o) => o.id === org.id);
      return found === idx;
    });

  console.log("getEditableOrgIdsForUser", {
    editableOrgs,
    editableOrgsCount: editableOrgs.length,
  });

  return {
    editableOrgs,
    isNationAdmin: false,
  };
};
