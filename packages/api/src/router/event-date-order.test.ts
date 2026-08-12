import { describe, expect, it } from "vitest";

import {
  EventCrupdateSchema,
  isEndDateBeforeStartDate,
} from "@acme/validators";

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

const ORDER_MESSAGE = "End date must be on or after start date";

const issuesFor = (startDate: unknown, endDate: unknown) => {
  const result = EventCrupdateSchema.safeParse({ ...base, startDate, endDate });
  return result.success ? [] : result.error.issues;
};

/**
 * The endDate ordering issues raised for a given date pair, if any. Filtered by
 * message so a format rejection on the same field doesn't read as an ordering
 * complaint — the two guards are tested separately below.
 */
const dateOrderIssues = (startDate: unknown, endDate: unknown) =>
  issuesFor(startDate, endDate).filter(
    (issue) =>
      issue.path.length === 1 &&
      issue.path[0] === "endDate" &&
      issue.message === ORDER_MESSAGE,
  );

/** Whether the given field was rejected for not being a padded ISO date. */
const hasFormatIssue = (
  field: "startDate" | "endDate",
  startDate: unknown,
  endDate: unknown,
) =>
  issuesFor(startDate, endDate).some(
    (issue) =>
      issue.path.length === 1 &&
      issue.path[0] === field &&
      issue.message.includes("ISO format"),
  );

const expectRejected = (startDate: string, endDate: string) =>
  expect(
    dateOrderIssues(startDate, endDate),
    `expected ${startDate} -> ${endDate} to be rejected`,
  ).toContainEqual(
    expect.objectContaining({
      path: ["endDate"],
      message: ORDER_MESSAGE,
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
    // reject a valid Jan 5 -> Feb 1 range. The ordering guard must skip them
    // rather than guess; the field-level ISO format check rejects them outright
    // (see "ISO date format" below), so they never reach the database.
    it("raises no ordering issue for a valid range written without zero padding", () => {
      expectAccepted("2026-1-5", "2026-02-01");
      expectAccepted("2026-1-5", "2026-1-6");
      expectAccepted("2026-01-05", "2026-2-1");
    });

    it("skips the ordering check rather than guessing", () => {
      // Genuinely reversed, but unpadded. The ordering guard stays silent; the
      // format check is what stops it.
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

describe("ISO date format via EventCrupdateSchema", () => {
  it("rejects non-padded dates the ordering guard cannot compare", () => {
    expect(hasFormatIssue("endDate", "2026-02-01", "2026-1-5")).toBe(true);
    expect(hasFormatIssue("endDate", "2026-1-5", "2026-1-6")).toBe(true);
    expect(hasFormatIssue("startDate", "2026-1-5", "2026-02-01")).toBe(true);
  });

  it("rejects non-date strings instead of leaving them to Postgres", () => {
    expect(hasFormatIssue("endDate", "2026-02-01", "banana")).toBe(true);
    expect(hasFormatIssue("startDate", "nope", "also-nope")).toBe(true);
  });

  it("rejects impossible calendar dates", () => {
    expect(hasFormatIssue("endDate", "2026-02-01", "2026-02-30")).toBe(true);
    expect(hasFormatIssue("endDate", "2026-02-01", "2026-13-01")).toBe(true);
  });

  it("rejects an empty end date, which is not a null", () => {
    expect(hasFormatIssue("endDate", "2026-02-01", "")).toBe(true);
  });

  it("accepts a padded ISO range and an absent end date", () => {
    expect(issuesFor("2026-02-01", "2026-02-02")).toEqual([]);
    expect(issuesFor("2026-02-01", null)).toEqual([]);
    expect(issuesFor("2026-02-01", undefined)).toEqual([]);
  });
});

/**
 * The predicate behind both checkEventDateOrder and the admin form's submit
 * guard. It lived in apps/admin as a raw `endDate < startDate` string compare
 * whose comment claimed padded ISO input made that sound — true only because
 * `<input type="date">` happens to zero-pad. These pin the ISO gate directly so
 * the two callers cannot drift apart.
 */
describe("isEndDateBeforeStartDate", () => {
  it("is true only for a genuinely reversed padded ISO range", () => {
    expect(isEndDateBeforeStartDate("2026-02-01", "2026-01-31")).toBe(true);
    expect(isEndDateBeforeStartDate("2027-01-01", "2026-12-31")).toBe(true);
  });

  it("is false when the end date is on or after the start date", () => {
    expect(isEndDateBeforeStartDate("2026-02-01", "2026-02-01")).toBe(false);
    expect(isEndDateBeforeStartDate("2026-02-01", "2026-03-01")).toBe(false);
    expect(isEndDateBeforeStartDate("2026-12-31", "2027-01-01")).toBe(false);
  });

  it("is false when either date is missing", () => {
    expect(isEndDateBeforeStartDate(null, "2026-01-01")).toBe(false);
    expect(isEndDateBeforeStartDate("2026-01-01", null)).toBe(false);
    expect(isEndDateBeforeStartDate(undefined, undefined)).toBe(false);
  });

  it("does not call a valid unpadded range reversed", () => {
    // The bug a raw string compare has: "2026-02-01" < "2026-1-5", so this
    // valid Jan 5 -> Feb 1 range read as reversed before the ISO gate.
    expect(isEndDateBeforeStartDate("2026-1-5", "2026-02-01")).toBe(false);
  });

  it("declines to judge input it cannot compare", () => {
    // Reversed in truth, but unpadded — the field-level format check reports
    // this, not the ordering rule.
    expect(isEndDateBeforeStartDate("2026-02-01", "2026-1-5")).toBe(false);
    expect(isEndDateBeforeStartDate("nope", "also-nope")).toBe(false);
    expect(isEndDateBeforeStartDate("2026-02-01", "2026-02-30")).toBe(false);
  });
});
