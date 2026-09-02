/**
 * Tests for the chip status calculation behind `WorkoutDetailsContent`.
 *
 * The subtle case: `upcomingInstances` deliberately returns locationless
 * instances (a closure has no location of its own) so they can flag their parent
 * series. Selecting instances by `locationId` equality alone dropped them, so a
 * closed workout's chip stayed uncolored while its map marker showed closed —
 * the marker path groups by `seriesId` with no location filter.
 */

import { describe, expect, it } from "vitest";

import type {
  ExceptionInstance,
  StatusBaseEvent,
  StatusInstance,
  StatusInstanceSummary,
} from "~/utils/event-status-map";
import {
  buildEventStatusMap,
  findNextExceptionNotice,
  getMapEventStatus,
  instanceMapStatus,
  selectStatusInstances,
  statusLabel,
} from "~/utils/event-status-map";

const LOCATION_ID = 10;
const BASE_EVENT_ID = 100;

const instance = (overrides: Partial<StatusInstance> = {}): StatusInstance => ({
  id: 1,
  seriesId: BASE_EVENT_ID,
  locationId: LOCATION_ID,
  seriesException: null,
  startDate: "2026-08-10",
  ...overrides,
});

const statusMapFor = (
  instances: StatusInstance[],
  baseEvents: StatusBaseEvent[] = [{ id: BASE_EVENT_ID }],
  todayIso?: string,
) => {
  const baseEventIds = new Set(baseEvents.map((event) => event.id));
  return buildEventStatusMap(
    selectStatusInstances(instances, LOCATION_ID, baseEventIds),
    baseEvents,
    todayIso,
  );
};

describe("instanceMapStatus", () => {
  it("maps known exceptions and falls back for unknown or absent ones", () => {
    expect(instanceMapStatus("closed")).toBe("closed");
    expect(instanceMapStatus("different-time")).toBe("different-time");
    expect(instanceMapStatus("something-new")).toBe("miscellaneous");
    expect(instanceMapStatus(null)).toBe("event-instance");
  });
});

describe("selectStatusInstances", () => {
  it("includes a locationless instance whose series is at this location", () => {
    const closure = instance({
      id: 5,
      locationId: null,
      seriesException: "closed",
    });

    expect(
      selectStatusInstances([closure], LOCATION_ID, new Set([BASE_EVENT_ID])),
    ).toEqual([closure]);
  });

  it("includes instances at this location", () => {
    const here = instance({ id: 6 });

    expect(
      selectStatusInstances([here], LOCATION_ID, new Set([BASE_EVENT_ID])),
    ).toEqual([here]);
  });

  // A series has one chip; it needs its soonest status across every
  // location the series occurs at (e.g. an "away" probe), not just this one.
  it("includes an instance of this location's series even when it occurs elsewhere", () => {
    const elsewhere = instance({ id: 7, locationId: LOCATION_ID + 1 });

    expect(
      selectStatusInstances([elsewhere], LOCATION_ID, new Set([BASE_EVENT_ID])),
    ).toEqual([elsewhere]);
  });

  it("excludes an orphan instance located elsewhere", () => {
    const elsewhere = instance({
      id: 7,
      locationId: LOCATION_ID + 1,
      seriesId: null,
    });

    expect(
      selectStatusInstances([elsewhere], LOCATION_ID, new Set([BASE_EVENT_ID])),
    ).toEqual([]);
  });

  it("excludes a locationless instance whose series is not at this location", () => {
    const otherSeries = instance({ id: 8, locationId: null, seriesId: 999 });

    expect(
      selectStatusInstances(
        [otherSeries],
        LOCATION_ID,
        new Set([BASE_EVENT_ID]),
      ),
    ).toEqual([]);
  });

  it("excludes a locationless standalone instance", () => {
    const standalone = instance({ id: 9, locationId: null, seriesId: null });

    expect(
      selectStatusInstances(
        [standalone],
        LOCATION_ID,
        new Set([BASE_EVENT_ID]),
      ),
    ).toEqual([]);
  });
});

describe("buildEventStatusMap", () => {
  // The regression: before locationless instances were selected, this map came
  // back empty and the base event's chip rendered with no status color.
  it("colors the base event chip from a locationless closure of its series", () => {
    const map = statusMapFor([
      instance({ id: 5, locationId: null, seriesException: "closed" }),
    ]);

    expect(map.get(BASE_EVENT_ID)).toBe("closed");
  });

  it("colors the base event chip from a locationless different-time exception", () => {
    const map = statusMapFor([
      instance({ id: 5, locationId: null, seriesException: "different-time" }),
    ]);

    expect(map.get(BASE_EVENT_ID)).toBe("different-time");
  });

  it("keys an orphan instance by its negated id, not its series", () => {
    const map = statusMapFor([
      instance({ id: 42, seriesId: null, seriesException: "closed" }),
    ]);

    expect(map.get(-42)).toBe("closed");
    expect(map.has(BASE_EVENT_ID)).toBe(false);
  });

  it("uses the soonest instance when a series has several", () => {
    const map = statusMapFor([
      instance({
        id: 1,
        startDate: "2026-08-20",
        seriesException: "different-time",
      }),
      instance({
        id: 2,
        locationId: null,
        startDate: "2026-08-11",
        seriesException: "closed",
      }),
    ]);

    // The locationless closure is sooner, so it wins — which is only possible
    // now that it is part of the considered set at all.
    expect(map.get(BASE_EVENT_ID)).toBe("closed");
  });

  // The nearest instance wins regardless of the order rows arrive in. Nothing
  // orders `upcomingInstances` by date, so relying on arrival order would make
  // the chip color depend on the query plan.
  it("picks the nearest date no matter the arrival order", () => {
    const soonest = instance({
      id: 2,
      startDate: "2026-08-11",
      seriesException: "closed",
    });
    const later = instance({
      id: 1,
      startDate: "2026-08-20",
      seriesException: "different-time",
    });

    expect(statusMapFor([later, soonest]).get(BASE_EVENT_ID)).toBe("closed");
    expect(statusMapFor([soonest, later]).get(BASE_EVENT_ID)).toBe("closed");
  });

  // "Nearest wins" beats "most severe wins": an ordinary upcoming instance
  // today outranks a closure three weeks out, because the chip describes what
  // is happening next — not the worst thing on the horizon.
  it("lets an unexceptional nearer instance win over a later closure", () => {
    const map = statusMapFor([
      instance({ id: 1, startDate: "2026-08-11", seriesException: null }),
      instance({ id: 2, startDate: "2026-08-25", seriesException: "closed" }),
    ]);

    expect(map.get(BASE_EVENT_ID)).toBe("event-instance");
  });

  // Regression: an away probe at a different location used to be dropped
  // before the nearest-date comparison, so the chip picked a later,
  // differently-colored instance than the one the map marker showed.
  it("lets an instance at a different location win when it is soonest", () => {
    const map = statusMapFor([
      instance({
        id: 1,
        locationId: LOCATION_ID + 1,
        startDate: "2026-08-06",
        seriesException: null,
      }),
      instance({
        id: 2,
        locationId: null,
        startDate: "2026-08-12",
        seriesException: "different-time",
      }),
    ]);

    expect(map.get(BASE_EVENT_ID)).toBe("event-instance");
  });

  it("ignores instances belonging to another location's series", () => {
    const map = statusMapFor([
      instance({
        id: 3,
        locationId: null,
        seriesId: 999,
        seriesException: "closed",
      }),
    ]);

    expect(map.size).toBe(0);
  });
});

describe("getMapEventStatus", () => {
  const TODAY = "2026-08-05";
  const EVENT_ID = 100;

  const lookup = (instances: StatusInstanceSummary[]) =>
    new Map([[EVENT_ID, instances]]);

  const event = (
    overrides: { startDate?: string | null; endDate?: string | null } = {},
  ) => ({
    id: EVENT_ID,
    startDate: "2026-01-01",
    endDate: null,
    ...overrides,
  });

  it("returns null when nothing dated is in range", () => {
    expect(getMapEventStatus(event(), new Map(), TODAY)).toBeNull();
  });

  // The fix: a closure weeks out no longer outranks tomorrow's workout.
  it("prefers a nearer instance over a later series closure", () => {
    const status = getMapEventStatus(
      event({ endDate: "2026-08-28" }),
      lookup([{ seriesException: null, startDate: "2026-08-06" }]),
      TODAY,
    );

    expect(status).toBe("event-instance");
  });

  it("prefers a nearer series closure over a later instance", () => {
    const status = getMapEventStatus(
      event({ endDate: "2026-08-06" }),
      lookup([{ seriesException: "different-time", startDate: "2026-08-25" }]),
      TODAY,
    );

    expect(status).toBe("closed");
  });

  it("prefers a nearer instance over a later series start", () => {
    const status = getMapEventStatus(
      event({ startDate: "2026-08-30" }),
      lookup([{ seriesException: "closed", startDate: "2026-08-07" }]),
      TODAY,
    );

    expect(status).toBe("closed");
  });

  it("picks the soonest of several instances", () => {
    const status = getMapEventStatus(
      event(),
      lookup([
        { seriesException: "closed", startDate: "2026-08-20" },
        { seriesException: "different-time", startDate: "2026-08-07" },
        { seriesException: null, startDate: "2026-08-15" },
      ]),
      TODAY,
    );

    expect(status).toBe("different-time");
  });

  it("still reports a series closing inside the horizon", () => {
    expect(
      getMapEventStatus(event({ endDate: "2026-08-20" }), new Map(), TODAY),
    ).toBe("closed");
  });

  it("ignores an endDate beyond the 30-day horizon", () => {
    expect(
      getMapEventStatus(event({ endDate: "2026-10-01" }), new Map(), TODAY),
    ).toBeNull();
  });

  it("reports a series closing today", () => {
    expect(getMapEventStatus(event({ endDate: TODAY }), new Map(), TODAY)).toBe(
      "closed",
    );
  });

  it("reports a series closing on the final horizon day", () => {
    expect(
      getMapEventStatus(event({ endDate: "2026-09-04" }), new Map(), TODAY),
    ).toBe("closed");
  });

  it("does not call a not-yet-started series closed", () => {
    const status = getMapEventStatus(
      event({ startDate: "2026-08-10", endDate: "2026-08-12" }),
      new Map(),
      TODAY,
    );

    // Upcoming, not closing — so the future start wins, not the endDate.
    expect(status).toBe("different-time");
  });
});

/**
 * The two entry points compute the same concept from different inputs — the
 * marker path from `getMapEventStatus`, the panel path from
 * `buildEventStatusMap` — and both color the same `EventChip`. Each was well
 * covered in isolation, but nothing asserted they agree on a shared event, so
 * the panel silently ignoring a series' own start/end dates passed CI while
 * rendering visibly different colors for one workout.
 */
describe("the panel and the map agree on a shared event", () => {
  const TODAY = "2026-08-05";

  const bothPaths = (
    event: StatusBaseEvent,
    instances: StatusInstance[] = [],
  ) => {
    const panel = statusMapFor(instances, [event], TODAY).get(event.id) ?? null;

    // Rebuild the marker path's lookup the way the provider does: grouped by
    // seriesId, with no location filtering.
    const marker = getMapEventStatus(
      {
        id: event.id,
        startDate: event.startDate ?? null,
        endDate: event.endDate ?? null,
      },
      new Map([
        [
          event.id,
          instances
            .filter((i) => i.seriesId === event.id)
            .map((i) => ({
              seriesException: i.seriesException,
              startDate: i.startDate,
            })),
        ],
      ]),
      TODAY,
    );

    return { panel, marker };
  };

  // The regression: a series closing inside the horizon with no exception
  // instances rendered closed on the marker and uncolored in the panel.
  it("agrees on a series closing inside the horizon with no instances", () => {
    const { panel, marker } = bothPaths({
      id: BASE_EVENT_ID,
      startDate: "2026-01-01",
      endDate: "2026-08-15",
    });

    expect(marker).toBe("closed");
    expect(panel).toBe(marker);
  });

  // The reverse case: a future start read as "different-time" on the marker.
  it("agrees on a series that has not started yet", () => {
    const { panel, marker } = bothPaths({
      id: BASE_EVENT_ID,
      startDate: "2026-08-30",
      endDate: null,
    });

    expect(marker).toBe("different-time");
    expect(panel).toBe(marker);
  });

  it("agrees when a nearer instance outranks the series endDate", () => {
    const { panel, marker } = bothPaths(
      { id: BASE_EVENT_ID, startDate: "2026-01-01", endDate: "2026-08-28" },
      [instance({ id: 1, startDate: "2026-08-06", seriesException: null })],
    );

    expect(marker).toBe("event-instance");
    expect(panel).toBe(marker);
  });

  it("agrees when nothing dated is in range", () => {
    const { panel, marker } = bothPaths({
      id: BASE_EVENT_ID,
      startDate: "2026-01-01",
      endDate: null,
    });

    expect(marker).toBeNull();
    expect(panel).toBeNull();
  });
});

describe("statusLabel", () => {
  it("gives every status a text equivalent, so color is never the only cue", () => {
    expect(statusLabel("closed")).toBe("Closed");
    expect(statusLabel("different-time")).toBe("Different time");
    expect(statusLabel("miscellaneous")).toBe("Miscellaneous");
    expect(statusLabel("event-instance")).toBe("Special instance");
    expect(statusLabel(null)).toBe("Scheduled");
  });

  it("labels each exception the swatch can show", () => {
    // The "Updates" list derives its swatch from seriesException, so every
    // exception must round-trip to a non-empty label.
    for (const exception of [
      null,
      "closed",
      "different-time",
      "anything-else",
    ]) {
      expect(statusLabel(instanceMapStatus(exception))).toMatch(/\S/);
    }
  });
});

describe("findNextExceptionNotice", () => {
  const exceptionInstance = (
    overrides: Partial<ExceptionInstance> = {},
  ): ExceptionInstance => ({
    id: 1,
    seriesId: BASE_EVENT_ID,
    startDate: "2026-09-02",
    startTime: "0615",
    seriesException: "different-time",
    ...overrides,
  });

  const series = { id: BASE_EVENT_ID, startTime: "0515" };

  it("returns nothing when the event has no upcoming exception", () => {
    expect(findNextExceptionNotice(series, [])).toBeUndefined();
    expect(findNextExceptionNotice(series, undefined)).toBeUndefined();
    expect(
      findNextExceptionNotice(series, [
        exceptionInstance({ seriesId: BASE_EVENT_ID + 1 }),
      ]),
    ).toBeUndefined();
  });

  it("returns nothing when there is no event to describe", () => {
    expect(findNextExceptionNotice(undefined, [exceptionInstance()])).toBe(
      undefined,
    );
    expect(
      findNextExceptionNotice(null, [exceptionInstance()]),
    ).toBeUndefined();
  });

  it("surfaces the overridden time for a different-time exception", () => {
    expect(findNextExceptionNotice(series, [exceptionInstance()])).toEqual({
      status: "different-time",
      label: "Different time",
      startDate: "2026-09-02",
      overrideStartTime: "0615",
    });
  });

  it("announces the soonest exception, not whichever the API listed first", () => {
    // `upcomingInstances` comes back unordered, so a later change must not win
    // just by arriving first.
    const notice = findNextExceptionNotice(series, [
      exceptionInstance({ id: 2, startDate: "2026-09-16", startTime: "0700" }),
      exceptionInstance({ id: 3, startDate: "2026-09-09", startTime: "0630" }),
    ]);
    expect(notice?.startDate).toBe("2026-09-09");
    expect(notice?.overrideStartTime).toBe("0630");
  });

  it("omits the time for a closed instance", () => {
    // A closure carries whatever time the row happened to hold; printing it
    // would read as "come at 6:15" for a workout that is not happening.
    const notice = findNextExceptionNotice(series, [
      exceptionInstance({ seriesException: "closed", startTime: "0615" }),
    ]);
    expect(notice?.status).toBe("closed");
    expect(notice?.overrideStartTime).toBeNull();
  });

  it("omits the time when the exception keeps the regular schedule", () => {
    const notice = findNextExceptionNotice(series, [
      exceptionInstance({
        seriesException: "miscellaneous",
        startTime: "0515",
      }),
    ]);
    expect(notice?.label).toBe("Miscellaneous");
    expect(notice?.overrideStartTime).toBeNull();
  });

  it("matches an instance-derived event by its own id and skips the redundant time", () => {
    // A negative id means the event was synthesized from the instance, so the
    // chip beside the notice already shows this exact time.
    const notice = findNextExceptionNotice({ id: -7, startTime: "0615" }, [
      exceptionInstance({
        id: 7,
        seriesId: null,
        seriesException: null,
        startTime: "0615",
      }),
    ]);
    expect(notice?.label).toBe("Special instance");
    expect(notice?.overrideStartTime).toBeNull();
  });

  it("does not match an instance-derived event against its series siblings", () => {
    expect(
      findNextExceptionNotice({ id: -7, startTime: "0615" }, [
        exceptionInstance({ id: 8 }),
      ]),
    ).toBeUndefined();
  });
});
