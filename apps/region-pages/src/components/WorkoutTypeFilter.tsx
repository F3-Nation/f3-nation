'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { WorkoutWithRegion } from '@/types/Workout';

interface WorkoutTypeFilterProps {
  workouts: WorkoutWithRegion[];
  onFilteredWorkouts: (workouts: WorkoutWithRegion[]) => void;
}

export function WorkoutTypeFilter({
  workouts,
  onFilteredWorkouts,
}: WorkoutTypeFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedType, setSelectedType] = useState<string | null>(
    searchParams.get('type')?.toLowerCase() || null
  );

  const normalizedTypeOptions = useMemo(() => {
    const entries = new Map<string, string>();
    workouts.forEach((workout) => {
      const types =
        Array.isArray(workout.types) && workout.types.length > 0
          ? workout.types
          : workout.type
            ? [workout.type]
            : [];

      types.forEach((type) => {
        const trimmed = type.trim();
        if (!trimmed) return;
        const key = trimmed.toLowerCase();
        if (!entries.has(key)) {
          entries.set(key, trimmed);
        }
      });
    });
    return Array.from(entries.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([key, label]) => ({ key, label }));
  }, [workouts]);

  // Get unique workout types from the data
  const workoutTypes = normalizedTypeOptions;

  // Apply filter based on URL param on mount and when URL changes
  useEffect(() => {
    const typeParam = searchParams.get('type')?.toLowerCase() || null;
    setSelectedType(typeParam);

    if (typeParam) {
      const filtered = workouts.filter((workout) => {
        const types =
          Array.isArray(workout.types) && workout.types.length > 0
            ? workout.types
            : workout.type
              ? [workout.type]
              : [];
        return types.some((type) => type.toLowerCase() === typeParam);
      });
      onFilteredWorkouts(filtered);
    } else {
      onFilteredWorkouts(workouts);
    }
  }, [searchParams, workouts, onFilteredWorkouts]);

  const handleTypeClick = (typeKey: string) => {
    const newType = selectedType === typeKey ? null : typeKey;
    updateTypeFilter(newType);
  };

  const handleSelectChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newType = event.target.value || null;
    updateTypeFilter(newType);
  };

  const updateTypeFilter = (newType: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (newType) {
      params.set('type', newType);
    } else {
      params.delete('type');
    }
    router.push(`?${params.toString()}`);
  };

  if (workoutTypes.length === 0) return null;

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        Filter by Workout Type
      </h3>

      {/* Mobile: Select Dropdown */}
      <div className="sm:hidden">
        <select
          value={selectedType || ''}
          onChange={handleSelectChange}
          className="w-full px-3 py-2 rounded-lg text-sm font-medium bg-gray-50 text-gray-700 border-gray-200 
                        dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600
                        focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent"
        >
          <option value="">All Types</option>
          {workoutTypes.map((type) => (
            <option key={type.key} value={type.key}>
              {type.label}
            </option>
          ))}
        </select>
      </div>

      {/* Desktop: Button Grid */}
      <div className="hidden sm:flex sm:flex-wrap gap-2">
        {workoutTypes.map((type) => {
          const isSelected = selectedType === type.key;
          return (
            <button
              key={type.key}
              onClick={() => handleTypeClick(type.key)}
              className={`
                                px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
                                ${
                                  isSelected
                                    ? 'bg-blue-600 text-white shadow-lg ring-2 ring-blue-600 ring-offset-2 dark:ring-offset-gray-800'
                                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100 hover:shadow dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
                                }
                            `}
            >
              {type.label}
            </button>
          );
        })}
        {selectedType && (
          <button
            onClick={() => handleTypeClick(selectedType)}
            className="px-4 py-2 rounded-lg text-sm font-medium text-red-600 hover:text-red-800 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-900/30 transition-colors"
          >
            Clear Filter
          </button>
        )}
      </div>
    </div>
  );
}
