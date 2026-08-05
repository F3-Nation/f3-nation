import { describe, expect, it } from "vitest";

import {
  formatDateOrEmpty,
  isEndDateBeforeStartDate,
} from "~/utils/event-dates";

describe("formatDateOrEmpty", () => {
  it("formats a date string using locale formatting", () => {
    // Built from calendar parts, not `new Date("2026-01-15")` — the latter is
    // UTC midnight and renders as the 14th west of UTC, which is the shift this
    // asserts against.
    expect(formatDateOrEmpty("2026-01-15")).toBe(
      new Date(2026, 0, 15).toLocaleDateString(),
    );
  });

  it("returns an empty string for null or undefined", () => {
    expect(formatDateOrEmpty(null)).toBe("");
    expect(formatDateOrEmpty(undefined)).toBe("");
  });
});

describe("isEndDateBeforeStartDate", () => {
  it("is true when the end date is before the start date", () => {
    expect(isEndDateBeforeStartDate("2026-02-01", "2026-01-31")).toBe(true);
  });

  it("is false when the end date is on or after the start date", () => {
    expect(isEndDateBeforeStartDate("2026-02-01", "2026-02-01")).toBe(false);
    expect(isEndDateBeforeStartDate("2026-02-01", "2026-03-01")).toBe(false);
  });

  it("is false when either date is missing", () => {
    expect(isEndDateBeforeStartDate(null, "2026-01-01")).toBe(false);
    expect(isEndDateBeforeStartDate("2026-01-01", null)).toBe(false);
    expect(isEndDateBeforeStartDate(undefined, undefined)).toBe(false);
  });
});
