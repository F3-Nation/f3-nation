import { eq } from "drizzle-orm";

import { schema } from "@acme/db";

import type { Context } from "../shared";

/**
 * Insert a new location into the database
 */
export const insertLocation = async (
  ctx: Context,
  updateRequest: {
    regionId: number;
    locationName?: string | null;
    locationDescription?: string | null;
    locationAddress?: string | null;
    locationAddress2?: string | null;
    locationCity?: string | null;
    locationState?: string | null;
    locationZip?: string | null;
    locationCountry?: string | null;
    locationLat?: number | null;
    locationLng?: number | null;
    locationContactEmail?: string | null;
  },
) => {
  const newLocation: typeof schema.locations.$inferInsert = {
    name: updateRequest.locationName ?? "",
    description: updateRequest.locationDescription ?? "",
    addressStreet: updateRequest.locationAddress ?? "",
    addressStreet2: updateRequest.locationAddress2 ?? "",
    addressCity: updateRequest.locationCity ?? "",
    addressState: updateRequest.locationState ?? "",
    addressZip: updateRequest.locationZip ?? "",
    addressCountry: updateRequest.locationCountry ?? "",
    latitude: updateRequest.locationLat ?? 0,
    longitude: updateRequest.locationLng ?? 0,
    orgId: updateRequest.regionId,
    email: updateRequest.locationContactEmail ?? undefined,
    isActive: true,
  };

  const [location] = await ctx.db
    .insert(schema.locations)
    .values(newLocation)
    .returning();

  if (!location) {
    throw new Error("Failed to insert location");
  }
  return location;
};

/**
 * Update an existing location
 */
export const updateLocation = async (
  ctx: Context,
  updateRequest: {
    locationId: number;
    locationName?: string | null;
    locationDescription?: string | null;
    locationAddress?: string | null;
    locationAddress2?: string | null;
    locationCity?: string | null;
    locationState?: string | null;
    locationZip?: string | null;
    locationCountry?: string | null;
    locationLat?: number | null;
    locationLng?: number | null;
    locationContactEmail?: string | null;
  },
) => {
  const [location] = await ctx.db
    .update(schema.locations)
    .set({
      description: updateRequest.locationDescription ?? undefined,
      addressStreet: updateRequest.locationAddress ?? undefined,
      addressStreet2: updateRequest.locationAddress2 ?? undefined,
      addressCity: updateRequest.locationCity ?? undefined,
      addressState: updateRequest.locationState ?? undefined,
      addressZip: updateRequest.locationZip ?? undefined,
      addressCountry: updateRequest.locationCountry ?? undefined,
      latitude: updateRequest.locationLat ?? undefined,
      longitude: updateRequest.locationLng ?? undefined,
      email: updateRequest.locationContactEmail ?? undefined,
    })
    .where(eq(schema.locations.id, updateRequest.locationId))
    .returning();

  if (!location) {
    throw new Error("Failed to update location");
  }

  return location;
};

/**
 * Creates or updates a location based on request data
 */
export const handleLocation = async (
  ctx: Context,
  updateRequest: {
    originalLocationId?: number;
    regionId: number;
    locationName?: string | null;
    locationDescription?: string | null;
    locationAddress?: string | null;
    locationAddress2?: string | null;
    locationCity?: string | null;
    locationState?: string | null;
    locationZip?: string | null;
    locationCountry?: string | null;
    locationLat?: number | null;
    locationLng?: number | null;
    locationContactEmail?: string | null;
  },
) => {
  // If no locationId, create a new location
  if (updateRequest.originalLocationId) {
    const updatedLocation = await updateLocation(ctx, {
      ...updateRequest,
      locationId: updateRequest.originalLocationId,
    });
    return updatedLocation;
  } else {
    // Otherwise update existing location

    const insertedLocation = await insertLocation(ctx, updateRequest);
    return insertedLocation;
  }
};
