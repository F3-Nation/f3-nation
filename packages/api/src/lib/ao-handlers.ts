import { eq } from "drizzle-orm";

import { inArray, schema } from "@acme/db";
import {
  isTruthy,
  removeUndefinedFromObject,
} from "@acme/shared/common/functions";

import type { Context } from "../shared";
import { moveAOLocsToNewRegion } from "./move-ao-locs-to-new-region";

/**
 * Creates a new AO using the provided data
 */
export const createAO = async (
  ctx: Context,
  {
    regionId,
    locationId,
    aoName,
    aoWebsite,
    aoLogo,
  }: {
    regionId?: number;
    locationId?: number | null;
    aoName?: string;
    aoWebsite?: string | null;
    aoLogo?: string | null;
  },
): Promise<number> => {
  console.log("createAO", { regionId, locationId, aoName });
  const [ao] = await ctx.db
    .insert(schema.orgs)
    .values({
      parentId: regionId,
      orgType: "ao",
      website: aoWebsite ?? undefined,
      defaultLocationId: locationId ?? undefined,
      name: aoName ?? "",
      isActive: true,
      logoUrl: aoLogo ?? undefined,
    })
    .returning();

  if (!ao) throw new Error("Failed to insert AO");
  return ao.id;
};

/**
 * Updates an existing AO with the provided data
 */
export const updateAO = async (
  ctx: Context,
  { id, ...params }: Partial<typeof schema.orgs.$inferInsert> & { id: number },
) => {
  const newLocationIds: number[] = [];
  const [ao] = await ctx.db
    .select()
    .from(schema.orgs)
    .where(eq(schema.orgs.id, id));

  if (!ao) {
    throw new Error("Failed to find ao to update. Does the AO exist?");
  }

  if (ao?.orgType !== "ao") {
    throw new Error("Organization is not an AO");
  }

  if (params.parentId && params.parentId !== ao.parentId && ao.parentId) {
    const result = await moveAOLocsToNewRegion(ctx, {
      aoId: ao.id,
      oldRegionId: ao.parentId,
      newRegionId: params.parentId,
    });
    newLocationIds.push(...result.newLocationIds);
  }

  const set: typeof schema.orgs.$inferInsert = {
    ...ao,
    ...removeUndefinedFromObject(params),
  };

  const [updatedAO] = await ctx.db
    .update(schema.orgs)
    .set(set)
    .where(eq(schema.orgs.id, ao.id))
    .returning();

  if (!updatedAO) {
    throw new Error("Failed to update AO");
  }

  return { ...updatedAO, newLocationIds };
};

export const getLocationIdsForAO = async (ctx: Context, aoId: number) => {
  const events = await ctx.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.orgId, aoId));

  const eventLocationIds = events
    .map((event) => event.locationId)
    .filter(isTruthy);

  const locationIds = !eventLocationIds.length
    ? []
    : await ctx.db
        .select({ id: schema.locations.id })
        .from(schema.locations)
        .where(inArray(schema.locations.id, eventLocationIds));

  return locationIds.map((l) => l.id);
};
