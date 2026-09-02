import type { Session } from "@acme/auth";
import type { UserRole } from "@acme/shared/app/enums";
import { schema, sql } from "@acme/db";
import type { Context } from "./shared";

import { logDebug, logWarn } from "./logger";
import { ORG_TREE_MAX_DEPTH } from "./org-tree";

export const checkHasRoleOnOrg = async ({
  session,
  orgId,
  db,
  roleName,
}: {
  session: Session | null;
  roleName: UserRole;
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

  const hasDirectAccessForThisOrg = session.roles?.some(
    (r) =>
      (r.roleName === "admin" || r.roleName === roleName) && r.orgId === orgId,
  );
  if (hasDirectAccessForThisOrg)
    return {
      success: true,
      orgId: orgId,
      roleName: roleName,
      mode: "direct-permission",
    };

  const ancestors = await db.execute<{
    id: number;
    min_depth: number;
  }>(sql`
    WITH RECURSIVE ancestors(id, parent_id, depth, path) AS (
      SELECT
        ${schema.orgs.id},
        ${schema.orgs.parentId},
        0,
        ARRAY[${schema.orgs.id}]
      FROM ${schema.orgs}
      WHERE ${schema.orgs.id} = ${orgId}

      UNION ALL

      SELECT
        parent.${sql.identifier(schema.orgs.id.name)},
        parent.${sql.identifier(schema.orgs.parentId.name)},
        ancestors.depth + 1,
        ancestors.path || parent.${sql.identifier(schema.orgs.id.name)}
      FROM ${schema.orgs} AS parent
      INNER JOIN ancestors
        ON parent.${sql.identifier(schema.orgs.id.name)} = ancestors.parent_id
      WHERE ancestors.depth <= ${ORG_TREE_MAX_DEPTH}
        AND NOT parent.${sql.identifier(schema.orgs.id.name)} = ANY(ancestors.path)
    )
    SELECT
      id,
      min(depth)::integer AS min_depth
    FROM ancestors
    GROUP BY id
  `);

  if (ancestors.some((org) => org.min_depth > ORG_TREE_MAX_DEPTH)) {
    logWarn("api.org_tree.depth_limit_reached", {
      direction: "ancestors",
      maxDepth: ORG_TREE_MAX_DEPTH,
      rootCount: 1,
      source: "role_check",
    });
  }

  const allAncestorOrgIds = ancestors
    .filter((org) => org.min_depth <= ORG_TREE_MAX_DEPTH)
    .map((org) => org.id);

  const matchingPermission = session.roles?.find(
    (r) =>
      (r.roleName === "admin" || r.roleName === roleName) &&
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

  return { success: false, orgId, roleName, mode: "no-permission" };
};
