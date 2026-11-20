/**
 * Cascade Service
 *
 * Reusable functions for cascading operations between series (events) and event instances.
 * This handles creating instances when series are created, updating them when series are edited,
 * and soft-deleting them when series or orgs are deleted.
 */

import type { AnyColumn, SQL } from "@acme/db";
import { and, eq, gte, inArray, isNotNull, or, schema, sql } from "@acme/db";
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
  eventTypeIds?: number[];
  eventTagIds?: number[];
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
        or(
          isNotNull(schema.events.recurrencePattern),
          isNotNull(schema.events.dayOfWeek),
        ),
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
  db: Pick<AppDb, "update">,
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
 * Reactivate existing future event instances for a series (including today).
 * This only changes status; it does not generate instances or alter exceptions.
 */
export async function reactivateFutureInstancesForSeries(
  db: AppDb,
  seriesId: number,
  startDate?: string,
): Promise<number> {
  const fromDate = startDate ?? getCurrentDate();

  const result = await db
    .update(schema.eventInstances)
    .set({ isActive: true })
    .where(
      and(
        eq(schema.eventInstances.seriesId, seriesId),
        eq(schema.eventInstances.isActive, false),
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
  return db.transaction((tx) =>
    createEventInstancesForSeriesInTransaction(
      tx as unknown as AppDb,
      series,
      yearsAhead,
      fromDate,
    ),
  );
}

async function createEventInstancesForSeriesInTransaction(
  db: AppDb,
  series: SeriesData,
  yearsAhead: number,
  fromDate?: string,
): Promise<number> {
  if (!series.dayOfWeek) {
    // Not a valid recurring series
    return 0;
  }

  const seriesStartDate = parseDate(series.startDate);
  const today = fromDate ? parseDate(fromDate) : getCurrentDate();

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
  const recurrencePattern = series.recurrencePattern ?? "weekly";

  const instanceRecords: (typeof schema.eventInstances.$inferInsert)[] = [];

  // Walk from the series start, not from startDate, so the recurrenceInterval
  // phase stays anchored to the series when generation begins at a later
  // cutoff. Dates before startDate only advance the counters.
  let currentDate = new Date(seriesStartDate);
  let currentInterval = 1;
  let currentIndex = 0;

  // For monthly series, figure out which occurrence of the day of week we're at
  if (recurrencePattern === "monthly") {
    currentDate = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      1,
    );

    while (currentDate < seriesStartDate) {
      if (getDayOfWeek(currentDate) === series.dayOfWeek) {
        currentIndex++;
      }
      currentDate = addDays(currentDate, 1);
    }
  }

  // Event creation algorithm
  while (currentDate <= endDate) {
    if (getDayOfWeek(currentDate) === series.dayOfWeek) {
      currentIndex++;

      const shouldCreate =
        recurrencePattern === "weekly" ||
        (indexWithinInterval === 0
          ? addDays(currentDate, 7).getMonth() !== currentDate.getMonth()
          : currentIndex === indexWithinInterval);

      if (shouldCreate && currentInterval === 1 && currentDate >= startDate) {
        instanceRecords.push({
          name: series.name,
          description: series.description,
          orgId: series.orgId,
          locationId: series.locationId,
          startDate: formatDate(currentDate),
          endDate: formatDate(currentDate),
          startTime: series.startTime,
          endTime: series.endTime,
          isActive: series.isActive,
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
  if (series.eventTypeIds?.length && created.length > 0) {
    await db.insert(schema.eventInstancesXEventTypes).values(
      created.flatMap((instance) =>
        series.eventTypeIds!.map((eventTypeId) => ({
          eventInstanceId: instance.id,
          eventTypeId,
        })),
      ),
    );
  }

  // Handle event tag join table
  if (series.eventTagIds?.length && created.length > 0) {
    await db.insert(schema.eventTagsXEventInstances).values(
      created.flatMap((instance) =>
        series.eventTagIds!.map((eventTagId) => ({
          eventInstanceId: instance.id,
          eventTagId,
        })),
      ),
    );
  }

  return created.length;
}

/**
 * Fields an admin can change on one date of a series. On a date marked with a
 * series exception, a series edit keeps the date's own value for these (see
 * updateFutureInstancesInTransaction). The rest (privacy, org, highlight,
 * meta) always follow the series: a series made private must hide every date.
 */
const OVERRIDABLE_INSTANCE_FIELDS = [
  "locationId",
  "startTime",
  "endTime",
  "description",
  "name",
] as const;
type OverridableInstanceField = (typeof OVERRIDABLE_INSTANCE_FIELDS)[number];

const isOverridableField = (field: string): field is OverridableInstanceField =>
  (OVERRIDABLE_INSTANCE_FIELDS as readonly string[]).includes(field);

/**
 * Update future event instances with non-structural changes from series
 */
export async function updateFutureInstances(
  db: AppDb,
  series: SeriesData,
  startDate?: string,
  options?: {
    /**
     * The series' values before this edit. When given, a date with a series
     * exception keeps its own value for any overridable field that differs
     * from these.
     */
    previous?: Pick<SeriesData, OverridableInstanceField>;
    fields?: (
      | "locationId"
      | "startTime"
      | "endTime"
      | "isPrivate"
      | "meta"
      | "description"
      | "highlight"
      | "name"
      | "orgId"
      | "eventTypeIds"
      | "eventTagIds"
    )[];
  },
): Promise<number> {
  return db.transaction((tx) =>
    updateFutureInstancesInTransaction(
      tx as unknown as AppDb,
      series,
      startDate,
      options,
    ),
  );
}

async function updateFutureInstancesInTransaction(
  db: AppDb,
  series: SeriesData,
  startDate?: string,
  options?: Parameters<typeof updateFutureInstances>[3],
): Promise<number> {
  const fromDate = startDate ?? getCurrentDate();

  // Get IDs of future instances
  const futureInstances = await db
    .select({
      id: schema.eventInstances.id,
      seriesException: schema.eventInstances.seriesException,
    })
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
  const associationInstanceIds = options?.fields
    ? futureInstances
        .filter(({ seriesException }) => seriesException !== "closed")
        .map(({ id }) => id)
    : instanceIds;

  // Status-transition detail synchronization only writes fields that actually
  // changed on the series, preserving per-instance overrides for everything else.
  const fields = options?.fields;
  const shouldUpdate = (field: NonNullable<typeof fields>[number]) =>
    fields === undefined || fields.includes(field);

  // Update the instances
  const instanceUpdate = {
    ...(shouldUpdate("locationId") ? { locationId: series.locationId } : {}),
    ...(shouldUpdate("startTime") ? { startTime: series.startTime } : {}),
    ...(shouldUpdate("endTime") ? { endTime: series.endTime } : {}),
    ...(shouldUpdate("isPrivate") ? { isPrivate: series.isPrivate } : {}),
    ...(shouldUpdate("meta") ? { meta: series.meta } : {}),
    ...(shouldUpdate("description") ? { description: series.description } : {}),
    ...(shouldUpdate("highlight") ? { highlight: series.highlight } : {}),
    ...(shouldUpdate("name") ? { name: series.name } : {}),
    ...(shouldUpdate("orgId") ? { orgId: series.orgId } : {}),
  };

  // With the series' previous values, an overridable field keeps a date's own
  // value only when the date carries a series exception (closed, different
  // time) and its value differs from the series' previous one. Every other
  // date follows the series as before, including rows that drifted from it.
  // Start and end time are judged as a pair so a date can't end up finishing
  // before it starts. All SET expressions read the row's values before the
  // update, so one statement does it.
  const previous = options?.previous;
  const instance = schema.eventInstances;
  const sameAs = (column: SQL | AnyColumn, value: unknown): SQL =>
    sql`${column} IS NOT DISTINCT FROM ${value}`;
  const matchesPrevious = (field: OverridableInstanceField): SQL => {
    if (!previous) return sql`TRUE`;
    if (field === "startTime" || field === "endTime") {
      const start = sameAs(instance.startTime, previous.startTime);
      const end = sameAs(instance.endTime, previous.endTime);
      return sql`(${start} AND ${end})`;
    }
    return sameAs(instance[field], previous[field]);
  };
  const update: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(instanceUpdate)) {
    if (!previous || !isOverridableField(field)) {
      update[field] = value;
      continue;
    }
    const follows = sql`${instance.seriesException} IS NULL OR ${matchesPrevious(field)}`;
    update[field] =
      sql`CASE WHEN ${follows} THEN ${value} ELSE ${instance[field]} END`;
  }
  if (Object.keys(update).length > 0) {
    await db
      .update(schema.eventInstances)
      .set(update)
      .where(inArray(schema.eventInstances.id, instanceIds));
  }

  // Update event types if provided
  if (
    series.eventTypeIds !== undefined &&
    shouldUpdate("eventTypeIds") &&
    associationInstanceIds.length > 0
  ) {
    // Delete existing event type associations
    await db
      .delete(schema.eventInstancesXEventTypes)
      .where(
        inArray(
          schema.eventInstancesXEventTypes.eventInstanceId,
          associationInstanceIds,
        ),
      );

    // Add new associations
    if (series.eventTypeIds.length > 0) {
      await db.insert(schema.eventInstancesXEventTypes).values(
        associationInstanceIds.flatMap((id) =>
          series.eventTypeIds!.map((eventTypeId) => ({
            eventInstanceId: id,
            eventTypeId,
          })),
        ),
      );
    }
  }

  // Update event tags if provided (an empty array intentionally clears them).
  if (
    series.eventTagIds !== undefined &&
    shouldUpdate("eventTagIds") &&
    associationInstanceIds.length > 0
  ) {
    await db
      .delete(schema.eventTagsXEventInstances)
      .where(
        inArray(
          schema.eventTagsXEventInstances.eventInstanceId,
          associationInstanceIds,
        ),
      );

    if (series.eventTagIds.length > 0) {
      await db.insert(schema.eventTagsXEventInstances).values(
        associationInstanceIds.flatMap((id) =>
          series.eventTagIds!.map((eventTagId) => ({
            eventInstanceId: id,
            eventTagId,
          })),
        ),
      );
    }
  }

  return futureInstances.length;
} /**
 * Recreate future event instances (delete and recreate)
 * Used when structural changes are made to a series
 */
export async function recreateFutureInstances(
  db: AppDb,
  series: SeriesData,
  startDate?: string,
  yearsAhead = 4,
): Promise<{ deleted: number; created: number }> {
  return db.transaction((tx) =>
    recreateFutureInstancesInTransaction(
      tx as unknown as AppDb,
      series,
      startDate,
      yearsAhead,
    ),
  );
}

async function recreateFutureInstancesInTransaction(
  db: AppDb,
  series: SeriesData,
  startDate: string | undefined,
  yearsAhead: number,
): Promise<{ deleted: number; created: number }> {
  const fromDate = startDate ?? getCurrentDate();

  // Delete existing future instances
  const deleted = await deleteFutureInstancesForSeries(db, series.id, fromDate);

  // Create new instances
  const created = await createEventInstancesForSeriesInTransaction(
    db,
    series,
    yearsAhead,
    fromDate,
  );

  return { deleted, created };
}
