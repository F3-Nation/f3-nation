import { asc, inArray } from "drizzle-orm";
import { schema, sql } from "@acme/db";
import type { AppDb } from "@acme/db/client";
import { ORG_TREE_MAX_DEPTH } from "@acme/shared/app/org-hierarchy";
import { ORPCError } from "@orpc/server";

interface Ancestor extends Record<string, unknown> {
  id: number;
  parentId: number | null;
  orgType: string;
  isActive: boolean;
  depth: number;
}

const readAncestry = (db: AppDb, regionId: number) =>
  db.execute<Ancestor>(sql`
  WITH RECURSIVE ancestors AS (
    SELECT id, parent_id AS "parentId", org_type AS "orgType", is_active AS "isActive", 0 AS depth, ARRAY[id] AS path
    FROM ${schema.orgs} WHERE id = ${regionId}
    UNION ALL
    SELECT parent.id, parent.parent_id, parent.org_type, parent.is_active, ancestors.depth + 1, ancestors.path || parent.id
    FROM ${schema.orgs} AS parent JOIN ancestors ON parent.id = ancestors."parentId"
    WHERE ancestors.depth < ${ORG_TREE_MAX_DEPTH} AND NOT parent.id = ANY(ancestors.path)
  ) SELECT id, "parentId", "orgType", "isActive", depth FROM ancestors ORDER BY depth
`);

/** Hold destination eligibility stable until the surrounding profile transaction commits. */
export async function lockHomeRegion(
  db: AppDb,
  regionId: number,
): Promise<void> {
  const discovered = await readAncestry(db, regionId);
  if (!discovered.length)
    throw new ORPCError("NOT_FOUND", { message: "Home region not found" });
  // One globally ordered lock acquisition avoids inversions between profile saves.
  // SHARE also blocks non-key activity updates, unlike KEY SHARE.
  const locked = await db
    .select({ id: schema.orgs.id })
    .from(schema.orgs)
    .where(
      inArray(
        schema.orgs.id,
        discovered.map((row) => row.id),
      ),
    )
    .orderBy(asc(schema.orgs.id))
    .for("share");
  // A separate statement sees commits that finished while row locks were waiting.
  const fresh = await readAncestry(db, regionId);
  const lockedIds = new Set(locked.map((row) => row.id));
  if (!fresh.length || fresh.some((row) => !lockedIds.has(row.id))) {
    // Never acquire newly discovered rows out of order; retry from a new snapshot.
    throw new ORPCError("CONFLICT", {
      message:
        "The home region hierarchy changed. Reload the profile and home regions and try again.",
    });
  }
  const destination = fresh[0];
  const terminal = fresh.at(-1);
  if (
    destination?.orgType !== "region" ||
    fresh.some((row) => !row.isActive) ||
    terminal?.parentId !== null
  ) {
    // A non-root terminal means the bounded walk was truncated or encountered a cycle.
    throw new ORPCError("BAD_REQUEST", {
      message: "Home region must be an active region with active ancestors",
    });
  }
}
