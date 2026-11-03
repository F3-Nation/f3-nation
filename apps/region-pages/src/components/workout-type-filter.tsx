"use client";

import { useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";

import type { Workout } from "@/types/region";
import { workoutTypesOf } from "@/lib/workout-filters";

interface WorkoutTypeFilterProps {
  /** Used only to list the type options. */
  workouts: Workout[];
}

/** Sets `?type=`; WorkoutList derives the visible workouts from the URL. */
export function WorkoutTypeFilter({ workouts }: WorkoutTypeFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedType = searchParams.get("type")?.toLowerCase() ?? null;

  const normalizedTypeOptions = useMemo(() => {
    const entries = new Map<string, string>();
    workouts.forEach((workout) => {
      workoutTypesOf(workout).forEach((type) => {
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
      params.set("type", newType);
    } else {
      params.delete("type");
    }
    router.push(`?${params.toString()}`);
  };

  if (workoutTypes.length === 0) return null;

  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
        Filter by Workout Type
      </h3>

      {/* Mobile: Select Dropdown */}
      <div className="sm:hidden">
        <select
          aria-label="Filter by workout type"
          value={selectedType ?? ""}
          onChange={handleSelectChange}
          className="w-full rounded-lg border-gray-200 bg-gray-50 px-3 py-2 text-base font-medium text-gray-700 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:focus:ring-blue-400"
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
      <div className="hidden gap-2 sm:flex sm:flex-wrap">
        {workoutTypes.map((type) => {
          const isSelected = selectedType === type.key;
          return (
            <button
              key={type.key}
              onClick={() => handleTypeClick(type.key)}
              aria-pressed={isSelected}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
                isSelected
                  ? "bg-blue-600 text-white shadow-lg ring-2 ring-blue-600 ring-offset-2 dark:ring-offset-gray-800"
                  : "bg-gray-50 text-gray-700 hover:bg-gray-100 hover:shadow-xs dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
              } `}
            >
              {type.label}
            </button>
          );
        })}
        {selectedType && (
          <button
            onClick={() => handleTypeClick(selectedType)}
            className="rounded-lg px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-800 dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300"
          >
            Clear Filter
          </button>
        )}
      </div>
    </div>
  );
}
