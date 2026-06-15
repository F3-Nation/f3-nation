import { EventTypes } from "@acme/shared/app/enums";

import { and, eq } from "..";
import { schema } from "..";
import type { AppDb } from "../client";
import { AOS, EVENT_TYPES } from "./data";

const DAYS_OF_WEEK = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function parseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year!, month! - 1, day);
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDayOfWeek(date: Date): (typeof DAYS_OF_WEEK)[number] {
  return DAYS_OF_WEEK[date.getDay()]!;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

async function seedEventInstancesForCurrentYear(
  db: AppDb,
  event: typeof schema.events.$inferSelect,
): Promise<number> {
  if (!event.dayOfWeek) {
    return 0;
  }

  const currentYear = new Date().getFullYear();
  const yearStart = new Date(currentYear, 0, 1);
  const yearEnd = new Date(currentYear, 11, 31);
  const eventStartDate = parseDate(event.startDate);
  const eventEndDate = event.endDate ? parseDate(event.endDate) : yearEnd;

  const startDate = eventStartDate > yearStart ? eventStartDate : yearStart;
  const endDate = eventEndDate < yearEnd ? eventEndDate : yearEnd;

  if (startDate > endDate) {
    return 0;
  }

  const existingInstances = await db
    .select({ startDate: schema.eventInstances.startDate })
    .from(schema.eventInstances)
    .where(eq(schema.eventInstances.seriesId, event.id));
  const existingInstanceDates = new Set(
    existingInstances.map((instance) => instance.startDate),
  );

  const instanceRecords: (typeof schema.eventInstances.$inferInsert)[] = [];
  let currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    if (getDayOfWeek(currentDate) === event.dayOfWeek) {
      const instanceDate = formatDate(currentDate);

      if (!existingInstanceDates.has(instanceDate)) {
        instanceRecords.push({
          orgId: event.orgId,
          locationId: event.locationId,
          seriesId: event.id,
          isActive: event.isActive,
          highlight: event.highlight,
          startDate: instanceDate,
          endDate: instanceDate,
          startTime: event.startTime,
          endTime: event.endTime,
          name: event.name,
          description: event.description,
          isPrivate: event.isPrivate,
          meta: event.meta,
        });
      }
    }

    currentDate = addDays(currentDate, 1);
  }

  if (instanceRecords.length === 0) {
    return 0;
  }

  const createdInstances = await db
    .insert(schema.eventInstances)
    .values(instanceRecords)
    .returning({ id: schema.eventInstances.id });

  const eventTypeAssociations = await db
    .select({ eventTypeId: schema.eventsXEventTypes.eventTypeId })
    .from(schema.eventsXEventTypes)
    .where(eq(schema.eventsXEventTypes.eventId, event.id));

  if (eventTypeAssociations.length > 0 && createdInstances.length > 0) {
    await db
      .insert(schema.eventInstancesXEventTypes)
      .values(
        createdInstances.flatMap((instance) =>
          eventTypeAssociations.map(({ eventTypeId }) => ({
            eventInstanceId: instance.id,
            eventTypeId,
          })),
        ),
      )
      .onConflictDoNothing();
  }

  return createdInstances.length;
}

export async function seedEventTypes(
  db: AppDb,
): Promise<(typeof schema.eventTypes.$inferSelect)[]> {
  const existingEventTypes = await db.select().from(schema.eventTypes);
  const existingNames = new Set(existingEventTypes.map((et) => et.name));
  const eventTypesToInsert = EVENT_TYPES.filter(
    (et) => !existingNames.has(et.name),
  );
  if (eventTypesToInsert.length > 0) {
    await db.insert(schema.eventTypes).values(eventTypesToInsert);
    console.log(`  + Inserted ${eventTypesToInsert.length} event type(s)`);
  } else {
    console.log(`  ✓ Event types already seeded`);
  }
  return db.select().from(schema.eventTypes);
}

export async function seedAoLocationsAndEvents(
  db: AppDb,
  aoIds: Record<string, number>,
  regionIds: Record<string, number>,
  allEventTypes: (typeof schema.eventTypes.$inferSelect)[],
): Promise<void> {
  for (const ao of AOS) {
    const regionId = regionIds[ao.regionName];
    if (!regionId) throw new Error(`Region not found: ${ao.regionName}`);
    const aoId = aoIds[ao.name];
    if (!aoId) throw new Error(`AO not found: ${ao.name}`);

    const { latitude, longitude, addressCity, addressState } = ao;

    const [existingLoc] = await db
      .select()
      .from(schema.locations)
      .where(
        and(
          eq(schema.locations.name, ao.name),
          eq(schema.locations.orgId, regionId),
        ),
      );

    let locationId: number | undefined;
    if (!existingLoc) {
      const [insertedLoc] = await db
        .insert(schema.locations)
        .values({
          orgId: regionId,
          name: ao.name,
          isActive: true,
          latitude,
          longitude,
          addressCity,
          addressState,
          addressCountry: "US",
        })
        .returning({ id: schema.locations.id });
      locationId = insertedLoc?.id;
      console.log(`  + Inserted location for AO: ${ao.name}`);
    } else {
      locationId = existingLoc.id;
    }

    if (locationId) {
      const [existingEvent] = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.orgId, aoId));

      if (!existingEvent) {
        const [insertedEvent] = await db
          .insert(schema.events)
          .values({
            orgId: aoId,
            locationId,
            isActive: true,
            highlight: false,
            startDate: "2025-01-06",
            startTime: "05:30",
            endTime: "06:15",
            name: `${ao.name} Bootcamp`,
            dayOfWeek: "monday",
            recurrencePattern: "weekly",
            recurrenceInterval: 1,
          })
          .returning({ id: schema.events.id });

        if (insertedEvent) {
          const bootcampType = allEventTypes.find(
            (et) => et.name === (EventTypes.Bootcamp as string),
          );
          if (bootcampType) {
            await db
              .insert(schema.eventsXEventTypes)
              .values({
                eventId: insertedEvent.id,
                eventTypeId: bootcampType.id,
              })
              .onConflictDoNothing();
          }
          console.log(`  + Inserted event for AO: ${ao.name}`);
        }
      }

      const [event] = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.orgId, aoId));

      if (event) {
        const insertedInstanceCount = await seedEventInstancesForCurrentYear(
          db,
          event,
        );
        if (insertedInstanceCount > 0) {
          console.log(
            `  + Inserted ${insertedInstanceCount} event instance(s) for AO: ${ao.name}`,
          );
        }
      }
    }
  }
}
