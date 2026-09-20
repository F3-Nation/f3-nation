import { describe, expect, it } from "vitest";

import { formatDateOrEmpty } from "~/utils/event-dates";

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
