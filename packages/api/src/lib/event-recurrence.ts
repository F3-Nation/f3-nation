import type { EventCadence } from "@acme/shared/app/enums";

/**
 * Every event row has a cadence. When the caller gives none it is weekly,
 * every week: the same default createEventInstancesForSeries uses.
 */
export function defaultRecurrence(row: {
  recurrencePattern: EventCadence | null | undefined;
  recurrenceInterval: number | null | undefined;
}): { recurrencePattern: EventCadence; recurrenceInterval: number } {
  return {
    recurrencePattern: row.recurrencePattern ?? "weekly",
    recurrenceInterval: row.recurrenceInterval ?? 1,
  };
}
