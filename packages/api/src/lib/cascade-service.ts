/**
 * Cascade Service
 *
 * Reusable functions for cascading operations between series (events) and event instances.
 * This handles creating instances when series are created, updating them when series are edited,
 * and soft-deleting them when series or orgs are deleted.
 */

import { and, eq, gte, inArray, isNotNull, schema } from "@acme/db";
import type { AppDb } from "@acme/db/client";
import type { DayOfWeek, EventCadence } from "@acme/shared/app/enums";

// Type for a series (event with recurrence pattern)
export interface SeriesData {
  id: number;
  orgId: number;
  locationId: number | null;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  dayOfWeek: DayOfWeek | null;
  recurrencePattern: EventCadence | null;
  recurrenceInterval: number | null;
  indexWithinInterval: number | null;
  isActive: boolean;
  isPrivate: boolean;
  highlight: boolean;
  meta: Record<string, unknown> | null;
  eventTypeId?: number;
  eventTagId?: number;
}

// Structural fields that require recreating instances
const STRUCTURAL_FIELDS = [
  "dayOfWeek",
  "recurrencePattern",
  "recurrenceInterval",
  "indexWithinInterval",
  "startDate",
  "endDate",
] as const;

/**
 * Check if changes between existing and updated series are structural
 * (require recreating instances vs just updating them in place)
 */
export function isStructuralChange(
  existing: Partial<SeriesData>,
  updated: Partial<SeriesData>,
): boolean {
  for (const field of STRUCTURAL_FIELDS) {
    if (
      existing[field] !== undefined &&
      updated[field] !== undefined &&
      existing[field] !== updated[field]
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Get today's date in YYYY-MM-DD format (UTC)
 */
function getCurrentDate(): string {
  return new Date().toISOString().split("T")[0]!;
}

/**
 * Soft delete all series (events with recurrence patterns) belonging to an org
 */
export async function softDeleteSeriesForOrg(
  db: AppDb,
  orgId: number,
): Promise<number> {
  const result = await db
    .update(schema.events)
    .set({ isActive: false })
    .where(
      and(
        eq(schema.events.orgId, orgId),
        eq(schema.events.isActive, true),
        isNotNull(schema.events.recurrencePattern),
      ),
    )
    .returning({ id: schema.events.id });

  return result.length;
}

/**
 * Soft delete future event instances for an org (starting from today or specified date)
 */
export async function softDeleteFutureInstancesForOrg(
  db: AppDb,
  orgId: number,
  startDate?: string,
): Promise<number> {
  const fromDate = startDate ?? getCurrentDate();

  const result = await db
    .update(schema.eventInstances)
    .set({ isActive: false })
    .where(
      and(
        eq(schema.eventInstances.orgId, orgId),
        eq(schema.eventInstances.isActive, true),
        gte(schema.eventInstances.startDate, fromDate),
      ),
    )
    .returning({ id: schema.eventInstances.id });

  return result.length;
}

/**
 * Soft delete future event instances for a series (starting from today or specified date)
 */
export async function softDeleteFutureInstancesForSeries(
  db: AppDb,
  seriesId: number,
  startDate?: string,
): Promise<number> {
  const fromDate = startDate ?? getCurrentDate();

  const result = await db
    .update(schema.eventInstances)
    .set({ isActive: false })
    .where(
      and(
        eq(schema.eventInstances.seriesId, seriesId),
        eq(schema.eventInstances.isActive, true),
        gte(schema.eventInstances.startDate, fromDate),
      ),
    )
    .returning({ id: schema.eventInstances.id });

  return result.length;
}

/**
 * Hard delete future event instances for a series (used when recreating)
 */
export async function deleteFutureInstancesForSeries(
  db: AppDb,
  seriesId: number,
  startDate?: string,
): Promise<number> {
  const fromDate = startDate ?? getCurrentDate();

  const result = await db
    .delete(schema.eventInstances)
    .where(
      and(
        eq(schema.eventInstances.seriesId, seriesId),
        gte(schema.eventInstances.startDate, fromDate),
      ),
    )
    .returning({ id: schema.eventInstances.id });

  return result.length;
}

/**
 * Parse a date string (YYYY-MM-DD) to a Date object
 */
function parseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year!, month! - 1, day);
}

/**
 * Format a Date to YYYY-MM-DD string
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get the day of week name from a Date object
 */
function getDayOfWeek(date: Date): DayOfWeek {
  const days: DayOfWeek[] = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  return days[date.getDay()]!;
}

/**
 * Add days to a Date object
 */
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Create event instances for a series based on its recurrence pattern.
 * Algorithm ported from Python reference implementation.
 *
 * @param db Database connection
 * @param series The series (event) to create instances for
 * @param yearsAhead How many years of instances to create (default 4)
 * @param fromDate Optional start date (defaults to today)
 * @returns Number of instances created
 */
export async function createEventInstancesForSeries(
  db: AppDb,
  series: SeriesData,
  yearsAhead = 4,
  fromDate?: string,
): Promise<number> {
  if (!series.dayOfWeek || !series.recurrencePattern) {
    // Not a valid recurring series
    return 0;
  }

  const seriesStartDate = parseDate(series.startDate);
  const today = fromDate ? parseDate(fromDate) : new Date();

  // Start from the later of series start date or today
  const startDate = seriesStartDate > today ? seriesStartDate : new Date(today);

  // End date is series end date or X years from start
  const endDate = series.endDate
    ? parseDate(series.endDate)
    : new Date(
        startDate.getFullYear() + yearsAhead,
        startDate.getMonth(),
        startDate.getDate(),
      );

  const maxInterval = series.recurrenceInterval ?? 1;
  const indexWithinInterval = series.indexWithinInterval ?? 1;
  const recurrencePattern = series.recurrencePattern;

  const instanceRecords: (typeof schema.eventInstances.$inferInsert)[] = [];

  let currentDate = new Date(startDate);
  let currentInterval = 1;
  let currentIndex = 0;

  // For monthly series, figure out which occurrence of the day of week we're at
  if (recurrencePattern === "monthly") {
    currentDate = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      1,
    );
    const actualStart = new Date(startDate);

    while (currentDate <= actualStart) {
      if (getDayOfWeek(currentDate) === series.dayOfWeek) {
        currentIndex++;
      }
      currentDate = addDays(currentDate, 1);
    }
    // Reset to iterate from start
    currentDate = new Date(startDate);
  }

  // Event creation algorithm
  while (currentDate <= endDate) {
    if (getDayOfWeek(currentDate) === series.dayOfWeek) {
      currentIndex++;

      const shouldCreate =
        recurrencePattern === "weekly" || currentIndex === indexWithinInterval;

      if (shouldCreate && currentInterval === 1) {
        instanceRecords.push({
          name: series.name,
          description: series.description,
          orgId: series.orgId,
          locationId: series.locationId,
          startDate: formatDate(currentDate),
          endDate: formatDate(currentDate),
          startTime: series.startTime,
          endTime: series.endTime,
          isActive: true,
          seriesId: series.id,
          isPrivate: series.isPrivate,
          meta: series.meta,
          highlight: series.highlight,
        });
      }

      if (shouldCreate) {
        currentInterval =
          currentInterval < maxInterval ? currentInterval + 1 : 1;
      }
    }

    currentDate = addDays(currentDate, 1);

    // Reset index at the start of each month (for monthly recurrence)
    if (currentDate.getDate() === 1) {
      currentIndex = 0;
    }
  }

  if (instanceRecords.length === 0) {
    return 0;
  }

  // Batch insert all instances
  const created = await db
    .insert(schema.eventInstances)
    .values(instanceRecords)
    .returning({ id: schema.eventInstances.id });

  // Handle event type join table
  if (series.eventTypeId && created.length > 0) {
    await db.insert(schema.eventInstancesXEventTypes).values(
      created.map((instance) => ({
        eventInstanceId: instance.id,
        eventTypeId: series.eventTypeId!,
      })),
    );
  }

  // Handle event tag join table
  if (series.eventTagId && created.length > 0) {
    await db.insert(schema.eventTagsXEventInstances).values(
      created.map((instance) => ({
        eventInstanceId: instance.id,
        eventTagId: series.eventTagId!,
      })),
    );
  }

  return created.length;
}

/**
 * Update future event instances with non-structural changes from series
 */
export async function updateFutureInstances(
  db: AppDb,
  series: SeriesData,
  startDate?: string,
): Promise<number> {
  const fromDate = startDate ?? getCurrentDate();

  // Get IDs of future instances
  const futureInstances = await db
    .select({ id: schema.eventInstances.id })
    .from(schema.eventInstances)
    .where(
      and(
        eq(schema.eventInstances.seriesId, series.id),
        gte(schema.eventInstances.startDate, fromDate),
      ),
    );

  if (futureInstances.length === 0) {
    return 0;
  }

  const instanceIds = futureInstances.map((i) => i.id);

  // Update the instances
  await db
    .update(schema.eventInstances)
    .set({
      locationId: series.locationId,
      startTime: series.startTime,
      endTime: series.endTime,
      isPrivate: series.isPrivate,
      meta: series.meta,
      description: series.description,
      highlight: series.highlight,
    })
    .where(inArray(schema.eventInstances.id, instanceIds));

  // Update event types if provided
  if (series.eventTypeId !== undefined) {
    // Delete existing event type associations
    await db
      .delete(schema.eventInstancesXEventTypes)
      .where(
        inArray(schema.eventInstancesXEventTypes.eventInstanceId, instanceIds),
      );

    // Add new associations
    if (series.eventTypeId) {
      await db.insert(schema.eventInstancesXEventTypes).values(
        instanceIds.map((id) => ({
          eventInstanceId: id,
          eventTypeId: series.eventTypeId!,
        })),
      );
    }
  }

  // Update event tags if provided
  if (series.eventTagId !== undefined) {
    // Delete existing event tag associations
    await db
      .delete(schema.eventTagsXEventInstances)
      .where(
        inArray(schema.eventTagsXEventInstances.eventInstanceId, instanceIds),
      );

    // Add new associations
    if (series.eventTagId) {
      await db.insert(schema.eventTagsXEventInstances).values(
        instanceIds.map((id) => ({
          eventInstanceId: id,
          eventTagId: series.eventTagId!,
        })),
      );
    }
  }

  return futureInstances.length;
}

/**
 * Recreate future event instances (delete and recreate)
 * Used when structural changes are made to a series
 */
export async function recreateFutureInstances(
  db: AppDb,
  series: SeriesData,
  startDate?: string,
  yearsAhead = 4,
): Promise<{ deleted: number; created: number }> {
  const fromDate = startDate ?? getCurrentDate();

  // Delete existing future instances
  const deleted = await deleteFutureInstancesForSeries(db, series.id, fromDate);

  // Create new instances
  const created = await createEventInstancesForSeries(
    db,
    series,
    yearsAhead,
    fromDate,
  );

  return { deleted, created };
}
