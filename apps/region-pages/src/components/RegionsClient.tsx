'use client';

import { useState, useEffect } from 'react';
import SearchableRegionList from './SearchableRegionList';
import type { Region } from '@/types/Region';

interface RegionsClientProps {
  regions: (Omit<Region, 'id'> & { workoutCount: number })[];
  currentLetter: string;
  regionsByLetter: Record<
    string,
    (Omit<Region, 'id'> & { workoutCount: number })[]
  >;
}

export function RegionsClient({
  regions,
  currentLetter,
  regionsByLetter,
}: RegionsClientProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="w-full">
        <div className="relative mb-6">
          <input
            type="text"
            placeholder="Search regions..."
            className="w-full p-4 rounded-lg border border-gray-200 dark:border-gray-700 
              bg-white dark:bg-gray-800 
              text-gray-900 dark:text-gray-100
              focus:border-gray-300 dark:focus:border-gray-600 
              focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700 
              outline-none transition-all
              placeholder-gray-500 dark:placeholder-gray-400
              disabled:opacity-50"
            disabled
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 
                bg-white dark:bg-gray-800 animate-pulse"
            >
              <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <SearchableRegionList
      regions={regions}
      currentLetter={currentLetter}
      regionsByLetter={regionsByLetter}
    />
  );
}
