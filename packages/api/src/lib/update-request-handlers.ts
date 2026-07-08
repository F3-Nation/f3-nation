import type { schema as dbSchema } from "@acme/db";
import type { EventMeta, UpdateRequestMeta } from "@acme/shared/app/types";
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
  MoveEventToNewAOType,
  MoveEventToNewLocationType,
} from "@acme/validators/request-schemas";
import { eq, schema } from "@acme/db";
import { RequestInsertSchema } from "@acme/validators";

import type { Context } from "../shared";
import type { UpdateRequestData } from "./types";
import { logError, logInfo } from "../logger";
import { createAO, updateAO } from "./ao-handlers";
import { insertEvent, updateEvent, updateEventTypes } from "./event-handlers";
import { insertLocation, updateLocation } from "./location-handlers";

const PRESERVED_META_FIELDS = [
  "originalRegionId",
  "originalAoId",
  "originalLocationId",
  "originalEventId",
  "newRegionId",
  "newAoId",
  "newLocationId",
  "newEventId",
] as const;

/**
 * Copies the request's original/new id fields into meta, since some of them
 * don't have dedicated DB columns. Mutates and returns the meta object.
 */
const buildMeta = (req: Record<string, unknown>): UpdateRequestMeta => {
  const meta: UpdateRequestMeta =
    "meta" in req && req.meta ? (req.meta as UpdateRequestMeta) : {};
  for (const field of PRESERVED_META_FIELDS) {
    const val = req[field];
    if (val !== undefined && val !== null) {
      meta[field] = val;
    }
  }
  return meta;
};

/**
 * Fetches the destination AO (and its default location) so a
 * move_event_to_different_ao request can be recorded with the target's details.
 */
const hydrateDestinationAo = async (ctx: Context, newAoId: number) => {
  const [destinationAo] = await ctx.db
    .select({
      name: schema.orgs.name,
      logoUrl: schema.orgs.logoUrl,
      website: schema.orgs.website,
      locationId: schema.orgs.defaultLocationId,
      locationAddress: schema.locations.addressStreet,
      locationAddress2: schema.locations.addressStreet2,
      locationCity: schema.locations.addressCity,
      locationState: schema.locations.addressState,
      locationZip: schema.locations.addressZip,
      locationCountry: schema.locations.addressCountry,
      locationLat: schema.locations.latitude,
      locationLng: schema.locations.longitude,
      locationDescription: schema.locations.description,
    })
    .from(schema.orgs)
    .leftJoin(
      schema.locations,
      eq(schema.locations.id, schema.orgs.defaultLocationId),
    )
    .where(eq(schema.orgs.id, newAoId));
  return destinationAo;
};

/**
 * Fetches the destination location so a move_ao_to_different_location request
 * can be recorded with the target location's address details.
 */
const hydrateDestinationLocation = async (ctx: Context, locationId: number) => {
  const [location] = await ctx.db
    .select({
      locationAddress: schema.locations.addressStreet,
      locationAddress2: schema.locations.addressStreet2,
      locationCity: schema.locations.addressCity,
      locationState: schema.locations.addressState,
      locationZip: schema.locations.addressZip,
      locationCountry: schema.locations.addressCountry,
      locationLat: schema.locations.latitude,
      locationLng: schema.locations.longitude,
      locationDescription: schema.locations.description,
    })
    .from(schema.locations)
    .where(eq(schema.locations.id, locationId));
  return location;
};

/**
 * Backfills the request's event fields from the existing event row so a
 * move_event_to_new_location request preserves the (unchanged) event details.
 * Mutates `req` in place, never overwriting values already present.
 */
const hydrateEventFields = async (
  ctx: Context,
  req: Record<string, unknown>,
  eventId: number,
) => {
  // These two queries are independent, so run them concurrently.
  const [[existingEvent], eventTypeRows] = await Promise.all([
    ctx.db
      .select({
        name: schema.events.name,
        dayOfWeek: schema.events.dayOfWeek,
        startTime: schema.events.startTime,
        endTime: schema.events.endTime,
        startDate: schema.events.startDate,
        endDate: schema.events.endDate,
        description: schema.events.description,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId)),
    ctx.db
      .select({ eventTypeId: schema.eventsXEventTypes.eventTypeId })
      .from(schema.eventsXEventTypes)
      .where(eq(schema.eventsXEventTypes.eventId, eventId)),
  ]);

  if (existingEvent) {
    req.eventName ??= existingEvent.name;
    req.eventDayOfWeek ??= existingEvent.dayOfWeek;
    req.eventStartTime ??= existingEvent.startTime;
    req.eventEndTime ??= existingEvent.endTime;
    req.eventStartDate ??= existingEvent.startDate;
    req.eventEndDate ??= existingEvent.endDate;
    req.eventDescription ??= existingEvent.description;
  }

  if (eventTypeRows.length > 0 && !req.eventTypeIds) {
    req.eventTypeIds = eventTypeRows.map((r) => r.eventTypeId);
  }
};

/**
 * Records an update request in the database
 */
export const recordUpdateRequest = async (params: {
  ctx: Context;
  updateRequest: Pick<UpdateRequestData, "requestType" | "submittedBy"> &
    Record<string, unknown>;
  status: "approved" | "pending" | "rejected";
}): Promise<typeof dbSchema.updateRequests.$inferSelect> => {
  const reviewedAt =
    params.status === "pending" ? undefined : new Date().toISOString();

  const req: Record<string, unknown> = { ...params.updateRequest };

  const meta = buildMeta(req);

  // Map to DB columns safely
  const getVal = (key: string) => req[key] as number | undefined;

  const newAoId = getVal("newAoId");
  const newLocationId = getVal("newLocationId");

  const regionId =
    getVal("newRegionId") ?? getVal("originalRegionId") ?? getVal("regionId");
  const aoId = newAoId ?? getVal("originalAoId") ?? getVal("aoId");
  const locationId =
    newLocationId ?? getVal("originalLocationId") ?? getVal("locationId");
  const eventId = getVal("originalEventId") ?? getVal("eventId");

  const destinationAo =
    req.requestType === "move_event_to_different_ao" && newAoId
      ? await hydrateDestinationAo(params.ctx, newAoId)
      : undefined;

  const destinationLocation =
    req.requestType === "move_ao_to_different_location" && newLocationId
      ? await hydrateDestinationLocation(params.ctx, newLocationId)
      : undefined;

  if (req.requestType === "move_event_to_new_location" && eventId) {
    await hydrateEventFields(params.ctx, req, eventId);
  }

  if (!regionId) {
    logError("api.update_request.region_id_missing", {
      requestId: params.updateRequest.id,
      requestType: params.updateRequest.requestType,
    });
    throw new Error("Region ID is required");
  }

  const parsedRequestInsertData = RequestInsertSchema.strip().parse({
    ...req,
    requestType: params.updateRequest.requestType,
    submittedBy: params.updateRequest.submittedBy,
    regionId,
    aoId,
    aoName: destinationAo?.name ?? req.aoName,
    aoLogo: destinationAo?.logoUrl ?? req.aoLogo,
    aoWebsite: destinationAo?.website ?? req.aoWebsite,
    locationId: destinationAo?.locationId ?? locationId,
    locationAddress:
      destinationAo?.locationAddress ??
      destinationLocation?.locationAddress ??
      req.locationAddress,
    locationAddress2:
      destinationAo?.locationAddress2 ??
      destinationLocation?.locationAddress2 ??
      req.locationAddress2,
    locationCity:
      destinationAo?.locationCity ??
      destinationLocation?.locationCity ??
      req.locationCity,
    locationState:
      destinationAo?.locationState ??
      destinationLocation?.locationState ??
      req.locationState,
    locationZip:
      destinationAo?.locationZip ??
      destinationLocation?.locationZip ??
      req.locationZip,
    locationCountry:
      destinationAo?.locationCountry ??
      destinationLocation?.locationCountry ??
      req.locationCountry,
    locationLat:
      destinationAo?.locationLat ??
      destinationLocation?.locationLat ??
      req.locationLat,
    locationLng:
      destinationAo?.locationLng ??
      destinationLocation?.locationLng ??
      req.locationLng,
    locationDescription:
      destinationAo?.locationDescription ??
      destinationLocation?.locationDescription ??
      req.locationDescription,
    eventId,
    status: params.status,
    reviewedAt,
    meta,
  });

  const updateRequestInsertData: typeof dbSchema.updateRequests.$inferInsert = {
    ...parsedRequestInsertData,
    eventMeta: params.updateRequest.eventMeta as EventMeta | undefined,
  };

  // Separate the id from the rest of the data for the update clause
  // Don't include id in the set clause as it's the conflict target
  const { id: requestId, ...updateData } = updateRequestInsertData;

  try {
    const [updated] = await params.ctx.db
      .insert(schema.updateRequests)
      .values(updateRequestInsertData)
      .onConflictDoUpdate({
        target: [schema.updateRequests.id],
        set: updateData, // Don't include id in set clause
      })
      .returning();

    logInfo("api.update_request.recorded", { requestId });

    if (!updated) {
      throw new Error("Failed to update request record");
    }

    return updated;
  } catch (error) {
    logError("api.update_request.db_error", { requestId }, error);
    throw error;
  }
};

/**
 * Ids of rows a handler created. handleRequest merges these into the recorded
 * update request so the audit row (and webhook payload) links to the new
 * entities instead of recording null ids.
 */
export interface CreatedEntityIds {
  eventId?: number;
  aoId?: number;
  locationId?: number;
}

/**
 * Runs `fn` inside a DB transaction, passing it a Context whose `db` is the
 * transaction handle. Nested calls (e.g. from a caller that already opened a
 * transaction) become savepoints. Handlers with multiple dependent writes use
 * this so a mid-sequence failure can't commit a partial change.
 */
const withTxCtx = <T>(
  ctx: Context,
  fn: (txCtx: Context) => Promise<T>,
): Promise<T> =>
  ctx.db.transaction((tx) =>
    fn({ ...ctx, db: tx as unknown as Context["db"] }),
  );

export const handleCreateLocationAndEvent = async (
  ctx: Context,
  request: CreateAOAndLocationAndEventType,
): Promise<CreatedEntityIds> => {
  return await withTxCtx(ctx, async (txCtx) => {
    // 1. Create location
    const location = await insertLocation(txCtx, {
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
    const aoId = await createAO(txCtx, {
      regionId: request.originalRegionId,
      aoName: request.aoName,
      aoLogo: request.aoLogo,
      aoWebsite: request.aoWebsite,
      locationId,
    });

    // 3. Create event
    const event = await insertEvent(txCtx, {
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

    await updateEventTypes(txCtx, {
      eventId,
      eventTypeIds: request.eventTypeIds,
    });

    return { locationId, aoId, eventId };
  });
};

export const handleCreateEvent = async (
  ctx: Context,
  request: CreateEventType,
): Promise<CreatedEntityIds> => {
  return await withTxCtx(ctx, async (txCtx) => {
    // 1. Create event
    const event = await insertEvent(txCtx, {
      aoId: request.originalAoId,
      locationId: request.originalLocationId,
      eventName: request.eventName,
      eventDescription: request.eventDescription,
      eventDayOfWeek: request.eventDayOfWeek,
      eventStartTime: request.eventStartTime,
      eventEndTime: request.eventEndTime,
      eventStartDate: request.eventStartDate,
    });

    await updateEventTypes(txCtx, {
      eventId: event.id,
      eventTypeIds: request.eventTypeIds,
    });

    return { eventId: event.id };
  });
};

export const handleEditEvent = async (ctx: Context, request: EditEventType) => {
  if (!request.originalEventId) {
    throw new Error("Event ID is required");
  }
  // Use explicit type for updateData
  const updateData: Parameters<typeof updateEvent>[1] = {
    eventId: request.originalEventId,
    locationId: undefined,
    eventName: request.eventName,
    eventDescription: request.eventDescription,
    eventDayOfWeek: request.eventDayOfWeek,
    eventStartTime: request.eventStartTime,
    eventEndTime: request.eventEndTime,
    eventStartDate: request.eventStartDate,
  };

  await withTxCtx(ctx, async (txCtx) => {
    await updateEvent(txCtx, updateData);

    if (request.eventTypeIds) {
      await updateEventTypes(txCtx, {
        eventId: request.originalEventId,
        eventTypeIds: request.eventTypeIds,
      });
    }
  });
};

export const handleEditAOAndLocation = async (
  ctx: Context,
  request: EditAOAndLocationType,
) => {
  await withTxCtx(ctx, async (txCtx) => {
    await updateAO(txCtx, {
      id: request.originalAoId,
      name: request.aoName,
      logoUrl: request.aoLogo,
      website: request.aoWebsite,
    });

    await updateLocation(txCtx, {
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
): Promise<CreatedEntityIds> => {
  return await withTxCtx(ctx, async (txCtx) => {
    const location = await insertLocation(txCtx, {
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

    await txCtx.db
      .update(schema.events)
      .set({ locationId })
      .where(eq(schema.events.orgId, request.originalAoId));

    // Keep the AO's default location in sync with its events.
    await txCtx.db
      .update(schema.orgs)
      .set({ defaultLocationId: locationId })
      .where(eq(schema.orgs.id, request.originalAoId));

    return { locationId };
  });
};

export const handleMoveAOToDifferentLocation = async (
  ctx: Context,
  request: MoveAOToDifferentLocationType,
): Promise<CreatedEntityIds> => {
  return await withTxCtx(ctx, async (txCtx) => {
    let locationId = request.newLocationId;
    let createdLocationId: number | undefined;

    if (!locationId) {
      const location = await insertLocation(txCtx, {
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
      locationId = location.id;
      createdLocationId = location.id;
    }

    await txCtx.db
      .update(schema.events)
      .set({ locationId })
      .where(eq(schema.events.orgId, request.originalAoId));

    // Keep the AO's default location in sync with its events.
    await txCtx.db
      .update(schema.orgs)
      .set({ defaultLocationId: locationId })
      .where(eq(schema.orgs.id, request.originalAoId));

    return { locationId: createdLocationId };
  });
};

export const handleMoveEventToDifferentAO = async (
  ctx: Context,
  request: MoveEventToDifferentAOType,
) => {
  await updateEvent(ctx, {
    eventId: request.originalEventId,
    aoId: request.newAoId,
    locationId: request.newLocationId,
  });
};

export const handleMoveEventToNewAO = async (
  ctx: Context,
  request: MoveEventToNewAOType,
): Promise<CreatedEntityIds> => {
  return await withTxCtx(ctx, async (txCtx) => {
    let locationId = request.newLocationId;
    let createdLocationId: number | undefined;
    // 1. Create location
    if (!locationId) {
      const location = await insertLocation(txCtx, {
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
      locationId = location.id;
      createdLocationId = location.id;
    }

    // 2. Create AO
    const aoId = await createAO(txCtx, {
      regionId: request.originalRegionId,
      aoName: request.aoName,
      aoLogo: request.aoLogo,
      aoWebsite: request.aoWebsite,
      locationId,
    });

    await updateEvent(txCtx, {
      eventId: request.originalEventId,
      aoId,
      locationId,
    });

    return { aoId, locationId: createdLocationId };
  });
};

export const handleMoveEventToNewLocation = async (
  ctx: Context,
  request: MoveEventToNewLocationType,
): Promise<CreatedEntityIds> => {
  return await withTxCtx(ctx, async (txCtx) => {
    const location = await insertLocation(txCtx, {
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

    await updateEvent(txCtx, {
      eventId: request.originalEventId,
      locationId: locationId,
    });

    return { locationId };
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
  await withTxCtx(ctx, async (txCtx) => {
    await updateAO(txCtx, {
      id: request.originalAoId,
      isActive: false,
    });

    await txCtx.db
      .update(schema.events)
      .set({ isActive: false })
      .where(eq(schema.events.orgId, request.originalAoId));
  });
};
