import dayjs from "dayjs";

import type { DayOfWeek } from "@acme/shared/app/enums";
import {
  START_END_TIME_DB_FORMAT,
  START_END_TIME_DISPLAY_FORMAT,
} from "@acme/shared/app/constants";
import { getReadableDayOfWeek } from "@acme/shared/app/functions";

/**
 * Sunday = 0 … Saturday = 6, aligned with `Date#getUTCDay()`.
 *
 * Deliberately not `DayOfWeek` from `@acme/shared/app/enums` — that array is
 * monday-first, so indexing it by `getUTCDay()` would shift every day by one.
 */
const DAYS_OF_WEEK: DayOfWeek[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export function dateToDayOfWeek(dateStr: string): DayOfWeek {
  const date = new Date(`${dateStr}T00:00:00Z`);
  return DAYS_OF_WEEK[date.getUTCDay()] ?? "sunday";
}

/**
 * Orders upcoming instances soonest-first for display, since the API's
 * `upcomingInstances` query has no `ORDER BY`.
 *
 * `startTime` breaks ties within a day; instances without one sort first
 * (an all-day change covers the whole day). Both fields are already
 * lexicographically ordered (`YYYY-MM-DD`, `HHmm`), so no date parsing is
 * needed. Returns a new array — callers may hold a memoized reference.
 */
export function sortUpcomingInstancesByDate<
  T extends { startDate: string; startTime: string | null },
>(instances: readonly T[]): T[] {
  return [...instances].sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) ||
      (a.startTime ?? "").localeCompare(b.startTime ?? ""),
  );
}

export const getWhenFromWorkout = (params: {
  startTime: string | null;
  endTime?: string | null;
  dayOfWeek: DayOfWeek | null;
  condensed?: boolean;
}) => {
  const event = params;
  const condensed = params.condensed ?? false;
  const startTimeRaw = !event.startTime
    ? undefined
    : dayjs(event.startTime, START_END_TIME_DB_FORMAT).format(
        START_END_TIME_DISPLAY_FORMAT,
      );

  const endTimeRaw = !event.endTime
    ? undefined
    : dayjs(event.endTime, START_END_TIME_DB_FORMAT).format(
        START_END_TIME_DISPLAY_FORMAT,
      );

  const startTime = !condensed
    ? startTimeRaw
    : startTimeRaw?.replace(":00", "");

  const endTime = !condensed ? endTimeRaw : endTimeRaw?.replace(":00", "");

  const duration =
    event.endTime && event.startTime
      ? dayjs(event.endTime, START_END_TIME_DB_FORMAT).diff(
          dayjs(event.startTime, START_END_TIME_DB_FORMAT),
          "minutes",
        )
      : null;

  const dayOfTheWeek = getReadableDayOfWeek(event.dayOfWeek);

  const dayOfTheWeekText = dayOfTheWeek ? `${dayOfTheWeek} ` : "";
  const timeText =
    startTime && endTime
      ? `${startTime} - ${endTime} `
      : startTime
        ? `${startTime} `
        : "";
  const durationText = duration ? `(${duration}min)` : "";

  return `${dayOfTheWeekText}${timeText}${durationText}`.trim();
};
