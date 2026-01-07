import { aliasedTable, eq, inArray, schema } from "@acme/db";

import type { Context } from "./shared";

/**
 * Get all descendant organization IDs for the given parent org IDs.
 * Uses a single query with self-joins to traverse the org hierarchy (up to 5 levels deep).
 * Similar approach to checkHasRoleOnOrg but going DOWN the tree instead of UP.
 *
 * @param db - Database context
 * @param parentOrgIds - Array of parent organization IDs
 * @returns Array of all descendant org IDs (including the parent orgs themselves)
 */
export const getDescendantOrgIds = async (
  db: Context["db"],
  parentOrgIds: number[],
): Promise<number[]> => {
  if (parentOrgIds.length === 0) {
    return [];
  }

  // Create aliased tables for each level of the hierarchy
  // Level 0 = input parent orgs, then we join DOWN to find children
  const level0 = aliasedTable(schema.orgs, "level_0"); // Parent orgs (input)
  const level1 = aliasedTable(schema.orgs, "level_1"); // Direct children
  const level2 = aliasedTable(schema.orgs, "level_2"); // Grandchildren
  const level3 = aliasedTable(schema.orgs, "level_3"); // Great-grandchildren
  const level4 = aliasedTable(schema.orgs, "level_4"); // Great-great-grandchildren

  // Single query to get all descendants up to 5 levels deep
  // This mirrors the approach in checkHasRoleOnOrg but goes DOWN instead of UP
  const descendants = await db
    .select({
      level0Id: level0.id,
      level1Id: level1.id,
      level2Id: level2.id,
      level3Id: level3.id,
      level4Id: level4.id,
    })
    .from(level0)
    .leftJoin(level1, eq(level0.id, level1.parentId))
    .leftJoin(level2, eq(level1.id, level2.parentId))
    .leftJoin(level3, eq(level2.id, level3.parentId))
    .leftJoin(level4, eq(level3.id, level4.parentId))
    .where(inArray(level0.id, parentOrgIds));

  // Collect all unique org IDs from all levels
  const allOrgIds = new Set<number>();
  for (const row of descendants) {
    if (row.level0Id !== null) allOrgIds.add(row.level0Id);
    if (row.level1Id !== null) allOrgIds.add(row.level1Id);
    if (row.level2Id !== null) allOrgIds.add(row.level2Id);
    if (row.level3Id !== null) allOrgIds.add(row.level3Id);
    if (row.level4Id !== null) allOrgIds.add(row.level4Id);
  }

  return Array.from(allOrgIds);
};
