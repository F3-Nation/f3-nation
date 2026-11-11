import { NextResponse } from "next/server";

import { orgAndAncestorsAreActive } from "@acme/api/org-activity";
import { logIfOrgTreeExceedsMaxDepth } from "@acme/api/org-tree";
import { and, eq } from "@acme/db";
import { orgs } from "@acme/db/schema/schema";

import { db } from "~/lib/db";

export async function GET() {
  void logIfOrgTreeExceedsMaxDepth(db);
  const regions = await db
    .select({
      id: orgs.id,
      name: orgs.name,
    })
    .from(orgs)
    .where(and(eq(orgs.orgType, "region"), orgAndAncestorsAreActive(orgs.id)))
    .orderBy(orgs.name);

  return NextResponse.json(regions);
}
