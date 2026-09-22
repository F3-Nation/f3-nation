import type { PgColumn } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

import { schema, sql } from "@acme/db";

import { ORG_TREE_MAX_DEPTH } from "./org-tree";

/** A correlated sort expression, evaluated in SQL before LIMIT/OFFSET. */
export const orgAncestorName = (
  orgId: PgColumn,
  ancestorType: "sector" | "territory",
) => sql<string | null>`(
  WITH RECURSIVE ancestors(id, parent_id, name, org_type, depth, path) AS (
    SELECT root.id, root.parent_id, root.name, root.org_type, 0, ARRAY[root.id]
    FROM ${schema.orgs} AS root
    WHERE root.id = ${sql.identifier(getTableName(orgId.table))}.${sql.identifier(orgId.name)}

    UNION ALL

    SELECT parent.id, parent.parent_id, parent.name, parent.org_type,
      ancestors.depth + 1, ancestors.path || parent.id
    FROM ${schema.orgs} AS parent
    INNER JOIN ancestors ON parent.id = ancestors.parent_id
    WHERE ancestors.depth < ${ORG_TREE_MAX_DEPTH}
      AND NOT parent.id = ANY(ancestors.path)
      AND (ancestors.depth = 0 OR ancestors.org_type <> ${ancestorType})
  )
  SELECT name FROM ancestors
  WHERE depth > 0 AND org_type = ${ancestorType}
  ORDER BY depth
  LIMIT 1
)`;
