import { ORPCError } from "@orpc/server";

import { eq, inArray, schema } from "@acme/db";
import { isTruthy } from "@acme/shared/common/functions";

import { logger } from "../logger";
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
  logger.debug({ input }, "api.move_ao_locs.start");
  const { aoId, oldRegionId, newRegionId } = input;

  const aoEvents = await ctx.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.orgId, aoId));

  logger.debug(
    { aoEventsCount: aoEvents.length },
    "api.move_ao_locs.ao_events",
  );

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

  logger.debug(
    { aoEventsLocationsCount: aoEventsLocations.length },
    "api.move_ao_locs.ao_event_locations",
  );

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
    logger.debug(
      { newLocationId: newLocation.id },
      "api.move_ao_locs.created_location",
    );
    // 1b. move the ao's events to the new location
    const updatedEvents = await ctx.db
      .update(schema.events)
      .set({ locationId: newLocation.id })
      .where(inArray(schema.events.id, aoEventIds))
      .returning();

    logger.debug(
      { movedEventsCount: updatedEvents.length },
      "api.move_ao_locs.moved_events",
    );

    const remainingLocationEvents = await ctx.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.locationId, aoEventLocation.id));

    logger.debug(
      { remainingLocationEventsCount: remainingLocationEvents.length },
      "api.move_ao_locs.remaining_events",
    );

    if (!remainingLocationEvents?.length) {
      // 1c. Delete the old location if it has no other events
      await ctx.db
        .update(schema.locations)
        .set({ isActive: false })
        .where(eq(schema.locations.id, aoEventLocation.id));

      logger.debug(
        { oldLocationId: aoEventLocation.id },
        "api.move_ao_locs.deleted_location",
      );
    }
  }

  return { newLocationIds };
};
