import dayjs from "dayjs";
import { eq } from "drizzle-orm";

import type { DayOfWeek } from "@acme/shared/app/enums";
import type { EventMeta } from "@acme/shared/app/types";
import { schema } from "@acme/db";

import type { Context } from "../shared";

export const updateEvent = async (
  ctx: Context,
  updateRequest: {
    locationId?: number | null;
    aoId?: number | null;
    eventId: number;
    eventName?: string | null;
    eventDescription?: string | null;
    eventStartDate?: string | null;
    eventEndDate?: string | null;
    eventStartTime?: string | null;
    eventEndTime?: string | null;
    eventDayOfWeek?: DayOfWeek | null;
    eventSeriesId?: number | null;
    eventRecurrencePattern?: "weekly" | "monthly" | null;
    eventRecurrenceInterval?: number | null;
    eventIndexWithinInterval?: number | null;
    eventMeta?: EventMeta | null;
    eventContactEmail?: string | null;
  },
) => {
  // Update existing event
  const [updated] = await ctx.db
    .update(schema.events)
    .set({
      name: updateRequest.eventName ?? undefined,
      locationId: updateRequest.locationId ?? undefined,
      description: updateRequest.eventDescription ?? undefined,
      startDate: updateRequest.eventStartDate ?? undefined,
      endDate: updateRequest.eventEndDate ?? undefined,
      startTime: updateRequest.eventStartTime ?? undefined,
      endTime: updateRequest.eventEndTime ?? undefined,
      dayOfWeek: updateRequest.eventDayOfWeek ?? undefined,
      seriesId: updateRequest.eventSeriesId ?? undefined,
      isActive: true,
      highlight: false,
      orgId: updateRequest.aoId ?? undefined,
      recurrencePattern: updateRequest.eventRecurrencePattern ?? undefined,
      recurrenceInterval: updateRequest.eventRecurrenceInterval ?? undefined,
      indexWithinInterval: updateRequest.eventIndexWithinInterval ?? undefined,
      meta: updateRequest.eventMeta ?? undefined,
      email: updateRequest.eventContactEmail ?? undefined,
    })
    .where(eq(schema.events.id, updateRequest.eventId))
    .returning();

  if (!updated) {
    throw new Error("Failed to update event");
  }

  return updated;
};

export const insertEvent = async (
  ctx: Context,
  updateRequest: {
    aoId: number;
    locationId: number;
    eventId?: never;
    eventName: string;
    eventDescription?: string | null;
    eventStartDate?: string | null;
    eventEndDate?: string | null;
    eventStartTime?: string | null;
    eventEndTime?: string | null;
    eventDayOfWeek?: DayOfWeek | null;
    eventSeriesId?: number | null;
    eventRecurrencePattern?: "weekly" | "monthly" | null;
    eventRecurrenceInterval?: number | null;
    eventIndexWithinInterval?: number | null;
    eventMeta?: EventMeta | null;
    eventContactEmail?: string | null;
  },
) => {
  // Insert new event
  const newEvent: typeof schema.events.$inferInsert = {
    name: updateRequest.eventName,
    locationId: updateRequest.locationId,
    description: updateRequest.eventDescription ?? undefined,
    startDate: updateRequest.eventStartDate ?? new Date().toISOString(),
    endDate: updateRequest.eventEndDate ?? undefined,
    startTime: updateRequest.eventStartTime ?? undefined,
    endTime: updateRequest.eventEndTime ?? undefined,
    dayOfWeek: updateRequest.eventDayOfWeek ?? undefined,
    seriesId: updateRequest.eventSeriesId ?? undefined,
    isActive: true,
    highlight: false,
    orgId: updateRequest.aoId,
    recurrencePattern: updateRequest.eventRecurrencePattern ?? undefined,
    recurrenceInterval: updateRequest.eventRecurrenceInterval ?? undefined,
    indexWithinInterval: updateRequest.eventIndexWithinInterval ?? undefined,
    meta: updateRequest.eventMeta ?? undefined,
    email: updateRequest.eventContactEmail ?? undefined,
  };

  const [event] = await ctx.db
    .insert(schema.events)
    .values(newEvent)
    .returning();

  if (!event) {
    throw new Error("Failed to insert event");
  }

  return event;
};

/**
 * Updates or creates an event based on request data
 */
export const handleEvent = async (
  ctx: Context,
  updateRequest: {
    locationId: number;
    aoId?: number | null;
    originalEventId?: number | null;
    eventName?: string | null;
    eventDescription?: string | null;
    eventStartDate?: string | null;
    eventEndDate?: string | null;
    eventStartTime?: string | null;
    eventEndTime?: string | null;
    eventDayOfWeek?: DayOfWeek | null;
    eventSeriesId?: number | null;
    eventRecurrencePattern?: "weekly" | "monthly" | null;
    eventRecurrenceInterval?: number | null;
    eventIndexWithinInterval?: number | null;
    eventMeta?: EventMeta | null;
    eventContactEmail?: string | null;
    reviewedBy?: string | null;
  },
): Promise<number> => {
  let eventId: number | undefined = updateRequest.originalEventId ?? undefined;

  if (eventId) {
    // Update existing event
    const updated = await updateEvent(ctx, { ...updateRequest, eventId });
    eventId = updated.id;
  } else {
    const aoId = updateRequest.aoId;
    if (!aoId) {
      throw new Error("AO ID is required to create an event");
    }

    if (!updateRequest.eventName) {
      throw new Error("Event name is required to create an event");
    }

    // Create new event
    const values = {
      ...updateRequest,
      eventId: undefined, // remove eventId from the values
      eventStartDate:
        updateRequest.eventStartDate ?? dayjs().format("YYYY-MM-DD"),
      eventName: updateRequest.eventName ?? "",
      aoId,
    };
    const event = await insertEvent(ctx, values);
    eventId = event.id;
  }

  return eventId;
};

/**
 * Updates event types for an event
 */
export const updateEventTypes = async (
  ctx: Context,
  {
    eventId,
    eventTypeIds,
  }: {
    eventId: number;
    eventTypeIds?: number[] | null;
  },
): Promise<void> => {
  // Delete existing event types
  await ctx.db
    .delete(schema.eventsXEventTypes)
    .where(eq(schema.eventsXEventTypes.eventId, eventId));

  // Add new event types if provided
  if (eventTypeIds?.length) {
    await ctx.db.insert(schema.eventsXEventTypes).values(
      eventTypeIds.map((id) => ({
        eventId,
        eventTypeId: id,
      })),
    );
  }
};
