"use client";

import type { Workout } from "@/types/region";
import { WorkoutNotes } from "@/components/workout-notes";

interface WorkoutCardProps {
  workout: Workout;
}

function getGoogleMapsUrl(workout: Workout): string {
  const { latitude, longitude } = workout;
  if (latitude && longitude) {
    return `https://www.google.com/maps?q=${latitude},${longitude}`;
  }
  // Fallback to location search if coordinates not available
  return `https://www.google.com/maps/search/${encodeURIComponent(
    workout.location || "",
  )}`;
}

export function WorkoutCard({ workout }: WorkoutCardProps) {
  const mapsUrl = getGoogleMapsUrl(workout);
  const workoutTypes =
    workout.types.length > 0 ? workout.types : [workout.type];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-2 flex items-start justify-between">
        <h3 className="text-lg font-semibold">{workout.name}</h3>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {workout.group}
        </span>
      </div>

      <div className="mb-3 text-sm text-gray-600 dark:text-gray-300">
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
              strokeWidth="2"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          {workout.time}
        </div>
        {workout.location && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2 transition-colors hover:text-blue-600 dark:hover:text-blue-400"
          >
            <svg
              className="h-4 w-4 group-hover:text-blue-600 dark:group-hover:text-blue-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <span className="underline-offset-2 hover:underline">
              {workout.location}
            </span>
            <svg
              className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
        )}
      </div>

      {workoutTypes.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {workoutTypes.map((type) => (
            <span
              key={type}
              className="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-800 dark:bg-blue-900 dark:text-blue-100"
            >
              <svg
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              {type}
            </span>
          ))}
        </div>
      )}

      <WorkoutNotes notes={workout.notes ?? null} />
    </div>
  );
}
