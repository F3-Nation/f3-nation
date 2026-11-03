"use client";

import { useSearchParams } from "next/navigation";

import type { Workout } from "@/types/region";
import { WorkoutCard } from "@/components/workout-card";
import { filterWorkouts, groupByDayRuns } from "@/lib/workout-filters";

interface WorkoutListViewProps {
  /** In display order; filtering and grouping preserve it. */
  workouts: Workout[];
  day: string | null;
  type: string | null;
}

const titleCase = (day: string) => day.charAt(0).toUpperCase() + day.slice(1);

/** The list for given filters. Pure, so it can also be a Suspense fallback. */
export function WorkoutListView({ workouts, day, type }: WorkoutListViewProps) {
  const filtered = filterWorkouts(workouts, { day, type });

  if (filtered.length === 0) {
    return (
      <div className="py-8 text-center text-gray-500 dark:text-gray-400">
        No workouts match the selected filters
      </div>
    );
  }

  if (day) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {filtered.map((workout) => (
          <WorkoutCard key={workout.id} workout={workout} />
        ))}
      </div>
    );
  }

  return (
    <div>
      {groupByDayRuns(filtered).map((group) => (
        <div key={group.key} className="mb-6">
          <h3 className="sticky top-16 z-10 mb-3 bg-white py-2 text-xl font-semibold dark:bg-gray-800">
            {titleCase(group.day)}
            {group.repeat ? " (next week)" : ""}
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            {group.workouts.map((workout) => (
              <WorkoutCard key={workout.id} workout={workout} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The list filtered by `?day=` and `?type=`. */
export function WorkoutList({ workouts }: { workouts: Workout[] }) {
  const searchParams = useSearchParams();
  return (
    <WorkoutListView
      workouts={workouts}
      day={searchParams.get("day")}
      type={searchParams.get("type")}
    />
  );
}
