import { describe, expect, it, vi } from "vitest";
import {
  buildEventSlug,
  findRegionEvent,
  formatEventDate,
  formatEventTime,
  formatEventTimeRange,
  getUpcomingRegionEvents,
  hasEventEnded,
} from "@/lib/region-events";
import type { RegionEvent } from "@/types/event";

// Replace the real (currently empty) data file with a fixture so the
// filtering and lookup logic is exercised deterministically.
vi.mock("@/data/region-events.json", () => ({
  default: [
    {
      regionSlug: "atlanta",
      regionName: "Atlanta",
      events: [
        {
          id: "aaaaaa",
          title: "Past Event",
          date: "2024-01-10",
          startTime: "06:00",
        },
        {
          id: "dddddd",
          title: "Today Event",
          date: "2024-02-01",
          startTime: "06:00",
        },
        {
          id: "cccccc",
          title: "Sooner Event",
          date: "2024-02-05",
          startTime: "07:00",
          legacySlugs: ["old-sooner"],
        },
        {
          id: "bbbbbb",
          title: "Later Event",
          slugSuffix: "Spring Kickoff",
          date: "2024-03-20",
          startTime: "18:00",
        },
        { id: "eeeeee", title: "Undated Event", date: "" },
      ],
    },
  ],
}));

const makeEvent = (overrides: Partial<RegionEvent> = {}): RegionEvent => ({
  id: "abc123",
  title: "Holiday Hike",
  date: "2024-12-01",
  ...overrides,
});

// Thursday, 2024-02-01 10:30 local time.
const REFERENCE = new Date("2024-02-01T10:30:00");

describe("buildEventSlug", () => {
  it.each([
    [{ slugSuffix: "Holiday Hike" }, "abc123-holiday-hike"],
    [{ title: "Turkey Trot" }, "abc123-turkey-trot"],
    [{ slugSuffix: "   ", title: "Turkey Trot" }, "abc123-turkey-trot"],
    [{ title: "  " }, "abc123"],
  ])("%j -> %s", (overrides, expected) => {
    expect(buildEventSlug(makeEvent(overrides))).toBe(expected);
  });
});

describe("formatEventDate", () => {
  it("formats an ISO date as a long English date", () => {
    expect(formatEventDate("2024-03-15")).toBe("Friday, March 15, 2024");
    expect(formatEventDate("")).toBe("Date TBD");
    expect(formatEventDate("not-a-date")).toBe("Date TBD");
  });
});

describe("formatEventTime", () => {
  it.each([
    [undefined, undefined],
    ["", undefined],
    ["09:00", "9:00 AM"],
    ["13:05", "1:05 PM"],
    ["00:30", "12:30 AM"],
    ["12:00", "12:00 PM"],
    ["9", "9:00 AM"],
    ["25:00", "25:00"],
    ["10:75", "10:75"],
    ["abc", "abc"],
  ])("%j -> %j", (input, expected) => {
    expect(formatEventTime(input)).toBe(expected);
  });
});

describe("formatEventTimeRange", () => {
  it.each([
    ["09:00", "11:00", "9:00 AM – 11:00 AM"],
    ["09:00", undefined, "9:00 AM"],
    [undefined, "11:00", "11:00 AM"],
    [undefined, undefined, undefined],
    ["", "", undefined],
  ])("%j, %j -> %j", (start, end, expected) => {
    expect(formatEventTimeRange(start, end)).toBe(expected);
  });
});

describe("hasEventEnded", () => {
  it.each([
    ["an earlier day", { date: "2024-01-31", startTime: "23:00" }, true],
    ["later today", { date: "2024-02-01", startTime: "06:00" }, false],
    ["a future day", { date: "2024-03-01" }, false],
    ["no date", { date: "" }, false],
  ])("%s -> %s", (_label, overrides, expected) => {
    expect(hasEventEnded(makeEvent(overrides), REFERENCE)).toBe(expected);
  });
});

describe("getUpcomingRegionEvents", () => {
  it("returns today-and-later dated events in order, skipping past and undated", () => {
    const ids = getUpcomingRegionEvents("atlanta", {
      referenceDate: REFERENCE,
    }).map((event) => event.id);

    expect(ids).toEqual(["dddddd", "cccccc", "bbbbbb"]);
  });

  it("applies the limit", () => {
    const upcoming = getUpcomingRegionEvents("atlanta", {
      referenceDate: REFERENCE,
      limit: 1,
    });

    expect(upcoming.map((event) => event.id)).toEqual(["dddddd"]);
  });

  it("includes recent past events when includePastDays is set", () => {
    const upcoming = getUpcomingRegionEvents("atlanta", {
      referenceDate: REFERENCE,
      includePastDays: 30,
    });

    expect(upcoming[0]?.id).toBe("aaaaaa");
    expect(upcoming).toHaveLength(4);
  });

  it("returns an empty array for an unknown region", () => {
    expect(
      getUpcomingRegionEvents("nowhere", { referenceDate: REFERENCE }),
    ).toEqual([]);
  });
});

describe("findRegionEvent", () => {
  it("returns null for a region that does not exist", () => {
    expect(findRegionEvent("nowhere", "bbbbbb-spring-kickoff")).toBeNull();
  });

  it("returns null when no event matches the slug", () => {
    expect(findRegionEvent("atlanta", "does-not-exist")).toBeNull();
  });

  it("finds an event by the id prefix of its slug", () => {
    const result = findRegionEvent("atlanta", "bbbbbb-spring-kickoff");

    expect(result?.event.id).toBe("bbbbbb");
    expect(result?.region.regionSlug).toBe("atlanta");
  });

  it("finds an event by a legacy slug", () => {
    const result = findRegionEvent("atlanta", "old-sooner");

    expect(result?.event.id).toBe("cccccc");
  });
});
