"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { Workout } from "@/types/region";

const DAYS_OF_WEEK = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

interface DayFilterProps {
  workouts: Workout[];
  onFilteredWorkouts: (workouts: Workout[]) => void;
}

export function DayFilter({ workouts, onFilteredWorkouts }: DayFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedDay, setSelectedDay] = useState<string | null>(
    searchParams.get("day")?.toLowerCase() ?? null,
  );

  // Apply filter based on URL param on mount and when URL changes
  useEffect(() => {
    const dayParam = searchParams.get("day")?.toLowerCase() ?? null;
    setSelectedDay(dayParam);

    if (dayParam) {
      const filtered = workouts.filter(
        (workout) => workout.group.toLowerCase() === dayParam,
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
      params.set("day", newDay);
    } else {
      params.delete("day");
    }
    router.push(`?${params.toString()}`);
  };

  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
        Filter by Day
      </h3>

      {/* Mobile: Select Dropdown */}
      <div className="sm:hidden">
        <select
          value={selectedDay ?? ""}
          onChange={handleSelectChange}
          className="w-full rounded-lg border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:focus:ring-blue-400"
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
      <div className="hidden gap-2 sm:flex sm:flex-wrap">
        {DAYS_OF_WEEK.map((day) => {
          const isSelected = selectedDay === day.toLowerCase();
          return (
            <button
              key={day}
              onClick={() => handleDayClick(day)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
                isSelected
                  ? "bg-blue-600 text-white shadow-lg ring-2 ring-blue-600 ring-offset-2 dark:ring-offset-gray-800"
                  : "bg-gray-50 text-gray-700 hover:bg-gray-100 hover:shadow-xs dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
              } `}
            >
              {day}
            </button>
          );
        })}
        {selectedDay && (
          <button
            onClick={() =>
              handleDayClick(
                DAYS_OF_WEEK.find((d) => d.toLowerCase() === selectedDay) ??
                  "Monday",
              )
            }
            className="rounded-lg px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-800 dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300"
          >
            Clear Filter
          </button>
        )}
      </div>
    </div>
  );
}
