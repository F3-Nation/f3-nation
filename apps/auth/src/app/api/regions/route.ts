import { NextResponse } from "next/server";

import { and, eq } from "@acme/db";
import { orgs } from "@acme/db/schema/schema";

import { db } from "~/lib/db";

export async function GET() {
  const regions = await db
    .select({
      id: orgs.id,
      name: orgs.name,
    })
    .from(orgs)
    .where(and(eq(orgs.orgType, "region"), eq(orgs.isActive, true)))
    .orderBy(orgs.name);

  return NextResponse.json(regions);
}
