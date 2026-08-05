import dayjs from "dayjs";

import type { MapStatus } from "~/utils/types";

const HORIZON_DAYS = 30;

/**
 * The instance fields that drive status coloring. Kept structural so both the
 * API's `upcomingInstances` rows and test fixtures satisfy it.
 */
export interface StatusInstance {
  id: number;
  seriesId: number | null;
  locationId: number | null;
  seriesException: string | null;
  startDate: string;
}

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
 * Maps each displayed event to its soonest upcoming instance's status.
 * Series-linked instances key by `seriesId`; orphans key by their negated id,
 * matching the synthetic events the component creates.
 */
export function buildEventStatusMap(
  instances: readonly StatusInstance[],
  baseEventIds: ReadonlySet<number>,
): Map<number, MapStatus> {
  const map = new Map<number, MapStatus>();
  const nearestDate = new Map<number, string>();

  for (const instance of instances) {
    const { seriesId } = instance;
    // Inlined because TS can't narrow `seriesId != null` through a variable.
    if (seriesId == null || !baseEventIds.has(seriesId)) {
      map.set(-instance.id, instanceMapStatus(instance.seriesException));
      continue;
    }

    const existing = nearestDate.get(seriesId);
    if (!existing || instance.startDate < existing) {
      nearestDate.set(seriesId, instance.startDate);
      map.set(seriesId, instanceMapStatus(instance.seriesException));
    }
  }

  return map;
}

export function getMapEventStatus(
  event: { id: number; startDate: string | null; endDate: string | null },
  instanceLookup: ReadonlyMap<
    number,
    { seriesException: string | null; startDate: string }[]
  >,
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
