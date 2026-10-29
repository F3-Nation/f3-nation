"use client";

import { useMemo, useSyncExternalStore } from "react";

import type { Workout } from "@/types/region";
import { sortWorkoutsByDayAndTime } from "@/lib/workout-sorting";

const subscribeNoop = () => () => undefined;

/**
 * `workouts` (in week order) re-sorted by next occurrence on the visitor's
 * own clock once the page has hydrated. The server and the hydration pass
 * keep week order: the server's clock is UTC, not the region's, and both
 * renders must match. A visitor's clock is almost always in the region's
 * timezone, which the API doesn't know.
 */
export function useUpcomingOrder(workouts: Workout[]): Workout[] {
  const isClient = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  return useMemo(
    () => (isClient ? sortWorkoutsByDayAndTime(workouts) : workouts),
    [workouts, isClient],
  );
}
