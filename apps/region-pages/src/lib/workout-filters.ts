import type { Workout } from "@/types/region";

export const workoutTypesOf = (workout: Workout): string[] =>
  (workout.types.length > 0 ? workout.types : [workout.type])
    .map((type) => type.trim())
    .filter(Boolean);

/** The `?day=` and `?type=` filters, both applied (case-insensitive). */
export function filterWorkouts(
  workouts: Workout[],
  { day, type }: { day?: string | null; type?: string | null },
): Workout[] {
  const dayKey = day?.toLowerCase();
  const typeKey = type?.toLowerCase();
  return workouts.filter(
    (workout) =>
      (!dayKey || workout.group.toLowerCase() === dayKey) &&
      (!typeKey ||
        workoutTypesOf(workout).some((t) => t.toLowerCase() === typeKey)),
  );
}

export interface DayGroup {
  /** Stable and unique, even when a day appears twice. */
  key: string;
  day: string;
  /** This day already had an earlier group, i.e. this one is next week's. */
  repeat: boolean;
  workouts: Workout[];
}

/**
 * Split an already-ordered list into runs of consecutive workouts on the same
 * day, never reordering it. Grouping by weekday alone would merge today's
 * later workouts with next week's same-day ones and pull those ahead of
 * tomorrow's; a run per occurrence keeps next-occurrence order intact.
 */
export function groupByDayRuns(workouts: Workout[]): DayGroup[] {
  const groups: DayGroup[] = [];
  const seen = new Set<string>();
  for (const workout of workouts) {
    const day = workout.group.toLowerCase();
    const last = groups.at(-1);
    if (last?.day === day) {
      last.workouts.push(workout);
      continue;
    }
    groups.push({
      key: `${day}-${groups.length}`,
      day,
      repeat: seen.has(day),
      workouts: [workout],
    });
    seen.add(day);
  }
  return groups;
}
