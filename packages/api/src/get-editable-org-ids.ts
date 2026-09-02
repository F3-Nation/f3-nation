import { eq, inArray, schema, sql } from "@acme/db";

import type { OrgType } from "../../shared/src/app/enums";
import { logDebug, logWarn } from "./logger";
import { ORG_TREE_MAX_DEPTH } from "./org-tree";
import type { Context } from "./shared";

/**
 * Get the organization IDs that a user can edit
 *
 * @param ctx - The ORPC context containing the database and session
 * @returns Editable orgs (including direct AO role roots), validated direct role roots, and the preserved nation-wide access flag
 */
export const getEditableOrgIdsForUser = async (
  ctx: Context,
): Promise<{
  editableOrgs: { id: number; type: OrgType }[];
  editableRootOrgIds: number[];
  isNationAdmin: boolean;
}> => {
  if (!ctx.session?.user) {
    return {
      editableOrgs: [],
      editableRootOrgIds: [],
      isNationAdmin: false,
    };
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
    return {
      editableOrgs: [],
      editableRootOrgIds: [],
      isNationAdmin: false,
    };
  }

  const roleRootOrgIds = [
    ...new Set(rolesWithEditPermission.map((role) => role.orgId)),
  ];

  // First check if user is a nation admin - if so, we don't need to filter
  const nationOrgs = await ctx.db
    .select({
      id: schema.orgs.id,
      orgType: schema.orgs.orgType,
    })
    .from(schema.orgs)
    .where(eq(schema.orgs.orgType, "nation"));

  const nationOrgIds = nationOrgs.map((org) => org.id);

  // Preserve existing nation-wide access for both admin and editor assignments.
  const isNationAdmin = rolesWithEditPermission.some(
    (role) =>
      (role.roleName === "admin" || role.roleName === "editor") &&
      nationOrgIds.includes(role.orgId),
  );

  if (isNationAdmin) {
    // Nation-level roles receive unfiltered results from scoped callers.
    return { editableOrgs: [], editableRootOrgIds: [], isNationAdmin: true };
  }

  const editableRows = await ctx.db.execute<{
    id: number;
    type: OrgType;
    min_depth: number;
  }>(sql`
    WITH RECURSIVE editable_orgs(id, org_type, depth, path) AS (
      SELECT
        ${schema.orgs.id},
        ${schema.orgs.orgType},
        0,
        ARRAY[${schema.orgs.id}]
      FROM ${schema.orgs}
      WHERE ${inArray(schema.orgs.id, roleRootOrgIds)}

      UNION ALL

      SELECT
        child.${sql.identifier(schema.orgs.id.name)},
        child.${sql.identifier(schema.orgs.orgType.name)},
        editable_orgs.depth + 1,
        editable_orgs.path || child.${sql.identifier(schema.orgs.id.name)}
      FROM ${schema.orgs} AS child
      INNER JOIN editable_orgs
        ON child.${sql.identifier(schema.orgs.parentId.name)} = editable_orgs.id
      WHERE editable_orgs.depth <= ${ORG_TREE_MAX_DEPTH}
        AND child.${sql.identifier(schema.orgs.orgType.name)} <> ${"ao"}
        AND NOT child.${sql.identifier(schema.orgs.id.name)} = ANY(editable_orgs.path)
    )
    SELECT
      id,
      org_type AS type,
      min(depth)::integer AS min_depth
    FROM editable_orgs
    GROUP BY id, org_type
  `);

  if (editableRows.some((org) => org.min_depth > ORG_TREE_MAX_DEPTH)) {
    logWarn("api.org_tree.depth_limit_reached", {
      direction: "descendants",
      maxDepth: ORG_TREE_MAX_DEPTH,
      rootCount: roleRootOrgIds.length,
      source: "editable_orgs",
    });
  }

  const withinDepthRows = editableRows.filter(
    (org) => org.min_depth <= ORG_TREE_MAX_DEPTH,
  );
  const editableRootOrgIds = roleRootOrgIds.filter((rootId) =>
    withinDepthRows.some((org) => org.id === rootId && org.min_depth === 0),
  );
  const editableOrgs = withinDepthRows.map(({ id, type }) => ({ id, type }));

  logDebug("api.get_editable_org_ids", {
    editableOrgsCount: editableOrgs.length,
  });

  return {
    editableOrgs,
    editableRootOrgIds,
    isNationAdmin: false,
  };
};
