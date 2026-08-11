import { describe, expect, it } from "vitest";

import { EventCrupdateSchema } from "@acme/validators";

/**
 * Pure schema tests for the start/end date ordering guard on event.crupdate.
 * The router-level counterparts live in event.test.ts; these pin the comparison
 * itself, which is lexicographic and therefore only sound for zero-padded ISO
 * dates.
 */

const base = {
  name: "Date Order Event",
  aoId: 1,
  regionId: 1,
  locationId: 1,
  dayOfWeek: "monday" as const,
  startTime: "0530",
  endTime: "0615",
  highlight: false,
  isActive: true,
  eventTypeIds: [1],
  email: null,
};

/** The endDate ordering issues raised for a given date pair, if any. */
const dateOrderIssues = (startDate: unknown, endDate: unknown) => {
  const result = EventCrupdateSchema.safeParse({ ...base, startDate, endDate });
  if (result.success) return [];
  return result.error.issues.filter(
    (issue) => issue.path.length === 1 && issue.path[0] === "endDate",
  );
};

const expectRejected = (startDate: string, endDate: string) =>
  expect(
    dateOrderIssues(startDate, endDate),
    `expected ${startDate} -> ${endDate} to be rejected`,
  ).toContainEqual(
    expect.objectContaining({
      path: ["endDate"],
      message: "End date must be on or after start date",
    }),
  );

const expectAccepted = (startDate: unknown, endDate: unknown) =>
  expect(
    dateOrderIssues(startDate, endDate),
    `expected ${String(startDate)} -> ${String(endDate)} to raise no date-order issue`,
  ).toEqual([]);

describe("checkEventDateOrder via EventCrupdateSchema", () => {
  describe("padded ISO dates", () => {
    it("rejects a reversed range", () => {
      expectRejected("2026-02-01", "2026-01-31");
      expectRejected("2026-02-01", "2026-01-01");
      expectRejected("2027-01-01", "2026-12-31");
    });

    it("accepts an end date on or after the start date", () => {
      expectAccepted("2026-02-01", "2026-02-01");
      expectAccepted("2026-02-01", "2026-02-02");
      expectAccepted("2026-12-31", "2027-01-01");
    });
  });

  describe("non-padded dates", () => {
    // Lexicographically "2026-02-01" < "2026-1-5", so comparing these raw would
    // reject a valid Jan 5 -> Feb 1 range. The ISO gate must skip them instead.
    it("does not reject a valid range written without zero padding", () => {
      expectAccepted("2026-1-5", "2026-02-01");
      expectAccepted("2026-1-5", "2026-1-6");
      expectAccepted("2026-01-05", "2026-2-1");
    });

    it("skips the ordering check rather than guessing", () => {
      // Genuinely reversed, but unpadded — not ordered, so no issue. Closing
      // this needs ISO validation on the columns themselves, not here.
      expectAccepted("2026-02-01", "2026-1-5");
    });
  });

  describe("values that are not dates", () => {
    it("raises no date-order issue for absent end dates", () => {
      expectAccepted("2026-02-01", null);
      expectAccepted("2026-02-01", undefined);
      expectAccepted("2026-02-01", "");
    });

    it("does not report garbage as a date-order problem", () => {
      // "also-nope" < "nope" lexicographically; the old guard called that a
      // reversed date range.
      expectAccepted("nope", "also-nope");
      expectAccepted("2026-02-01", "not-a-date");
    });

    it("raises no date-order issue for an impossible calendar date", () => {
      expectAccepted("2026-02-01", "2026-02-30");
      expectAccepted("2026-02-01", "2026-13-01");
    });
  });
});
