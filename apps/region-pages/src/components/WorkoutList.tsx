'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { WorkoutCard } from '@/components/WorkoutCard';
import { WorkoutWithRegion } from '@/types/Workout';
import { DAYS_ORDER } from '@/utils/workoutSorting';

interface WorkoutListProps {
  workouts: WorkoutWithRegion[];
}

export function WorkoutList({ workouts }: WorkoutListProps) {
  const searchParams = useSearchParams();
  const [filteredWorkouts, setFilteredWorkouts] = useState(workouts);
  const dayParam = searchParams.get('day')?.toLowerCase();

  // Apply both filters whenever either changes
  useEffect(() => {
    const typeParam = searchParams.get('type')?.toLowerCase();

    let filtered = workouts;

    // Apply day filter
    if (dayParam) {
      filtered = filtered.filter(
        (workout) => workout.group?.toLowerCase() === dayParam
      );
    }

    // Apply type filter
    if (typeParam) {
      filtered = filtered.filter((workout) => {
        const types =
          Array.isArray(workout.types) && workout.types.length > 0
            ? workout.types
            : workout.type
              ? [workout.type]
              : [];
        return types.some((type) => type.toLowerCase() === typeParam);
      });
    }

    setFilteredWorkouts(filtered);
  }, [workouts, searchParams, dayParam]);

  // Group workouts by day when no day filter is active
  const groupedWorkouts = dayParam
    ? null
    : filteredWorkouts.reduce(
        (acc, workout) => {
          const day = workout.group || 'Other';
          if (!acc[day]) acc[day] = [];
          acc[day].push(workout);
          return acc;
        },
        {} as Record<string, WorkoutWithRegion[]>
      );

  // Sort grouped workouts by day order (Monday to Sunday) with case-insensitive matching
  const sortedGroupedWorkouts = groupedWorkouts
    ? Object.entries(groupedWorkouts).sort(([dayA], [dayB]) => {
        // Convert to Title Case for matching with DAYS_ORDER
        const titleCaseA =
          dayA.charAt(0).toUpperCase() + dayA.slice(1).toLowerCase();
        const titleCaseB =
          dayB.charAt(0).toUpperCase() + dayB.slice(1).toLowerCase();
        const indexA = DAYS_ORDER.indexOf(
          titleCaseA as (typeof DAYS_ORDER)[number]
        );
        const indexB = DAYS_ORDER.indexOf(
          titleCaseB as (typeof DAYS_ORDER)[number]
        );
        return indexA - indexB;
      })
    : null;

  return (
    <div>
      {dayParam ? (
        // Flat list when day filter is active
        <div className="grid gap-4 md:grid-cols-2">
          {filteredWorkouts.map((workout: WorkoutWithRegion) => (
            <WorkoutCard key={workout.id} workout={workout} />
          ))}
        </div>
      ) : (
        // Grouped by day with headers when no day filter (sorted Monday to Sunday)
        sortedGroupedWorkouts?.map(([day, dayWorkouts]) => (
          <div key={day} className="mb-6">
            <h3 className="text-xl font-semibold mb-3 sticky top-16 bg-white dark:bg-gray-800 py-2 z-10">
              {day.charAt(0).toUpperCase() + day.slice(1).toLowerCase()}
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              {dayWorkouts.map((workout) => (
                <WorkoutCard key={workout.id} workout={workout} />
              ))}
            </div>
          </div>
        ))
      )}

      {filteredWorkouts.length === 0 && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          No workouts match the selected filters
        </div>
      )}
    </div>
  );
}
