"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

import type { Workout } from "@/types/region";
import { WorkoutCard } from "@/components/workout-card";
import { filterWorkouts, groupByDayInOrder } from "@/lib/workout-filters";

interface WorkoutListProps {
  /** Sorted by next occurrence; filtering and grouping preserve that order. */
  workouts: Workout[];
}

const titleCase = (day: string) => day.charAt(0).toUpperCase() + day.slice(1);

export function WorkoutList({ workouts }: WorkoutListProps) {
  const searchParams = useSearchParams();
  const day = searchParams.get("day");
  const type = searchParams.get("type");
  const filtered = useMemo(
    () => filterWorkouts(workouts, { day, type }),
    [workouts, day, type],
  );

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
      {groupByDayInOrder(filtered).map(([groupDay, dayWorkouts]) => (
        <div key={groupDay} className="mb-6">
          <h3 className="sticky top-16 z-10 mb-3 bg-white py-2 text-xl font-semibold dark:bg-gray-800">
            {titleCase(groupDay)}
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            {dayWorkouts.map((workout) => (
              <WorkoutCard key={workout.id} workout={workout} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
