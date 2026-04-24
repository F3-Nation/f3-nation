import type { DayOfWeek } from "@acme/shared/app/enums";

import { DAYS_OF_WEEK } from "~/utils/days-of-week";

export function dateToDayOfWeek(dateStr: string): DayOfWeek {
  const date = new Date(`${dateStr}T00:00:00`);
  return DAYS_OF_WEEK[date.getUTCDay()] ?? "sunday";
}
