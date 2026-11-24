import { describe, expect, it } from "vitest";

import type { StatusInstanceSummary } from "~/utils/event-status-map";
import {
  getMapEventStatus,
  getMapEventStatusDetail,
} from "~/utils/event-status-map";
import { formatTagDate, rowStatusTag, statusTagText } from "~/utils/status-tag";

const TODAY = "2026-11-17";
const series = { id: 1, startDate: null, endDate: null };
const lookup = (instances: StatusInstanceSummary[]) =>
  new Map<number, StatusInstanceSummary[]>([[1, instances]]);

describe("getMapEventStatusDetail", () => {
  it("reports the soonest instance with its own start time", () => {
    const detail = getMapEventStatusDetail(
      series,
      lookup([
        { seriesException: "closed", startDate: "2026-12-05" },
        {
          seriesException: "different-time",
          startDate: "2026-11-26",
          startTime: "0700",
        },
      ]),
      TODAY,
    );
    expect(detail).toEqual({
      status: "different-time",
      kind: "instance",
      date: "2026-11-26",
      startTime: "0700",
      closedThrough: null,
    });
  });

  it("joins weekly closures into one range and stops at a gap", () => {
    const detail = getMapEventStatusDetail(
      series,
      lookup([
        { seriesException: "closed", startDate: "2026-11-29" },
        { seriesException: "closed", startDate: "2026-11-22" },
        { seriesException: "closed", startDate: "2026-12-13" },
      ]),
      TODAY,
    );
    expect(detail?.date).toBe("2026-11-22");
    expect(detail?.closedThrough).toBe("2026-11-29");
  });

  it("reads a series ending inside the 30-day horizon as ending", () => {
    const detail = getMapEventStatusDetail(
      { id: 1, startDate: null, endDate: "2026-12-01" },
      new Map(),
      TODAY,
    );
    expect(detail).toMatchObject({ status: "closed", kind: "ends" });
  });

  it("ignores an end date past the horizon", () => {
    expect(
      getMapEventStatusDetail(
        { id: 1, startDate: null, endDate: "2027-01-30" },
        new Map(),
        TODAY,
      ),
    ).toBeNull();
  });

  it("agrees with getMapEventStatus", () => {
    const instances = lookup([
      { seriesException: null, startDate: "2026-11-20" },
    ]);
    expect(getMapEventStatus(series, instances, TODAY)).toBe(
      getMapEventStatusDetail(series, instances, TODAY)?.status,
    );
  });
});

describe("statusTagText", () => {
  const base = { startTime: null, closedThrough: null };

  it.each([
    [
      { ...base, status: "closed", kind: "instance", date: "2026-11-22" },
      "Closed Sun Nov 22",
    ],
    [
      {
        status: "closed",
        kind: "instance",
        date: "2026-11-22",
        startTime: null,
        closedThrough: "2026-11-29",
      },
      "Closed Nov 22 – Nov 29",
    ],
    [
      { ...base, status: "closed", kind: "ends", date: "2026-12-01" },
      "Ends Tue Dec 1",
    ],
    [
      { ...base, status: "different-time", kind: "starts", date: "2026-12-01" },
      "Starts Tue Dec 1",
    ],
    [
      {
        ...base,
        status: "different-time",
        kind: "instance",
        date: "2026-11-26",
        startTime: "0700",
      },
      "Thu Nov 26: 7:00 AM",
    ],
    [
      {
        ...base,
        status: "different-time",
        kind: "instance",
        date: "2026-11-26",
      },
      "Time change Thu Nov 26",
    ],
  ] as const)("%o → %s", (detail, expected) => {
    expect(statusTagText(detail)).toBe(expected);
  });

  it("names a special event with its time", () => {
    expect(
      statusTagText(
        {
          ...base,
          status: "event-instance",
          kind: "instance",
          date: "2026-11-27",
          startTime: "0700",
        },
        "Convergence",
      ),
    ).toBe("Special: Fri Nov 27, 7:00 AM Convergence");
  });

  it("formats dates as calendar dates regardless of the local zone", () => {
    expect(formatTagDate("2026-01-01")).toBe("Thu Jan 1");
  });
});

describe("rowStatusTag", () => {
  const event = {
    id: 1,
    name: "Bootcamp",
    startDate: null,
    startTime: "0515",
    mapStatus: null,
  };

  it("has no tag when nothing has a status", () => {
    expect(rowStatusTag([event])).toBeNull();
  });

  it("prefers a closure over a special event, like the pin color", () => {
    const tag = rowStatusTag([
      {
        id: -4,
        name: "Convergence",
        startDate: "2026-11-20",
        startTime: "0700",
        mapStatus: "event-instance",
      },
      {
        ...event,
        mapStatus: "closed",
        statusDetail: {
          status: "closed",
          kind: "instance",
          date: "2026-11-28",
          startTime: null,
          closedThrough: null,
        },
      },
    ]);
    expect(tag).toEqual({ status: "closed", text: "Closed Sat Nov 28" });
  });

  it("builds a one-off's tag from its own date, time and name", () => {
    expect(
      rowStatusTag([
        event,
        {
          id: -9,
          name: "Convergence",
          startDate: "2026-11-27",
          startTime: "0700",
          mapStatus: "event-instance",
        },
      ]),
    ).toEqual({
      status: "event-instance",
      text: "Special: Fri Nov 27, 7:00 AM Convergence",
    });
  });
});
