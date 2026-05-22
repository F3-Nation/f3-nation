'use client';

import { WorkoutWithRegion } from '@/types/Workout';
import { WorkoutNotes } from './WorkoutNotes';

interface WorkoutCardProps {
  workout: WorkoutWithRegion;
}

function getGoogleMapsUrl(workout: WorkoutWithRegion): string {
  const { latitude, longitude } = workout;
  if (latitude && longitude) {
    return `https://www.google.com/maps?q=${latitude},${longitude}`;
  }
  // Fallback to location search if coordinates not available
  return `https://www.google.com/maps/search/${encodeURIComponent(
    workout.location || ''
  )}`;
}

export function WorkoutCard({ workout }: WorkoutCardProps) {
  const mapsUrl = getGoogleMapsUrl(workout);
  const workoutTypes =
    (workout.types && workout.types.length > 0
      ? workout.types
      : workout.type
        ? [workout.type]
        : []) ?? [];

  return (
    <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <div className="flex justify-between items-start mb-2">
        <h3 className="text-lg font-semibold">{workout.name}</h3>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {workout.group}
        </span>
      </div>

      <div className="mb-3 text-sm text-gray-600 dark:text-gray-300">
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
            className="flex items-center gap-2 hover:text-blue-600 dark:hover:text-blue-400 transition-colors group"
          >
            <svg
              className="w-4 h-4 group-hover:text-blue-600 dark:group-hover:text-blue-400"
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
            <span className="hover:underline underline-offset-2">
              {workout.location}
            </span>
            <svg
              className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity"
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
        <div className="flex flex-wrap gap-2 mb-3">
          {workoutTypes.map((type) => (
            <span
              key={type}
              className="px-2 py-1 text-xs rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-100 flex items-center gap-1"
            >
              <svg
                className="w-3 h-3"
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
