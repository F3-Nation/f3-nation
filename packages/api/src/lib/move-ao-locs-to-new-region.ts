import { ORPCError } from "@orpc/server";

import { eq, inArray, schema } from "@acme/db";
import { isTruthy } from "@acme/shared/common/functions";

import type { Context } from "../shared";

/**
 * Moves the locations for an org to a new parent org
 *
 * Example 1
 * AO 1 moves from region 1 to region 2,
 * We need to make a copy of the locations for AO 1's Event 1 and Event 2 to the new region
 * We need to move the Events to the new location
 * We need to delete the old locations if no events exist on it
 *
 * Example 2
 * Region 1 moves from Area 1 to Area 2
 * We don't need to move any locations because they would point to the region id, which didn't change
 */
export const moveAOLocsToNewRegion = async (
  ctx: Context,
  input: {
    oldRegionId: number;
    newRegionId: number;
    aoId: number;
  },
) => {
  const newLocationIds: number[] = [];
  console.log("moveAOToNewRegion", input);
  const { aoId, oldRegionId, newRegionId } = input;

  const aoEvents = await ctx.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.orgId, aoId));

  console.log("aoEvents", aoEvents.length);

  const aoEventIds = aoEvents.map((e) => e.id);

  const aoEventsLocationIds = aoEvents
    .map((e) => e.locationId)
    .filter(isTruthy);

  const aoEventsLocations = aoEventsLocationIds.length
    ? await ctx.db
        .select()
        .from(schema.locations)
        .where(inArray(schema.locations.id, aoEventsLocationIds))
    : [];

  console.log("aoEventsLocations", aoEventsLocations.length);

  for (const aoEventLocation of aoEventsLocations) {
    if (aoEventLocation.orgId !== oldRegionId) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Locations to move are not in the old region",
      });
    }

    // 1a. duplicate the location in the new org
    const [newLocation] = await ctx.db
      .insert(schema.locations)
      .values({
        ...aoEventLocation,
        orgId: newRegionId,
        id: undefined,
      })
      .returning();

    if (!newLocation) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to create new location",
      });
    }
    newLocationIds.push(newLocation.id);
    console.log("created newLocation", newLocation.id);
    // 1b. move the ao's events to the new location
    const updatedEvents = await ctx.db
      .update(schema.events)
      .set({ locationId: newLocation.id })
      .where(inArray(schema.events.id, aoEventIds))
      .returning();

    console.log("moved events to new location", updatedEvents.length);

    const remainingLocationEvents = await ctx.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.locationId, aoEventLocation.id));

    console.log("remainingLocationEvents", remainingLocationEvents.length);

    if (!remainingLocationEvents?.length) {
      // 1c. Delete the old location if it has no other events
      await ctx.db
        .update(schema.locations)
        .set({ isActive: false })
        .where(eq(schema.locations.id, aoEventLocation.id));

      console.log("deleted old location", aoEventLocation.id);
    }
  }

  return { newLocationIds };
};
