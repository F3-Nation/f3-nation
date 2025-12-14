import type { schema as dbSchema } from "@acme/db";
import type { UpdateRequestMeta } from "@acme/shared/app/types";
import type {
  CreateAOAndLocationAndEventType,
  CreateEventType,
  DeleteAOType,
  DeleteEventType,
  EditAOAndLocationType,
  EditEventType,
  MoveAOToDifferentLocationType,
  MoveAoToDifferentRegionType,
  MoveAOToNewLocationType,
  MoveEventToDifferentAOType,
  MoveEventToNewLocationType,
} from "@acme/validators/request-schemas";
import { eq, schema } from "@acme/db";

import type { Context } from "../shared";
import type { UpdateRequestData } from "./types";
import { createAO, updateAO } from "./ao-handlers";
import { insertEvent, updateEvent, updateEventTypes } from "./event-handlers";
import { insertLocation, updateLocation } from "./location-handlers";

/**
 * Records an update request in the database
 */
export const recordUpdateRequest = async (params: {
  ctx: Context;
  updateRequest: UpdateRequestData;
  status: "approved" | "pending" | "rejected";
}): Promise<typeof dbSchema.updateRequests.$inferSelect> => {
  const reviewedAt = new Date().toISOString();

  const req = params.updateRequest as Record<string, unknown>;

  const meta: UpdateRequestMeta =
    "meta" in req && req.meta ? (req.meta as UpdateRequestMeta) : {};

  // Helper to preserve original/new fields in meta since they might not be in DB columns
  const preserveField = (field: string) => {
    if (field in req) {
      const val = req[field];
      if (val !== undefined && val !== null) {
        meta[field] = val;
      }
    }
  };

  preserveField("originalRegionId");
  preserveField("originalAoId");
  preserveField("originalLocationId");
  preserveField("originalEventId");

  preserveField("newRegionId");
  preserveField("newAoId");
  preserveField("newLocationId");
  preserveField("newEventId");

  // Map to DB columns safely
  const getVal = (key: string) => req[key] as number | undefined;

  const regionId =
    getVal("newRegionId") ?? getVal("originalRegionId") ?? getVal("regionId");
  const aoId = getVal("newAoId") ?? getVal("originalAoId") ?? getVal("aoId");
  const locationId =
    getVal("newLocationId") ??
    getVal("originalLocationId") ??
    getVal("locationId");
  const eventId = getVal("originalEventId") ?? getVal("eventId");

  if (!regionId) {
    console.error("Region ID missing in update request", params.updateRequest);
    throw new Error("Region ID is required");
  }

  const updateRequestInsertData: typeof dbSchema.updateRequests.$inferInsert = {
    ...req,
    requestType: params.updateRequest.requestType,
    submittedBy: params.updateRequest.submittedBy,
    regionId,
    aoId,
    locationId,
    eventId,
    status: params.status,
    reviewedAt,
    meta,
  };

  const [updated] = await params.ctx.db
    .insert(schema.updateRequests)
    .values(updateRequestInsertData)
    .onConflictDoUpdate({
      target: [schema.updateRequests.id],
      set: updateRequestInsertData,
    })
    .returning();

  if (!updated) {
    throw new Error("Failed to update request record");
  }

  return updated;
};

export const handleCreateLocationAndEvent = async (
  ctx: Context,
  request: CreateAOAndLocationAndEventType,
) => {
  // 1. Create location
  const location = await insertLocation(ctx, {
    regionId: request.originalRegionId,
    locationName: undefined,
    locationLat: request.locationLat,
    locationLng: request.locationLng,
    locationAddress: request.locationAddress,
    locationAddress2: request.locationAddress2,
    locationCity: request.locationCity,
    locationState: request.locationState,
    locationZip: request.locationZip,
    locationCountry: request.locationCountry,
    locationDescription: request.locationDescription,
  });
  const locationId = location.id;

  // 2. Create AO
  const aoId = await createAO(ctx, {
    regionId: request.originalRegionId,
    aoName: request.aoName,
    aoLogo: request.aoLogo,
    aoWebsite: request.aoWebsite,
    locationId,
  });

  // 3. Create event
  const event = await insertEvent(ctx, {
    aoId: aoId,
    locationId: locationId,
    eventName: request.eventName,
    eventDescription: request.eventDescription,
    eventDayOfWeek: request.eventDayOfWeek,
    eventStartTime: request.eventStartTime,
    eventEndTime: request.eventEndTime,
    eventStartDate: request.eventStartDate,
    eventRecurrencePattern: "weekly",
  });
  const eventId = event.id;

  await updateEventTypes(ctx, {
    eventId,
    eventTypeIds: request.eventTypeIds,
  });
};

export const handleCreateEvent = async (
  ctx: Context,
  request: CreateEventType,
) => {
  // 1. Create event
  const event = await insertEvent(ctx, {
    aoId: request.originalAoId,
    locationId: request.originalLocationId,
    eventName: request.eventName,
    eventDescription: request.eventDescription,
    eventDayOfWeek: request.eventDayOfWeek,
    eventStartTime: request.eventStartTime,
    eventEndTime: request.eventEndTime,
    eventStartDate: request.eventStartDate,
  });

  await updateEventTypes(ctx, {
    eventId: event.id,
    eventTypeIds: request.eventTypeIds,
  });
};

export const handleEditEvent = async (ctx: Context, request: EditEventType) => {
  if (request.originalEventId) {
    // Use explicit type for updateData
    const updateData: Parameters<typeof updateEvent>[1] = {
      eventId: request.originalEventId,
      locationId: undefined as unknown as number,
      eventName: request.eventName,
      eventDescription: request.eventDescription,
      eventDayOfWeek: request.eventDayOfWeek,
      eventStartTime: request.eventStartTime,
      eventEndTime: request.eventEndTime,
      eventStartDate: request.eventStartDate,
    };

    await updateEvent(ctx, updateData);

    if (request.eventTypeIds) {
      await updateEventTypes(ctx, {
        eventId: request.originalEventId,
        eventTypeIds: request.eventTypeIds,
      });
    }
  }
};

export const handleEditAOAndLocation = async (
  ctx: Context,
  request: EditAOAndLocationType,
) => {
  await updateAO(ctx, {
    id: request.originalAoId,
    name: request.aoName,
    logoUrl: request.aoLogo,
    website: request.aoWebsite,
  });

  await updateLocation(ctx, {
    locationId: request.originalLocationId,
    locationName: null,
    locationLat: request.locationLat,
    locationLng: request.locationLng,
    locationAddress: request.locationAddress,
    locationAddress2: request.locationAddress2,
    locationCity: request.locationCity,
    locationState: request.locationState,
    locationZip: request.locationZip,
    locationCountry: request.locationCountry,
    locationDescription: request.locationDescription,
  });
};

export const handleMoveAOToDifferentRegion = async (
  ctx: Context,
  request: MoveAoToDifferentRegionType,
) => {
  await updateAO(ctx, {
    id: request.originalAoId,
    parentId: request.newRegionId,
  });
};

export const handleMoveAOToNewLocation = async (
  ctx: Context,
  request: MoveAOToNewLocationType,
) => {
  const location = await insertLocation(ctx, {
    locationLat: request.locationLat,
    locationLng: request.locationLng,
    locationAddress: request.locationAddress,
    locationAddress2: request.locationAddress2,
    locationCity: request.locationCity,
    locationState: request.locationState,
    locationZip: request.locationZip,
    locationCountry: request.locationCountry,
    locationDescription: request.locationDescription,
    regionId: request.originalRegionId,
  });

  const locationId = location.id;

  await ctx.db
    .update(schema.events)
    .set({ locationId })
    .where(eq(schema.events.orgId, request.originalAoId));
};

export const handleMoveAOToDifferentLocation = async (
  ctx: Context,
  request: MoveAOToDifferentLocationType,
) => {
  await ctx.db
    .update(schema.events)
    .set({ locationId: request.newLocationId })
    .where(eq(schema.events.orgId, request.originalAoId));
};

export const handleMoveEventToDifferentAo = async (
  ctx: Context,
  request: MoveEventToDifferentAOType,
) => {
  await updateEvent(ctx, {
    eventId: request.originalEventId,
    aoId: request.newAoId,
    locationId: request.newLocationId,
  });
};

export const handleMoveEventToNewLocation = async (
  ctx: Context,
  request: MoveEventToNewLocationType,
) => {
  const location = await insertLocation(ctx, {
    locationLat: request.locationLat,
    locationLng: request.locationLng,
    locationAddress: request.locationAddress,
    locationAddress2: request.locationAddress2,
    locationCity: request.locationCity,
    locationState: request.locationState,
    locationZip: request.locationZip,
    locationCountry: request.locationCountry,
    locationDescription: request.locationDescription,
    regionId: request.originalRegionId,
  });

  const locationId = location.id;

  await updateEvent(ctx, {
    eventId: request.originalEventId,
    locationId: locationId,
  });
};

export const handleDeleteEvent = async (
  ctx: Context,
  request: DeleteEventType,
) => {
  await ctx.db
    .update(schema.events)
    .set({ isActive: false })
    .where(eq(schema.events.id, request.originalEventId));
};

export const handleDeleteAO = async (ctx: Context, request: DeleteAOType) => {
  await updateAO(ctx, {
    id: request.originalAoId,
    isActive: false,
  });

  await ctx.db
    .update(schema.events)
    .set({ isActive: false })
    .where(eq(schema.events.orgId, request.originalAoId));
};
