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
  it("combines the id with the kebab-cased slug suffix", () => {
    expect(buildEventSlug(makeEvent({ slugSuffix: "Holiday Hike" }))).toBe(
      "abc123-holiday-hike",
    );
  });

  it("falls back to the title when there is no slug suffix", () => {
    expect(buildEventSlug(makeEvent({ title: "Turkey Trot" }))).toBe(
      "abc123-turkey-trot",
    );
  });

  it("falls back to the title when the slug suffix is blank", () => {
    expect(
      buildEventSlug(makeEvent({ slugSuffix: "   ", title: "Turkey Trot" })),
    ).toBe("abc123-turkey-trot");
  });

  it("returns only the id when neither suffix nor title is usable", () => {
    expect(buildEventSlug(makeEvent({ title: "  " }))).toBe("abc123");
  });
});

describe("formatEventDate", () => {
  it("formats an ISO date as a long English date", () => {
    expect(formatEventDate("2024-03-15")).toBe("Friday, March 15, 2024");
  });
});

describe("formatEventTime", () => {
  it("returns undefined when no time is given", () => {
    expect(formatEventTime(undefined)).toBeUndefined();
    expect(formatEventTime("")).toBeUndefined();
  });

  it("formats morning times as AM", () => {
    expect(formatEventTime("09:00")).toBe("9:00 AM");
  });

  it("formats afternoon times as PM", () => {
    expect(formatEventTime("13:05")).toBe("1:05 PM");
  });

  it("maps midnight to 12:00 AM", () => {
    expect(formatEventTime("00:30")).toBe("12:30 AM");
  });

  it("maps noon to 12:00 PM", () => {
    expect(formatEventTime("12:00")).toBe("12:00 PM");
  });

  it("treats a missing minutes part as :00", () => {
    expect(formatEventTime("9")).toBe("9:00 AM");
  });

  it("returns the input unchanged when the hour is out of range", () => {
    expect(formatEventTime("25:00")).toBe("25:00");
  });

  it("returns the input unchanged when the minutes are out of range", () => {
    expect(formatEventTime("10:75")).toBe("10:75");
  });

  it("returns the input unchanged when it is not a time", () => {
    expect(formatEventTime("abc")).toBe("abc");
  });
});

describe("formatEventTimeRange", () => {
  it("joins start and end with an en dash", () => {
    expect(formatEventTimeRange("09:00", "11:00")).toBe("9:00 AM – 11:00 AM");
    expect(formatEventTimeRange(undefined, "11:00")).toBe("11:00 AM");
  });

  it("shows only the start when there is no end time", () => {
    expect(formatEventTimeRange("09:00", undefined)).toBe("9:00 AM");
  });

  it("returns undefined when neither time is given", () => {
    expect(formatEventTimeRange(undefined, undefined)).toBeUndefined();
    expect(formatEventTimeRange("", "")).toBeUndefined();
  });
});

describe("hasEventEnded", () => {
  it("returns true for an event on an earlier day", () => {
    const event = makeEvent({ date: "2024-01-31", startTime: "23:00" });

    expect(hasEventEnded(event, new Date("2024-02-01T00:30:00"))).toBe(true);
  });

  it("returns false for an event later today", () => {
    const event = makeEvent({ date: "2024-02-01", startTime: "06:00" });

    expect(hasEventEnded(event, new Date("2024-02-01T23:59:00"))).toBe(false);
  });

  it("returns false for a future event", () => {
    const event = makeEvent({ date: "2024-03-01" });

    expect(hasEventEnded(event, REFERENCE)).toBe(false);
  });

  it("returns false when the event has no date", () => {
    expect(hasEventEnded(makeEvent({ date: "" }), REFERENCE)).toBe(false);
  });
});

describe("getUpcomingRegionEvents", () => {
  it("returns today and later dated events in chronological order", () => {
    const upcoming = getUpcomingRegionEvents("atlanta", {
      referenceDate: REFERENCE,
    });

    expect(upcoming.map((event) => event.id)).toEqual([
      "dddddd",
      "cccccc",
      "bbbbbb",
    ]);
  });

  it("excludes past and undated events", () => {
    const ids = getUpcomingRegionEvents("atlanta", {
      referenceDate: REFERENCE,
    }).map((event) => event.id);

    expect(ids).not.toContain("aaaaaa");
    expect(ids).not.toContain("eeeeee");
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
