import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getEndDateLabel } from "~/utils/get-end-date-label";

describe("getEndDateLabel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows 'Through' for a future end date", () => {
    expect(getEndDateLabel("2026-12-31")).toBe("Through Dec 31, 2026");
  });

  it("shows 'Ends Today' when the end date is today", () => {
    expect(getEndDateLabel("2026-06-15")).toBe("Ends Today");
  });

  it("shows 'Ended' for a past end date", () => {
    expect(getEndDateLabel("2026-01-01")).toBe("Ended Jan 1, 2026");
  });

  it("does not shift the date across a timezone boundary", () => {
    expect(getEndDateLabel("2026-12-31")).toBe("Through Dec 31, 2026");
    expect(getEndDateLabel("2026-01-01")).toBe("Ended Jan 1, 2026");
  });

  it("returns null for an open-ended event", () => {
    expect(getEndDateLabel(null)).toBeNull();
    expect(getEndDateLabel(undefined)).toBeNull();
    expect(getEndDateLabel("")).toBeNull();
  });

  it("returns null rather than a fallback for an unparseable value", () => {
    expect(getEndDateLabel("not-a-date")).toBeNull();
    expect(getEndDateLabel("2026-13-45")).toBeNull();
    expect(getEndDateLabel("03/01/2026")).toBeNull();
  });
});
