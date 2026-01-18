'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { DayFilter } from '@/components/DayFilter';
import { WorkoutTypeFilter } from '@/components/WorkoutTypeFilter';
import { ClearFiltersButton } from '@/components/ClearFiltersButton';
import { WorkoutWithRegion } from '@/types/Workout';

interface WorkoutFiltersProps {
  workouts: WorkoutWithRegion[];
  onFilteredWorkouts: (workouts: WorkoutWithRegion[]) => void;
}

export function WorkoutFilters({
  workouts,
  onFilteredWorkouts,
}: WorkoutFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const searchParams = useSearchParams();
  const selectedDay = searchParams.get('day');
  const selectedType = searchParams.get('type');
  const hasFilters = selectedDay || selectedType;

  // Auto-collapse when filters change
  useEffect(() => {
    setIsExpanded(false);
  }, [selectedDay, selectedType]);

  const getFilterSummary = () => {
    const parts = [];
    if (selectedDay) {
      parts.push(selectedDay.charAt(0).toUpperCase() + selectedDay.slice(1));
    }
    if (selectedType) {
      parts.push(selectedType.charAt(0).toUpperCase() + selectedType.slice(1));
    }
    return parts.length > 0 ? parts.join(' · ') : 'No filters';
  };

  return (
    <div>
      {/* Mobile Collapsed View */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="sm:hidden w-full flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-200"
      >
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
            />
          </svg>
          <span>{hasFilters ? getFilterSummary() : 'Filter Workouts'}</span>
        </div>
        <svg
          className={`w-5 h-5 transition-transform ${
            isExpanded ? 'rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Filters Content */}
      <div className={`space-y-4 ${!isExpanded ? 'hidden sm:block' : 'mt-4'}`}>
        <DayFilter
          workouts={workouts}
          onFilteredWorkouts={onFilteredWorkouts}
        />
        <WorkoutTypeFilter
          workouts={workouts}
          onFilteredWorkouts={onFilteredWorkouts}
        />
        <div className="sm:hidden">
          <ClearFiltersButton />
        </div>
      </div>
    </div>
  );
}
