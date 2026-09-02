import { inArray, schema, sql } from "@acme/db";

import { logError } from "./logger";
import { ORG_TREE_MAX_DEPTH } from "./org-tree";
import type { Context } from "./shared";

/**
 * Get all descendant organization IDs for the given parent org IDs.
 * Uses a recursive CTE to traverse the org hierarchy with a bounded depth.
 *
 * @param db - Database context
 * @param parentOrgIds - Array of parent organization IDs
 * @returns Array of descendant org IDs, including existing parent orgs, within the configured depth bound; order is unspecified
 */
export const getDescendantOrgIds = async (
  db: Context["db"],
  parentOrgIds: number[],
): Promise<number[]> => {
  if (parentOrgIds.length === 0) {
    return [];
  }

  const descendants = await db.execute<{
    id: number;
    min_depth: number;
  }>(sql`
    WITH RECURSIVE descendants(id, depth, path) AS (
      SELECT ${schema.orgs.id}, 0, ARRAY[${schema.orgs.id}]
      FROM ${schema.orgs}
      WHERE ${inArray(schema.orgs.id, parentOrgIds)}

      UNION ALL

      SELECT
        child.${sql.identifier(schema.orgs.id.name)},
        descendants.depth + 1,
        descendants.path || child.${sql.identifier(schema.orgs.id.name)}
      FROM ${schema.orgs} AS child
      INNER JOIN descendants
        ON child.${sql.identifier(schema.orgs.parentId.name)} = descendants.id
      WHERE descendants.depth <= ${ORG_TREE_MAX_DEPTH}
        AND NOT child.${sql.identifier(schema.orgs.id.name)} = ANY(descendants.path)
    )
    SELECT
      id,
      min(depth)::integer AS min_depth
    FROM descendants
    GROUP BY id
  `);

  if (descendants.some((org) => org.min_depth > ORG_TREE_MAX_DEPTH)) {
    logError("api.org_tree.depth_limit_reached", {
      direction: "descendants",
      maxDepth: ORG_TREE_MAX_DEPTH,
      rootCount: parentOrgIds.length,
      source: "descendant_orgs",
    });
  }

  return descendants
    .filter((org) => org.min_depth <= ORG_TREE_MAX_DEPTH)
    .map((org) => org.id);
};
