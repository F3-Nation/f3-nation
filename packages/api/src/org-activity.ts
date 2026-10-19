import type { AnyColumn } from "@acme/db";
import { notExists, schema, sql } from "@acme/db";
import { ORG_TREE_MAX_DEPTH } from "@acme/shared/app/org-hierarchy";

/**
 * Deactivating a non-AO organization leaves its descendants active, so public
 * reads must check their ancestor chain as well as their own activity.
 *
 * Build the set of inactive organizations and their descendants, then
 * compare the outer row against it. Keeping the outer column out of the
 * recursive CTE lets PostgreSQL plan a join instead of repeating an ancestor
 * walk per row. Keep this inline SQL to avoid a database round trip per row.
 *
 * Paths stop at cycles. The walk generates one level past the shared depth
 * limit and discards it, matching checkHasRoleOnOrg/getDescendantOrgIds.
 * Callers must also invoke the throttled logIfOrgTreeExceedsMaxDepth scan in
 * org-tree.ts, since inactive ancestors beyond that limit are not checked.
 */
const hasNoInactiveOrg = (orgIdColumn: AnyColumn, includeSelf: boolean) => {
  const orgId = sql.identifier(schema.orgs.id.name);
  const parentId = sql.identifier(schema.orgs.parentId.name);

  // notExists splices SQL directly, so the WITH subquery needs explicit parens.
  return notExists(sql`(
    SELECT 1 FROM (
      WITH RECURSIVE tainted(id, depth, path) AS (
        SELECT
          ${schema.orgs.id},
          0,
          ARRAY[${schema.orgs.id}]
        FROM ${schema.orgs}
        WHERE ${schema.orgs.isActive} = false

        UNION ALL

        SELECT
          child.${orgId},
          tainted.depth + 1,
          tainted.path || child.${orgId}
        FROM ${schema.orgs} AS child
        INNER JOIN tainted ON child.${parentId} = tainted.id
        WHERE tainted.depth <= ${ORG_TREE_MAX_DEPTH}
          AND NOT child.${orgId} = ANY(tainted.path)
      )
      SELECT id FROM tainted
      WHERE depth >= ${includeSelf ? 0 : 1} AND depth <= ${ORG_TREE_MAX_DEPTH}
    ) t
    WHERE t.id = ${orgIdColumn}
  )`);
};

/**
 * True when no ancestor within ORG_TREE_MAX_DEPTH levels is inactive. Callers
 * check the organization itself separately. Inactive ancestors beyond the
 * limit do not hide the row. Null references and missing org rows also pass.
 */
export const ancestorOrgsAreActive = (orgIdColumn: AnyColumn) =>
  hasNoInactiveOrg(orgIdColumn, false);

/**
 * True when neither the organization nor any ancestor within ORG_TREE_MAX_DEPTH
 * levels is inactive. Inactive ancestors beyond the limit do not hide the row.
 * Null references (including national event types) and missing org rows pass.
 */
export const orgAndAncestorsAreActive = (orgIdColumn: AnyColumn) =>
  hasNoInactiveOrg(orgIdColumn, true);
