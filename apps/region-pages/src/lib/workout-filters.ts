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

/**
 * Group by day, keeping the incoming order: for a list already sorted by next
 * occurrence, the first group is the next day with a workout.
 */
export function groupByDayInOrder(
  workouts: Workout[],
): [day: string, workouts: Workout[]][] {
  const groups = new Map<string, Workout[]>();
  for (const workout of workouts) {
    const day = workout.group.toLowerCase();
    const list = groups.get(day) ?? [];
    list.push(workout);
    groups.set(day, list);
  }
  return [...groups.entries()];
}
