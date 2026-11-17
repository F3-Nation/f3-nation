import type { DayOfWeek } from "@acme/shared/app/enums";

import type { MapStatus } from "~/utils/types";
import { getDominantStatus } from "~/utils/map-status-colors";

/** Sunday-first, matching the S M T W T F S strip on a nearby row. */
export const STRIP_DAYS: readonly {
  day: DayOfWeek;
  letter: string;
  short: string;
  long: string;
}[] = [
  { day: "sunday", letter: "S", short: "Sun", long: "Sunday" },
  { day: "monday", letter: "M", short: "Mon", long: "Monday" },
  { day: "tuesday", letter: "T", short: "Tue", long: "Tuesday" },
  { day: "wednesday", letter: "W", short: "Wed", long: "Wednesday" },
  { day: "thursday", letter: "T", short: "Thu", long: "Thursday" },
  { day: "friday", letter: "F", short: "Fri", long: "Friday" },
  { day: "saturday", letter: "S", short: "Sat", long: "Saturday" },
];

export interface ScheduleEvent {
  /** Negative ids are one-off instances; they color a day but set no time. */
  id: number;
  dayOfWeek: DayOfWeek | null;
  /** `HHmm`, as the API stores it. */
  startTime: string | null;
  eventTypes: { name: string }[];
  mapStatus?: MapStatus;
}

export interface ScheduleDay {
  day: DayOfWeek;
  letter: string;
  /** A weekly workout meets on this day. */
  meets: boolean;
  /** The most urgent upcoming status of any workout on this day. */
  status: MapStatus;
  /** The day's start time differs from the row's headline time. */
  differs: boolean;
}

export interface AoScheduleSummary {
  days: ScheduleDay[];
  /** Headline start time ("5:15 AM"), or null when there is none or times vary. */
  time: string | null;
  timesVary: boolean;
  /** One line explaining the days that don't follow the headline time. */
  detail: string | null;
  /** Every weekly workout in the row has a closed status. */
  allClosed: boolean;
}

const dayIndex = (day: DayOfWeek) => STRIP_DAYS.findIndex((d) => d.day === day);

const minutes = (hhmm: string) =>
  Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));

const isAm = (hhmm: string) => minutes(hhmm) < 12 * 60;

/** "0515" → "5:15 AM"; with `withPeriod` false → "5:15". */
export const formatStartTime = (hhmm: string, withPeriod = true) => {
  const total = minutes(hhmm);
  const hour24 = Math.floor(total / 60);
  const minute = total % 60;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const base = `${hour12}:${String(minute).padStart(2, "0")}`;
  if (!withPeriod) return base;
  return `${base} ${hour24 < 12 ? "AM" : "PM"}`;
};

/** "Tue", "Tue and Thu", "Mon, Tue and Thu". */
export const joinWithAnd = (items: string[]) => {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
};

/** Times listed together drop a repeated AM/PM: "5:00 · 5:30 AM". */
const formatTimeList = (times: string[], separator: string) => {
  const samePeriod = times.every((t) => isAm(t) === isAm(times[0] ?? t));
  if (!samePeriod) return times.map((t) => formatStartTime(t)).join(separator);
  return times
    .map((t, i) => formatStartTime(t, i === times.length - 1))
    .join(separator);
};

const typeLabel = (event: ScheduleEvent) =>
  event.eventTypes[0]?.name.toLowerCase() ?? "";

/**
 * Condenses an AO's weekly workouts at one location into the nearby row's
 * S M T W T F S strip, a headline start time, and at most one line for the
 * days that differ.
 *
 * The headline is the start time shared by the most weekly workouts (ties go
 * to the earlier time). When no time repeats and there is more than one,
 * the headline reads "Times vary" and the line lists every day's time.
 * Otherwise the line names the exceptions: a second workout on the same day
 * ("Wednesday: 5:15 AM bootcamp and 6:30 AM run"), an evening workout on
 * morning days ("Tue and Thu also 6:00 PM"), or a day that starts at another
 * time ("Saturday starts at 6:30 AM").
 */
export function summarizeAoSchedule(
  events: readonly ScheduleEvent[],
): AoScheduleSummary {
  const weekly = events.filter((e) => e.id > 0 && e.dayOfWeek != null);
  const timed = weekly.filter(
    (e): e is ScheduleEvent & { dayOfWeek: DayOfWeek; startTime: string } =>
      e.dayOfWeek != null && !!e.startTime && /^\d{4}$/.test(e.startTime),
  );

  const counts = new Map<string, number>();
  for (const e of timed) {
    counts.set(e.startTime, (counts.get(e.startTime) ?? 0) + 1);
  }
  const distinctTimes = [...counts.keys()].sort(
    (a, b) => minutes(a) - minutes(b),
  );
  const topCount = Math.max(0, ...counts.values());
  const timesVary = distinctTimes.length > 1 && topCount === 1;
  const main = timesVary
    ? null
    : (distinctTimes.find((t) => counts.get(t) === topCount) ?? null);

  // Group the timed workouts by day, earliest first within a day.
  const byDay = new Map<DayOfWeek, (typeof timed)[number][]>();
  for (const e of timed) {
    const list = byDay.get(e.dayOfWeek) ?? [];
    list.push(e);
    byDay.set(e.dayOfWeek, list);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => minutes(a.startTime) - minutes(b.startTime));
  }
  const orderedDays = [...byDay.keys()].sort(
    (a, b) => dayIndex(a) - dayIndex(b),
  );

  const differsDays = new Set<DayOfWeek>();
  const clauses: string[] = [];

  if (timesVary) {
    const parts = orderedDays.map((day) => {
      const list = byDay.get(day) ?? [];
      const short = STRIP_DAYS[dayIndex(day)]?.short ?? day;
      return { short, times: list.map((e) => e.startTime) };
    });
    const allTimes = parts.flatMap((p) => p.times);
    const samePeriod = allTimes.every(
      (t) => isAm(t) === isAm(allTimes[0] ?? t),
    );
    clauses.push(
      parts
        .map((p, i) => {
          const last = i === parts.length - 1;
          const times = p.times
            .map((t, j) =>
              formatStartTime(
                t,
                !samePeriod || (last && j === p.times.length - 1),
              ),
            )
            .join(" and ");
          return `${p.short} ${times}`;
        })
        .join(" · "),
    );
  } else if (main) {
    // Extra times on days that also meet at the headline time.
    const alsoByTime = new Map<string, DayOfWeek[]>();
    const sameDayClauses: string[] = [];
    // Days whose only times differ from the headline.
    const oddByTimes = new Map<string, DayOfWeek[]>();

    for (const day of orderedDays) {
      const list = byDay.get(day) ?? [];
      const hasMain = list.some((e) => e.startTime === main);
      const extras = list.filter((e) => e.startTime !== main);
      if (extras.length === 0) continue;

      if (!hasMain) {
        const key = extras.map((e) => e.startTime).join(",");
        oddByTimes.set(key, [...(oddByTimes.get(key) ?? []), day]);
        differsDays.add(day);
        continue;
      }

      const crossesPeriod = extras.every(
        (e) => isAm(e.startTime) !== isAm(main),
      );
      if (crossesPeriod) {
        for (const e of extras) {
          alsoByTime.set(e.startTime, [
            ...(alsoByTime.get(e.startTime) ?? []),
            day,
          ]);
        }
        continue;
      }

      differsDays.add(day);
      const long = STRIP_DAYS[dayIndex(day)]?.long ?? day;
      const types = list.map(typeLabel);
      const showTypes = new Set(types).size === list.length && types[0] !== "";
      const parts = list.map(
        (e) =>
          `${formatStartTime(e.startTime)}${showTypes ? ` ${typeLabel(e)}` : ""}`,
      );
      sameDayClauses.push(
        showTypes
          ? `${long}: ${joinWithAnd(parts)}`
          : `${long}: ${formatTimeList(
              list.map((e) => e.startTime),
              " and ",
            )}`,
      );
    }

    for (const [key, days] of oddByTimes) {
      const times = key.split(",");
      const names =
        days.length === 1
          ? (STRIP_DAYS[dayIndex(days[0] ?? "sunday")]?.long ?? "")
          : joinWithAnd(days.map((d) => STRIP_DAYS[dayIndex(d)]?.short ?? d));
      clauses.push(
        `${names} ${days.length === 1 ? "starts" : "start"} at ${formatTimeList(times, " and ")}`,
      );
    }
    clauses.push(...sameDayClauses);
    for (const [time, days] of alsoByTime) {
      clauses.push(
        `${joinWithAnd(days.map((d) => STRIP_DAYS[dayIndex(d)]?.short ?? d))} also ${formatStartTime(time)}`,
      );
    }
  }

  const days: ScheduleDay[] = STRIP_DAYS.map(({ day, letter }) => {
    const onDay = events.filter((e) => e.dayOfWeek === day);
    return {
      day,
      letter,
      meets: weekly.some((e) => e.dayOfWeek === day),
      status: getDominantStatus(
        onDay.map((e) => ({ mapStatus: e.mapStatus ?? null })),
      ),
      differs: differsDays.has(day),
    };
  });

  return {
    days,
    time: main ? formatStartTime(main) : null,
    timesVary,
    detail: clauses.length ? clauses.join("; ") : null,
    allClosed:
      weekly.length > 0 && weekly.every((e) => e.mapStatus === "closed"),
  };
}
