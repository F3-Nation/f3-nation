import { schema, sql } from "@acme/db";

import { logError } from "./logger";
import type { Context } from "./shared";

/**
 * Caps worst-case work for recursive hierarchy queries on unusually deep
 * trees. Each query handles cycles separately with a visited-path guard.
 * Twenty leaves substantial headroom above today's five-level tree; lowering
 * this below the real hierarchy depth would deny authorization or omit visible
 * results and emit api.org_tree.depth_limit_reached.
 */
export const ORG_TREE_MAX_DEPTH = 20;

/**
 * The org tree changes rarely, so re-running the table-wide scan on every
 * request is wasted work under concurrent map traffic. One scan per interval
 * gives the same telemetry at a fraction of the database and logging cost.
 */
const DEPTH_SCAN_INTERVAL_MS = 5 * 60 * 1000;
let lastDepthScanAt = 0;

/**
 * Resets the throttle window. Test-only: production code never needs to
 * force a rescan.
 */
export const resetDepthScanThrottleForTests = (): void => {
  lastDepthScanAt = 0;
};

/**
 * Scans the whole `orgs` table for any org whose ancestor chain exceeds
 * `ORG_TREE_MAX_DEPTH`, logging `api.org_tree.depth_limit_reached` if one is
 * found. Unlike `checkHasRoleOnOrg` and `getDescendantOrgIds`, this isn't
 * anchored to a single org — it's the depth-limit telemetry for
 * `ancestorOrgsAreActive` (packages/api/src/router/map/location.ts), whose
 * own recursive walk is embedded per-row via `notExists(...)` inside bulk
 * selects and has no materialized JS result to inspect after the query
 * returns. A single unanchored table-wide scan gives it the same
 * observability at a fraction of the cost of checking per row.
 *
 * Throttled to once per `DEPTH_SCAN_INTERVAL_MS`: three hot public handlers
 * call this on every request, but the underlying data changes slowly.
 *
 * Never throws — errors are logged and swallowed, matching the
 * fire-and-forget contract of `notifyMapDataChange`
 * (packages/api/src/lib/webhook-events.ts) so a scan failure can't affect the
 * response. Callers on hot read paths should call this without awaiting it
 * (`void logIfOrgTreeExceedsMaxDepth(ctx.db)`); tests can await it directly.
 */
export const logIfOrgTreeExceedsMaxDepth = async (
  db: Context["db"],
): Promise<void> => {
  const now = Date.now();
  if (now - lastDepthScanAt < DEPTH_SCAN_INTERVAL_MS) return;
  lastDepthScanAt = now;

  try {
    const rows = await db.execute<{ hit: number }>(sql`
      WITH RECURSIVE ancestors(id, parent_id, depth, path) AS (
        SELECT
          ${schema.orgs.id},
          ${schema.orgs.parentId},
          0,
          ARRAY[${schema.orgs.id}]
        FROM ${schema.orgs}

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
      SELECT 1 AS hit FROM ancestors WHERE depth > ${ORG_TREE_MAX_DEPTH} LIMIT 1
    `);

    if (rows.length > 0) {
      logError("api.org_tree.depth_limit_reached", {
        maxDepth: ORG_TREE_MAX_DEPTH,
        source: "map_ancestor_active_check",
      });
    }
  } catch (error) {
    try {
      logError("api.org_tree.depth_scan_failed", {}, error);
    } catch {
      // Logging must never be able to take the process down.
    }
  }
};
