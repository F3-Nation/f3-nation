import { describe, expect, it } from "vitest";

import type { GroupableEvent, IcsWorkout } from "~/utils/workout-schedule";
import {
  buildWorkoutIcs,
  durationMinutes,
  formatScheduleBanner,
  formatTimeRange,
  groupLocationWorkouts,
  safeExternalUrl,
} from "~/utils/workout-schedule";

const event = (overrides: Partial<GroupableEvent>): GroupableEvent => ({
  id: 1,
  name: "The Roost",
  dayOfWeek: "tuesday",
  startTime: "0515",
  endTime: "0600",
  eventTypes: [{ id: 1, name: "Bootcamp" }],
  aoName: "The Roost",
  ...overrides,
});

describe("formatTimeRange / durationMinutes", () => {
  it("shares one AM/PM within a period", () => {
    expect(formatTimeRange("0515", "0600")).toBe("5:15–6:00 AM");
  });
  it("keeps both across noon", () => {
    expect(formatTimeRange("1130", "1230")).toBe("11:30 AM–12:30 PM");
  });
  it("falls back to the start time alone", () => {
    expect(formatTimeRange("0515", null)).toBe("5:15 AM");
    expect(formatTimeRange(null, "0600")).toBeNull();
  });
  it("measures a workout", () => {
    expect(durationMinutes("0515", "0600")).toBe(45);
    expect(durationMinutes("0600", "0515")).toBeNull();
  });
});

describe("groupLocationWorkouts", () => {
  it("folds the same workout on several days into one, days in week order", () => {
    const groups = groupLocationWorkouts([
      event({ id: 2, dayOfWeek: "thursday" }),
      event({ id: 1, dayOfWeek: "tuesday" }),
      event({
        id: 3,
        name: "Havoc",
        aoName: "Havoc",
        dayOfWeek: "saturday",
        startTime: "0600",
        endTime: "0700",
      }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      id: 2,
      days: ["tuesday", "thursday"],
    });
    expect(formatScheduleBanner(groups[0]!)).toBe("TUE / THU · 5:15–6:00 AM");
    expect(groups[1]?.days).toEqual(["saturday"]);
  });

  it("keeps different start times apart", () => {
    const groups = groupLocationWorkouts([
      event({ id: 1 }),
      event({ id: 2, dayOfWeek: "saturday", startTime: "0630" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("never folds one-off instances", () => {
    const groups = groupLocationWorkouts([
      event({ id: -5, dayOfWeek: "friday" }),
      event({ id: -6, dayOfWeek: "friday" }),
    ]);
    expect(groups.map((g) => g.id)).toEqual([-5, -6]);
  });
});

describe("buildWorkoutIcs", () => {
  const workout: IcsWorkout = {
    id: 12,
    name: "The Roost, Bootcamp",
    days: ["tuesday", "thursday"],
    startTime: "0515",
    endTime: "0600",
    startDate: null,
    endDate: null,
    oneOff: false,
    location: "300 Columbia Ave; Chapin, SC",
    description: "Free and open to all men.",
    url: "https://map.f3nation.com/?locationId=3&eventId=12",
  };
  const lines = (ics: string) => ics.trimEnd().split("\r\n");

  it("repeats weekly on the workout's days from the next occurrence", () => {
    // 2026-11-18 is a Wednesday, so the next occurrence is Thursday the 19th.
    const out = lines(buildWorkoutIcs(workout, "2026-11-18"));
    expect(out).toContain("DTSTART:20261119T051500");
    expect(out).toContain("DTEND:20261119T060000");
    expect(out).toContain("RRULE:FREQ=WEEKLY;BYDAY=TU,TH");
    expect(out).toContain("SUMMARY:The Roost\\, Bootcamp");
    expect(out).toContain("LOCATION:300 Columbia Ave\\; Chapin\\, SC");
    expect(out[0]).toBe("BEGIN:VCALENDAR");
    expect(out.at(-1)).toBe("END:VCALENDAR");
  });

  it("starts on a series' future start date and stops at its end date", () => {
    const out = lines(
      buildWorkoutIcs(
        { ...workout, startDate: "2026-12-01", endDate: "2027-03-01" },
        "2026-11-18",
      ),
    );
    expect(out).toContain("DTSTART:20261201T051500");
    expect(out).toContain(
      "RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20270301T235959",
    );
  });

  it("writes a one-off as a single event with an hour when it has no end", () => {
    const out = lines(
      buildWorkoutIcs(
        {
          ...workout,
          oneOff: true,
          days: ["friday"],
          startDate: "2026-11-27",
          startTime: "0700",
          endTime: null,
        },
        "2026-11-18",
      ),
    );
    expect(out).toContain("DTSTART:20261127T070000");
    expect(out).toContain("DTEND:20261127T080000");
    expect(out.some((l) => l.startsWith("RRULE"))).toBe(false);
  });
});

describe("safeExternalUrl", () => {
  it.each([
    ["https://theroost.example", "https://theroost.example/"],
    ["theroost.example/ao", "https://theroost.example/ao"],
    ["javascript:alert(1)", null],
    ["ftp://files.example", null],
    ["not a url", null],
    ["", null],
    [null, null],
  ])("%s → %s", (input, expected) => {
    expect(safeExternalUrl(input)).toBe(expected);
  });
});
