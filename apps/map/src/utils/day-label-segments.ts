import type { DayOfWeek } from "@acme/shared/app/enums";

import type { MapStatus } from "~/utils/types";
import { getDominantStatus } from "~/utils/map-status-colors";

const ORDER: DayOfWeek[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const LABEL: Record<DayOfWeek, string> = {
  sunday: "Su",
  monday: "M",
  tuesday: "Tu",
  wednesday: "W",
  thursday: "Th",
  friday: "F",
  saturday: "Sa",
};

export interface DayLabelSegment {
  /** Null groups the workouts with no weekday. */
  day: DayOfWeek | null;
  label: string;
  eventIds: number[];
  status: MapStatus;
}

/**
 * The segments of a pin's day label ("Tu Th Sa"): one per weekday in week
 * order, however many workouts meet that day, colored by the most urgent
 * status among them.
 */
export function dayLabelSegments(
  events: readonly {
    id: number;
    dayOfWeek: DayOfWeek | null;
    mapStatus: MapStatus;
  }[],
): DayLabelSegment[] {
  const byDay = new Map<DayOfWeek | null, (typeof events)[number][]>();
  for (const event of events) {
    const list = byDay.get(event.dayOfWeek) ?? [];
    list.push(event);
    byDay.set(event.dayOfWeek, list);
  }
  return [...byDay.entries()]
    .sort(
      ([a], [b]) =>
        (a == null ? 7 : ORDER.indexOf(a)) - (b == null ? 7 : ORDER.indexOf(b)),
    )
    .map(([day, list]) => ({
      day,
      label: day ? LABEL[day] : "•",
      eventIds: list.map((e) => e.id),
      status: getDominantStatus(list),
    }));
}
