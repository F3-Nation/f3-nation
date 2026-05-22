'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { WorkoutWithRegion } from '@/types/Workout';

const DAYS_OF_WEEK = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

interface DayFilterProps {
  workouts: WorkoutWithRegion[];
  onFilteredWorkouts: (workouts: WorkoutWithRegion[]) => void;
}

export function DayFilter({ workouts, onFilteredWorkouts }: DayFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedDay, setSelectedDay] = useState<string | null>(
    searchParams.get('day')?.toLowerCase() || null
  );

  // Apply filter based on URL param on mount and when URL changes
  useEffect(() => {
    const dayParam = searchParams.get('day')?.toLowerCase() || null;
    setSelectedDay(dayParam);

    if (dayParam) {
      const filtered = workouts.filter(
        (workout) => workout.group?.toLowerCase() === dayParam
      );
      onFilteredWorkouts(filtered);
    } else {
      onFilteredWorkouts(workouts);
    }
  }, [searchParams, workouts, onFilteredWorkouts]);

  const handleDayClick = (day: string) => {
    const newDay = selectedDay === day.toLowerCase() ? null : day.toLowerCase();
    updateDayFilter(newDay);
  };

  const handleSelectChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newDay = event.target.value || null;
    updateDayFilter(newDay);
  };

  const updateDayFilter = (newDay: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (newDay) {
      params.set('day', newDay);
    } else {
      params.delete('day');
    }
    router.push(`?${params.toString()}`);
  };

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        Filter by Day
      </h3>

      {/* Mobile: Select Dropdown */}
      <div className="sm:hidden">
        <select
          value={selectedDay || ''}
          onChange={handleSelectChange}
          className="w-full px-3 py-2 rounded-lg text-sm font-medium bg-gray-50 text-gray-700 border-gray-200 
                        dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600
                        focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent"
        >
          <option value="">All Days</option>
          {DAYS_OF_WEEK.map((day) => (
            <option key={day} value={day.toLowerCase()}>
              {day}
            </option>
          ))}
        </select>
      </div>

      {/* Desktop: Button Grid */}
      <div className="hidden sm:flex sm:flex-wrap gap-2">
        {DAYS_OF_WEEK.map((day) => {
          const isSelected = selectedDay === day.toLowerCase();
          return (
            <button
              key={day}
              onClick={() => handleDayClick(day)}
              className={`
                                px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
                                ${
                                  isSelected
                                    ? 'bg-blue-600 text-white shadow-lg ring-2 ring-blue-600 ring-offset-2 dark:ring-offset-gray-800'
                                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100 hover:shadow dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
                                }
                            `}
            >
              {day}
            </button>
          );
        })}
        {selectedDay && (
          <button
            onClick={() =>
              handleDayClick(
                DAYS_OF_WEEK.find((d) => d.toLowerCase() === selectedDay) ||
                  DAYS_OF_WEEK[0]
              )
            }
            className="px-4 py-2 rounded-lg text-sm font-medium text-red-600 hover:text-red-800 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-900/30 transition-colors"
          >
            Clear Filter
          </button>
        )}
      </div>
    </div>
  );
}
