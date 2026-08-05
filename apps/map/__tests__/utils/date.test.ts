/**
 * Tests for the "Updates" list ordering in `WorkoutDetailsContent`.
 *
 * `upcomingInstances` has no ORDER BY, so the list was rendered in whatever
 * order the query plan returned — dates out of sequence in a list that reads as
 * a timeline.
 */

import { describe, expect, it } from "vitest";

import { sortUpcomingInstancesByDate } from "~/utils/date";

const at = (startDate: string, startTime: string | null = null) => ({
  startDate,
  startTime,
});

const dates = (instances: { startDate: string }[]) =>
  instances.map((i) => i.startDate);

describe("sortUpcomingInstancesByDate", () => {
  it("orders soonest first", () => {
    const sorted = sortUpcomingInstancesByDate([
      at("2026-08-20"),
      at("2026-08-06"),
      at("2026-08-13"),
    ]);

    expect(dates(sorted)).toEqual(["2026-08-06", "2026-08-13", "2026-08-20"]);
  });

  it("breaks same-day ties by start time", () => {
    const sorted = sortUpcomingInstancesByDate([
      at("2026-08-06", "1730"),
      at("2026-08-06", "0530"),
    ]);

    expect(sorted.map((i) => i.startTime)).toEqual(["0530", "1730"]);
  });

  it("sorts a timeless instance before timed ones on the same day", () => {
    const sorted = sortUpcomingInstancesByDate([
      at("2026-08-06", "0530"),
      at("2026-08-06", null),
    ]);

    expect(sorted.map((i) => i.startTime)).toEqual([null, "0530"]);
  });

  it("does not mutate the input", () => {
    const input = [at("2026-08-20"), at("2026-08-06")];

    sortUpcomingInstancesByDate(input);

    // The caller may be holding a memoized reference to this array.
    expect(dates(input)).toEqual(["2026-08-20", "2026-08-06"]);
  });

  it("handles empty and single-element input", () => {
    expect(sortUpcomingInstancesByDate([])).toEqual([]);
    expect(dates(sortUpcomingInstancesByDate([at("2026-08-06")]))).toEqual([
      "2026-08-06",
    ]);
  });

  it("orders across month and year boundaries", () => {
    const sorted = sortUpcomingInstancesByDate([
      at("2027-01-02"),
      at("2026-12-31"),
      at("2026-09-01"),
    ]);

    expect(dates(sorted)).toEqual(["2026-09-01", "2026-12-31", "2027-01-02"]);
  });
});
