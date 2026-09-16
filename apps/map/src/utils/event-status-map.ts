import dayjs from "dayjs";

import type { SeriesException } from "@acme/shared/app/enums";

import type { MapStatus } from "~/utils/types";
import { sortUpcomingInstancesByDate } from "~/utils/date";

const HORIZON_DAYS = 30;

/**
 * The instance fields that drive status coloring. Kept structural so both the
 * API's `upcomingInstances` rows and test fixtures satisfy it.
 */
export interface StatusInstance {
  id: number;
  seriesId: number | null;
  locationId: number | null;
  seriesException: SeriesException | null;
  startDate: string;
}

/** The per-series rows the status lookup carries. */
export interface StatusInstanceSummary {
  seriesException: SeriesException | null;
  startDate: string;
}

/**
 * Takes a bare `string` rather than `SeriesException`: this is the boundary
 * where an exception value the frontend has never heard of — a pgEnum member
 * added by a migration that ships ahead of this app — degrades to
 * "miscellaneous" instead of going uncolored. The types describing API rows are
 * narrow; only this ladder stays permissive.
 */
export function instanceMapStatus(
  seriesException: string | null,
): NonNullable<MapStatus> {
  if (seriesException === "closed") return "closed";
  if (seriesException === "different-time") return "different-time";
  if (seriesException) return "miscellaneous";
  return "event-instance";
}

const STATUS_LABELS: Record<NonNullable<MapStatus>, string> = {
  closed: "Closed",
  "different-time": "Different time",
  miscellaneous: "Miscellaneous",
  "event-instance": "Special instance",
};

export function statusLabel(status: MapStatus): string {
  return status ? STATUS_LABELS[status] : "Scheduled";
}

/** The instance fields the exception notice reads. */
export interface ExceptionInstance {
  id: number;
  seriesId: number | null;
  startDate: string;
  startTime: string | null;
  seriesException: SeriesException | null;
}

export interface ExceptionNotice {
  status: NonNullable<MapStatus>;
  label: string;
  startDate: string;
  /**
   * The overridden start time, or null when there is nothing new to announce —
   * either it matches the schedule already on screen, or the instance is closed
   * and so has no meaningful time.
   */
  overrideStartTime: string | null;
}

/**
 * The soonest upcoming exception affecting `event`, for surfaces that show a
 * single schedule and would otherwise present a time the next occurrence does
 * not use. Returns undefined when the event has no upcoming exception.
 *
 * A negative `event.id` marks an event synthesized from an instance: the
 * instance *is* the event, so its own time is already on screen and
 * `overrideStartTime` stays null rather than repeating it.
 */
export function findNextExceptionNotice(
  event: { id: number; startTime: string | null } | null | undefined,
  instances: readonly ExceptionInstance[] | undefined,
): ExceptionNotice | undefined {
  if (!event || !instances?.length) return undefined;

  const matches =
    event.id > 0
      ? instances.filter((instance) => instance.seriesId === event.id)
      : instances.filter((instance) => instance.id === -event.id);

  // The API returns these unordered, and only the soonest is announced.
  const next = sortUpcomingInstancesByDate(matches)[0];
  if (!next) return undefined;

  const status = instanceMapStatus(next.seriesException);
  const hasNewTime =
    next.seriesException !== "closed" &&
    next.startTime != null &&
    next.startTime !== event.startTime;

  return {
    status,
    label: statusLabel(status),
    startDate: next.startDate,
    overrideStartTime: hasNewTime ? next.startTime : null,
  };
}

export function selectStatusInstances<T extends StatusInstance>(
  instances: readonly T[],
  currentLocationId: number,
  baseEventIds: ReadonlySet<number>,
): T[] {
  return instances.filter((instance) =>
    instance.seriesId != null && baseEventIds.has(instance.seriesId)
      ? true
      : instance.locationId === currentLocationId,
  );
}

/**
 * The base-event fields that drive status coloring, mirroring what
 * `getMapEventStatus` reads off a marker's event.
 */
export interface StatusBaseEvent {
  id: number;
  startDate?: string | null;
  endDate?: string | null;
}

/**
 * Maps each displayed event to its status, delegating per base event to
 * `getMapEventStatus` so the panel and the map agree on a shared event.
 *
 * Orphan instances (no series, or a series this location does not own) have no
 * base event to inspect, so they keep the instance-only path and key by their
 * negated id, matching the synthetic events the component creates.
 */
export function buildEventStatusMap(
  instances: readonly StatusInstance[],
  baseEvents: readonly StatusBaseEvent[],
  todayIso: string = dayjs().format("YYYY-MM-DD"),
): Map<number, MapStatus> {
  const map = new Map<number, MapStatus>();
  const baseEventIds = new Set(baseEvents.map((event) => event.id));
  const instancesBySeriesId = new Map<number, StatusInstanceSummary[]>();

  for (const instance of instances) {
    const { seriesId } = instance;
    // Inlined because TS can't narrow `seriesId != null` through a variable.
    if (seriesId == null || !baseEventIds.has(seriesId)) {
      map.set(-instance.id, instanceMapStatus(instance.seriesException));
      continue;
    }

    const list = instancesBySeriesId.get(seriesId) ?? [];
    list.push({
      seriesException: instance.seriesException,
      startDate: instance.startDate,
    });
    instancesBySeriesId.set(seriesId, list);
  }

  for (const event of baseEvents) {
    const status = getMapEventStatus(
      {
        id: event.id,
        startDate: event.startDate ?? null,
        endDate: event.endDate ?? null,
      },
      instancesBySeriesId,
      todayIso,
    );
    // Only statuses land in the map; consumers read a miss as "no status".
    if (status !== null) map.set(event.id, status);
  }

  return map;
}

export function getMapEventStatus(
  event: { id: number; startDate: string | null; endDate: string | null },
  instanceLookup: ReadonlyMap<number, StatusInstanceSummary[]>,
  todayIso: string = dayjs().format("YYYY-MM-DD"),
): MapStatus {
  const horizonIso = dayjs(todayIso)
    .add(HORIZON_DAYS, "day")
    .format("YYYY-MM-DD");
  const candidates: { date: string; status: NonNullable<MapStatus> }[] = [];

  if (event.endDate) {
    // A series that has not started yet is "upcoming", not "closing".
    const hasStarted = !event.startDate || event.startDate <= todayIso;
    if (
      hasStarted &&
      event.endDate >= todayIso &&
      event.endDate <= horizonIso
    ) {
      candidates.push({ date: event.endDate, status: "closed" });
    }
  }

  if (
    event.startDate &&
    event.startDate > todayIso &&
    event.startDate <= horizonIso
  ) {
    candidates.push({ date: event.startDate, status: "different-time" });
  }

  for (const instance of instanceLookup.get(event.id) ?? []) {
    candidates.push({
      date: instance.startDate,
      status: instanceMapStatus(instance.seriesException),
    });
  }

  if (candidates.length === 0) return null;

  return candidates.reduce((nearest, candidate) =>
    candidate.date < nearest.date ? candidate : nearest,
  ).status;
}
