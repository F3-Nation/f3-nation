"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { DayFilter } from "@/components/day-filter";
import { WorkoutTypeFilter } from "@/components/workout-type-filter";
import { ClearFiltersButton } from "@/components/clear-filters-button";
import type { Workout } from "@/types/region";

interface WorkoutFiltersProps {
  workouts: Workout[];
}

export function WorkoutFilters({ workouts }: WorkoutFiltersProps) {
  // Collapsed on mobile until opened, so the workout list stays above the fold.
  const [isExpanded, setIsExpanded] = useState(false);
  const searchParams = useSearchParams();
  const selectedDay = searchParams.get("day");
  const selectedType = searchParams.get("type");
  const hasFilters = Boolean(selectedDay) || Boolean(selectedType);

  // Collapse again whenever the filters change: adjust state during render
  // (https://react.dev/learn/you-might-not-need-an-effect) instead of an effect.
  const filterKey = `${selectedDay ?? ""}|${selectedType ?? ""}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setIsExpanded(false);
  }

  const getFilterSummary = () => {
    const parts = [];
    if (selectedDay) {
      parts.push(selectedDay.charAt(0).toUpperCase() + selectedDay.slice(1));
    }
    if (selectedType) {
      parts.push(selectedType.charAt(0).toUpperCase() + selectedType.slice(1));
    }
    return parts.length > 0 ? parts.join(" · ") : "No filters";
  };

  return (
    <div>
      {/* Mobile Collapsed View */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between text-sm font-medium text-gray-700 sm:hidden dark:text-gray-200"
      >
        <div className="flex items-center gap-2">
          <svg
            className="h-4 w-4"
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
          <span>{hasFilters ? getFilterSummary() : "Filter Workouts"}</span>
        </div>
        <svg
          className={`h-5 w-5 transition-transform ${
            isExpanded ? "rotate-180" : ""
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
      <div className={`space-y-4 ${!isExpanded ? "hidden sm:block" : "mt-4"}`}>
        <DayFilter />
        <WorkoutTypeFilter workouts={workouts} />
        <div className="sm:hidden">
          <ClearFiltersButton />
        </div>
      </div>
    </div>
  );
}
