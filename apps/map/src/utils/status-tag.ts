import type { MapEventStatusDetail } from "~/utils/event-status-map";
import type { MapStatus } from "~/utils/types";
import { formatStartTime } from "~/utils/ao-schedule-summary";

/**
 * "2026-11-26" → "Thu Nov 26". Date-only values are calendar dates, so they
 * are read and formatted in UTC.
 */
export const formatTagDate = (isoDate: string, withWeekday = true) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date
    .toLocaleDateString("en-US", {
      ...(withWeekday ? { weekday: "short" } : {}),
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    })
    .replace(",", "");
};

const time = (hhmm: string | null | undefined) =>
  hhmm && /^\d{4}$/.test(hhmm) ? formatStartTime(hhmm) : null;

export interface StatusTag {
  status: NonNullable<MapStatus>;
  text: string;
}

/**
 * The short label a row or the detail shows next to a status color, e.g.
 * "Closed Sat Nov 22", "Thu Nov 26: 7:00 AM" or
 * "Special: Fri Nov 27, 7:00 AM Convergence".
 */
export function statusTagText(
  detail: Pick<
    MapEventStatusDetail,
    "status" | "kind" | "date" | "startTime" | "closedThrough"
  >,
  name?: string | null,
): string {
  const day = formatTagDate(detail.date);
  const at = time(detail.startTime);

  if (detail.kind === "ends") return `Ends ${day}`;
  if (detail.kind === "starts") return `Starts ${day}`;

  switch (detail.status) {
    case "closed":
      return detail.closedThrough
        ? `Closed ${formatTagDate(detail.date, false)} – ${formatTagDate(detail.closedThrough, false)}`
        : `Closed ${day}`;
    case "different-time":
      return at ? `${day}: ${at}` : `Time change ${day}`;
    case "event-instance":
      return `Special: ${day}${at ? `, ${at}` : ""}${name ? ` ${name}` : ""}`;
    case "miscellaneous":
      return [`Change ${day}`, name].filter(Boolean).join(": ");
  }
}

interface TaggableEvent {
  id: number;
  name: string;
  startDate: string | null;
  startTime: string | null;
  mapStatus: MapStatus;
  statusDetail?: MapEventStatusDetail | null;
}

const STATUS_PRIORITY: NonNullable<MapStatus>[] = [
  "closed",
  "different-time",
  "miscellaneous",
  "event-instance",
];

/**
 * The one tag a nearby row shows: the most urgent status among its workouts
 * (same order as the pin color), and within it the soonest change. One-off
 * instances carry their own date and time; weekly workouts read theirs from
 * `statusDetail`.
 */
export function rowStatusTag(
  events: readonly TaggableEvent[],
): StatusTag | null {
  for (const status of STATUS_PRIORITY) {
    const candidates = events
      .filter((e) => e.mapStatus === status)
      .map((e) => {
        if (e.id < 0 && e.startDate) {
          return {
            detail: {
              status,
              kind: "instance" as const,
              date: e.startDate,
              startTime: e.startTime,
              closedThrough: null,
            },
            name: e.name,
          };
        }
        return e.statusDetail ? { detail: e.statusDetail, name: null } : null;
      })
      .filter((c) => c != null)
      .sort((a, b) => a.detail.date.localeCompare(b.detail.date));
    const first = candidates[0];
    if (first) {
      return { status, text: statusTagText(first.detail, first.name) };
    }
  }
  return null;
}
