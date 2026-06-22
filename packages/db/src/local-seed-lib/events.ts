import { EventTypes } from "@acme/shared/app/enums";

import { and, eq } from "..";
import { schema } from "..";
import type { AppDb } from "../client";
import { AOS, EVENT_TYPES } from "./data";

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
    }
  }
}
