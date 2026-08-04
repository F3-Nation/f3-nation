/**
 * Orders upcoming instances soonest-first for display, since the API's
 * `upcomingInstances` query has no `ORDER BY`.
 *
 * `startTime` breaks ties within a day; instances without one sort first
 * (an all-day change covers the whole day). Both fields are already
 * lexicographically ordered (`YYYY-MM-DD`, `HHmm`), so no date parsing is
 * needed. Returns a new array — callers may hold a memoized reference.
 */
export function sortUpcomingInstancesByDate<
  T extends { startDate: string; startTime: string | null },
>(instances: readonly T[]): T[] {
  return [...instances].sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) ||
      (a.startTime ?? "").localeCompare(b.startTime ?? ""),
  );
}
