import type { DayOfWeek } from "@acme/shared/app/enums";

/** Sunday = 0 … Saturday = 6, aligned with `Date#getUTCDay()`. */
export const DAYS_OF_WEEK: DayOfWeek[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
