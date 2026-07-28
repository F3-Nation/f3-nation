import { eq } from "drizzle-orm";

import { schema } from "@acme/db";
import { removeUndefinedFromObject } from "@acme/shared/common/functions";

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
    regionId?: number | null;
    locationId?: number | null;
    aoName?: string;
    aoWebsite?: string | null;
    aoLogo?: string | null;
  },
): Promise<number> => {
  const normalizedAoName = aoName?.trim();

  if (!normalizedAoName || normalizedAoName.length < 2) {
    throw new Error("AO name must be at least 2 characters");
  }

  const [ao] = await ctx.db
    .insert(schema.orgs)
    .values({
      parentId: regionId ?? undefined,
      orgType: "ao",
      website: aoWebsite ?? undefined,
      defaultLocationId: locationId ?? undefined,
      name: normalizedAoName,
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

  const set: Partial<typeof schema.orgs.$inferInsert> = {
    ...removeUndefinedFromObject(params),
  };

  // The region move (which copies locations and re-points events) and the AO
  // row update are mutually dependent. Run them in a single transaction so a
  // failure can't leave the AO's parentId and its locations inconsistent.
  return ctx.db.transaction(async (tx) => {
    const txCtx: Context = { ...ctx, db: tx as unknown as Context["db"] };
    const newLocationIds: number[] = [];

    if (params.parentId && params.parentId !== ao.parentId && ao.parentId) {
      const result = await moveAOLocsToNewRegion(txCtx, {
        aoId: ao.id,
        oldRegionId: ao.parentId,
        newRegionId: params.parentId,
      });
      newLocationIds.push(...result.newLocationIds);
    }

    const [updatedAO] = await txCtx.db
      .update(schema.orgs)
      .set(set)
      .where(eq(schema.orgs.id, ao.id))
      .returning();

    if (!updatedAO) {
      throw new Error("Failed to update AO");
    }

    return { ...updatedAO, newLocationIds };
  });
};
