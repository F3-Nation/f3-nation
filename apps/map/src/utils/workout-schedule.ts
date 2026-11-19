import type { DayOfWeek } from "@acme/shared/app/enums";

import { formatStartTime, STRIP_DAYS } from "~/utils/ao-schedule-summary";

const dayIndex = (day: DayOfWeek) => STRIP_DAYS.findIndex((d) => d.day === day);

const validTime = (hhmm: string | null | undefined): hhmm is string =>
  !!hhmm && /^\d{4}$/.test(hhmm);

const minutes = (hhmm: string) =>
  Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));

/** "0515"–"0600" → "5:15–6:00 AM"; across noon both keep their AM/PM. */
export const formatTimeRange = (
  startTime: string | null | undefined,
  endTime: string | null | undefined,
) => {
  if (!validTime(startTime)) return null;
  if (!validTime(endTime)) return formatStartTime(startTime);
  const samePeriod = minutes(startTime) < 720 === minutes(endTime) < 720;
  return `${formatStartTime(startTime, !samePeriod)}–${formatStartTime(endTime)}`;
};

/** Whole minutes between two `HHmm` times, or null. */
export const durationMinutes = (
  startTime: string | null | undefined,
  endTime: string | null | undefined,
) => {
  if (!validTime(startTime) || !validTime(endTime)) return null;
  const diff = minutes(endTime) - minutes(startTime);
  return diff > 0 ? diff : null;
};

export interface GroupableEvent {
  id: number;
  name: string;
  dayOfWeek: DayOfWeek | null;
  startTime: string | null;
  endTime: string | null;
  eventTypes: { id: number; name: string }[];
  aoName: string | null;
}

export interface WorkoutGroup<E extends GroupableEvent = GroupableEvent> {
  /** Id of the group's first event; selecting the group selects it. */
  id: number;
  name: string;
  aoName: string | null;
  days: DayOfWeek[];
  startTime: string | null;
  endTime: string | null;
  eventTypes: { id: number; name: string }[];
  events: E[];
}

/**
 * Folds a location's workouts into what a visitor thinks of as one workout:
 * the same name, AO, time and types on several days ("Tuesday / Thursday ·
 * 5:15–6:00 AM"). One-off instances (negative ids) always stand alone.
 */
export function groupLocationWorkouts<E extends GroupableEvent>(
  events: readonly E[],
): WorkoutGroup<E>[] {
  const groups = new Map<string, WorkoutGroup<E>>();
  for (const event of events) {
    const key =
      event.id < 0
        ? `instance:${event.id}`
        : JSON.stringify([
            event.name,
            event.aoName,
            event.startTime,
            event.endTime,
            event.eventTypes.map((t) => t.id).sort((a, b) => a - b),
          ]);
    const existing = groups.get(key);
    if (existing) {
      existing.events.push(event);
      if (event.dayOfWeek && !existing.days.includes(event.dayOfWeek)) {
        existing.days.push(event.dayOfWeek);
      }
      continue;
    }
    groups.set(key, {
      id: event.id,
      name: event.name,
      aoName: event.aoName,
      days: event.dayOfWeek ? [event.dayOfWeek] : [],
      startTime: event.startTime,
      endTime: event.endTime,
      eventTypes: event.eventTypes,
      events: [event],
    });
  }
  for (const group of groups.values()) {
    group.days.sort((a, b) => dayIndex(a) - dayIndex(b));
  }
  return [...groups.values()];
}

/** "Tuesday / Thursday", or "TUE / THU" with `short`. */
export const formatDays = (days: readonly DayOfWeek[], short = false) =>
  days
    .map((day) => {
      const d = STRIP_DAYS[dayIndex(day)];
      return short ? d?.short.toUpperCase() : d?.long;
    })
    .filter(Boolean)
    .join(" / ");

/** The red schedule banner in the detail: "TUE / THU · 5:15–6:00 AM". */
export const formatScheduleBanner = (group: {
  days: readonly DayOfWeek[];
  startTime: string | null;
  endTime: string | null;
}) =>
  [
    formatDays(group.days, true),
    formatTimeRange(group.startTime, group.endTime),
  ]
    .filter(Boolean)
    .join(" · ");

const ICS_DAY: Record<DayOfWeek, string> = {
  sunday: "SU",
  monday: "MO",
  tuesday: "TU",
  wednesday: "WE",
  thursday: "TH",
  friday: "FR",
  saturday: "SA",
};

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-17" → the UTC calendar date. */
const parseDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

const isoDate = (date: Date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

/** Escapes text for an iCalendar TEXT value (RFC 5545 §3.3.11). */
const icsText = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

export interface IcsWorkout {
  id: number;
  name: string;
  days: readonly DayOfWeek[];
  startTime: string;
  endTime: string | null;
  /** Series start, or the one-off's date. */
  startDate: string | null;
  endDate: string | null;
  /** One-off instances don't repeat. */
  oneOff: boolean;
  location: string | null;
  description: string;
  url: string;
}

/**
 * A calendar file for a workout: a weekly RRULE on its days, or a single event
 * for a one-off. Times are "floating" (no time zone), so calendars show the
 * workout's local start time wherever the visitor opens it — the map has no
 * time zone for a location.
 */
export function buildWorkoutIcs(workout: IcsWorkout, today: string): string {
  const startMinutes = minutes(workout.startTime);
  const endMinutes =
    durationMinutes(workout.startTime, workout.endTime) != null &&
    workout.endTime
      ? minutes(workout.endTime)
      : startMinutes + 60;

  // First date on or after the later of today and the series start that falls
  // on one of the workout's days.
  let first = parseDate(
    workout.startDate && workout.startDate > today ? workout.startDate : today,
  );
  if (workout.oneOff && workout.startDate) {
    first = parseDate(workout.startDate);
  } else if (workout.days.length) {
    const wanted = new Set(workout.days.map(dayIndex));
    for (let i = 0; i < 7 && !wanted.has(first.getUTCDay()); i++) {
      first = new Date(first.getTime() + 86_400_000);
    }
  }

  const stamp = (date: Date, mins: number) =>
    `${isoDate(date).replace(/-/g, "")}T${pad(Math.floor(mins / 60))}${pad(mins % 60)}00`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//F3 Nation//F3 Map//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:f3-workout-${workout.id}@map.f3nation.com`,
    `DTSTAMP:${stamp(parseDate(today), 0)}Z`,
    `DTSTART:${stamp(first, startMinutes)}`,
    `DTEND:${stamp(first, endMinutes)}`,
  ];
  if (!workout.oneOff && workout.days.length) {
    const until = workout.endDate
      ? `;UNTIL=${workout.endDate.replace(/-/g, "")}T235959`
      : "";
    lines.push(
      `RRULE:FREQ=WEEKLY;BYDAY=${workout.days.map((d) => ICS_DAY[d]).join(",")}${until}`,
    );
  }
  lines.push(`SUMMARY:${icsText(workout.name)}`);
  if (workout.location) lines.push(`LOCATION:${icsText(workout.location)}`);
  lines.push(
    `DESCRIPTION:${icsText(workout.description)}`,
    `URL:${workout.url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  );
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * Parses a stored website into a safe external link: http(s) only, with
 * `https://` assumed when the scheme is missing. Returns null otherwise.
 */
export const safeExternalUrl = (value: string | null | undefined) => {
  if (!value?.trim()) return null;
  const raw = value.trim();
  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`,
    );
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
};
