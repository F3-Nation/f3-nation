import { describe, expect, it } from "vitest";

import type { ScheduleEvent } from "~/utils/ao-schedule-summary";
import type { MapStatus } from "~/utils/types";
import {
  formatStartTime,
  joinWithAnd,
  summarizeAoSchedule,
} from "~/utils/ao-schedule-summary";

let nextId = 1;
const ev = (
  dayOfWeek: ScheduleEvent["dayOfWeek"],
  startTime: string | null,
  type = "Bootcamp",
  mapStatus: MapStatus = null,
): ScheduleEvent => ({
  id: nextId++,
  dayOfWeek,
  startTime,
  eventTypes: [{ name: type }],
  mapStatus,
});

/** The strip as a string: upper-case = meets, "*" = time differs. */
const strip = (events: ScheduleEvent[]) =>
  summarizeAoSchedule(events)
    .days.map(
      (d) =>
        `${d.meets ? d.letter : d.letter.toLowerCase()}${d.differs ? "*" : ""}`,
    )
    .join("");

// The nine rows from the redesign's row-format mockup.
describe("summarizeAoSchedule (mockup rows)", () => {
  it("1. same time every day: one headline time, no line", () => {
    const events = [ev("tuesday", "0515"), ev("thursday", "0515")];
    const summary = summarizeAoSchedule(events);
    expect(summary.time).toBe("5:15 AM");
    expect(summary.timesVary).toBe(false);
    expect(summary.detail).toBeNull();
    expect(strip(events)).toBe("smTwTfs");
  });

  it("2. one day starts later: names it and dots that day", () => {
    const events = [
      ev("tuesday", "0515"),
      ev("thursday", "0515"),
      ev("saturday", "0630"),
    ];
    const summary = summarizeAoSchedule(events);
    expect(summary.time).toBe("5:15 AM");
    expect(summary.detail).toBe("Saturday starts at 6:30 AM");
    expect(strip(events)).toBe("smTwTfS*");
  });

  it("3. two workouts on the same day: lists both with their types", () => {
    const events = [
      ev("monday", "0515"),
      ev("wednesday", "0630", "Run"),
      ev("wednesday", "0515"),
      ev("friday", "0515"),
    ];
    const summary = summarizeAoSchedule(events);
    expect(summary.time).toBe("5:15 AM");
    expect(summary.detail).toBe("Wednesday: 5:15 AM bootcamp and 6:30 AM run");
    expect(strip(events)).toBe("sMtW*tFs");
  });

  it("4. every day at a different time: Times vary plus the full list", () => {
    const events = [
      ev("saturday", "0700"),
      ev("monday", "0500"),
      ev("wednesday", "0530"),
      ev("friday", "0600"),
    ];
    const summary = summarizeAoSchedule(events);
    expect(summary.time).toBeNull();
    expect(summary.timesVary).toBe(true);
    expect(summary.detail).toBe("Mon 5:00 · Wed 5:30 · Fri 6:00 · Sat 7:00 AM");
    expect(strip(events)).toBe("sMtWtFS");
  });

  it("5. morning and evening: keeps the morning headline, adds the evening", () => {
    const events = [
      ev("monday", "0530", "Ruck"),
      ev("tuesday", "0530", "Ruck"),
      ev("wednesday", "0530", "Ruck"),
      ev("thursday", "0530", "Ruck"),
      ev("tuesday", "1800", "Run"),
      ev("thursday", "1800", "Run"),
    ];
    const summary = summarizeAoSchedule(events);
    expect(summary.time).toBe("5:30 AM");
    expect(summary.detail).toBe("Tue and Thu also 6:00 PM");
    // An extra evening workout doesn't change the day's morning time.
    expect(strip(events)).toBe("sMTWTfs");
  });

  it("6. a plain two-day row", () => {
    const events = [ev("tuesday", "0600"), ev("thursday", "0600")];
    expect(summarizeAoSchedule(events).time).toBe("6:00 AM");
  });

  it("7. temporarily closed: grays the day and marks the row closed", () => {
    const events = [ev("saturday", "0600", "Bootcamp", "closed")];
    const summary = summarizeAoSchedule(events);
    expect(summary.allClosed).toBe(true);
    expect(summary.days.find((d) => d.day === "saturday")?.status).toBe(
      "closed",
    );
    expect(summary.time).toBe("6:00 AM");
  });

  it("8. one-week time change: colors that day, keeps the weekly time", () => {
    const events = [
      ev("tuesday", "0515"),
      ev("thursday", "0515", "Bootcamp", "different-time"),
    ];
    const summary = summarizeAoSchedule(events);
    expect(summary.time).toBe("5:15 AM");
    expect(summary.detail).toBeNull();
    expect(summary.allClosed).toBe(false);
    expect(summary.days.find((d) => d.day === "thursday")?.status).toBe(
      "different-time",
    );
    expect(summary.days.find((d) => d.day === "tuesday")?.status).toBeNull();
  });

  it("9. special one-off: colors its day without counting it as a weekly day or time", () => {
    const events = [
      ev("wednesday", "0515", "Gear"),
      {
        id: -9,
        dayOfWeek: "friday" as const,
        startTime: "0700",
        eventTypes: [{ name: "Gear" }],
        mapStatus: "event-instance" as const,
      },
    ];
    const summary = summarizeAoSchedule(events);
    expect(summary.time).toBe("5:15 AM");
    expect(summary.detail).toBeNull();
    const friday = summary.days.find((d) => d.day === "friday");
    expect(friday?.meets).toBe(false);
    expect(friday?.status).toBe("event-instance");
  });
});

describe("summarizeAoSchedule (edges)", () => {
  it("breaks a tie between repeated times toward the earlier one", () => {
    const events = [
      ev("tuesday", "0600"),
      ev("thursday", "0600"),
      ev("monday", "0515"),
      ev("wednesday", "0515"),
    ];
    const summary = summarizeAoSchedule(events);
    expect(summary.time).toBe("5:15 AM");
    expect(summary.detail).toBe("Tue and Thu start at 6:00 AM");
  });

  it("keeps AM/PM on every time when a varied list mixes them", () => {
    const events = [ev("monday", "0530"), ev("wednesday", "1830")];
    expect(summarizeAoSchedule(events).detail).toBe(
      "Mon 5:30 AM · Wed 6:30 PM",
    );
  });

  it("drops types when two workouts on a day share one", () => {
    const events = [
      ev("monday", "0515"),
      ev("friday", "0515"),
      ev("wednesday", "0515"),
      ev("wednesday", "0630"),
    ];
    expect(summarizeAoSchedule(events).detail).toBe(
      "Wednesday: 5:15 and 6:30 AM",
    );
  });

  it("has no time for workouts without a start time", () => {
    const summary = summarizeAoSchedule([ev("monday", null)]);
    expect(summary.time).toBeNull();
    expect(summary.timesVary).toBe(false);
    expect(summary.days.find((d) => d.day === "monday")?.meets).toBe(true);
  });

  it("is not closed when only one of several workouts is", () => {
    const summary = summarizeAoSchedule([
      ev("monday", "0515", "Bootcamp", "closed"),
      ev("wednesday", "0515"),
    ]);
    expect(summary.allClosed).toBe(false);
  });
});

describe("formatStartTime / joinWithAnd", () => {
  it.each([
    ["0000", "12:00 AM"],
    ["0515", "5:15 AM"],
    ["1200", "12:00 PM"],
    ["1830", "6:30 PM"],
  ])("formats %s as %s", (input, expected) => {
    expect(formatStartTime(input)).toBe(expected);
  });

  it("joins lists in plain English", () => {
    expect(joinWithAnd(["Tue"])).toBe("Tue");
    expect(joinWithAnd(["Tue", "Thu"])).toBe("Tue and Thu");
    expect(joinWithAnd(["Mon", "Tue", "Thu"])).toBe("Mon, Tue and Thu");
  });
});
