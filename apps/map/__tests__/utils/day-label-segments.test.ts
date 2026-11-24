import { describe, expect, it } from "vitest";

import { dayLabelSegments } from "~/utils/day-label-segments";

describe("dayLabelSegments", () => {
  it("lists each weekday once, in week order", () => {
    const segments = dayLabelSegments([
      { id: 3, dayOfWeek: "saturday", mapStatus: null },
      { id: 1, dayOfWeek: "tuesday", mapStatus: null },
      { id: 2, dayOfWeek: "thursday", mapStatus: null },
      { id: 4, dayOfWeek: "tuesday", mapStatus: null },
    ]);
    expect(segments.map((s) => s.label).join(" ")).toBe("Tu Th Sa");
    expect(segments[0]?.eventIds).toEqual([1, 4]);
  });

  it("colors a day by its most urgent status", () => {
    const [tuesday] = dayLabelSegments([
      { id: 1, dayOfWeek: "tuesday", mapStatus: "event-instance" },
      { id: 2, dayOfWeek: "tuesday", mapStatus: "closed" },
    ]);
    expect(tuesday?.status).toBe("closed");
  });

  it("puts workouts with no weekday last", () => {
    const segments = dayLabelSegments([
      { id: 1, dayOfWeek: null, mapStatus: null },
      { id: 2, dayOfWeek: "sunday", mapStatus: null },
    ]);
    expect(segments.map((s) => s.label)).toEqual(["Su", "•"]);
  });
});
