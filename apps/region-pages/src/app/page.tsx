import {
  fetchRegionsWithWorkoutCounts,
  // fetchRegions,
  // fetchRegionsByLetter,
} from '@/utils/fetchWorkoutLocations';
import { RegionsClient } from '@/components/RegionsClient';
import { Metadata } from 'next';
import { Suspense } from 'react';
import { ALL_LETTERS } from '@/lib/const';

export const metadata: Metadata = {
  title: 'All Regions',
  description: 'Browse all F3 workout regions',
};

interface RegionsPageProps {
  searchParams: Promise<{ letter?: string }>;
}

export default async function HomePage({ searchParams }: RegionsPageProps) {
  const [regions, regionsByLetter, resolvedParams] = await Promise.all([
    fetchRegionsWithWorkoutCounts(),
    (async () => {
      const all = await fetchRegionsWithWorkoutCounts();
      // Group by first letter
      return ALL_LETTERS.reduce(
        (acc, letter) => {
          acc[letter] = all.filter((r) =>
            (r.name || '').toUpperCase().startsWith(letter)
          );
          return acc;
        },
        {} as Record<string, typeof all>
      );
    })(),
    searchParams,
  ]);

  // Get current letter from URL or default to first available letter with regions
  const defaultLetter = ALL_LETTERS[0] || 'A';
  const requestedLetter =
    resolvedParams?.letter?.toUpperCase() || defaultLetter;
  const currentLetter = ALL_LETTERS.includes(requestedLetter)
    ? requestedLetter
    : defaultLetter;

  return (
    <div className="min-h-screen p-8 font-[family-name:var(--font-geist-sans)]">
      <main className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Available Regions</h1>

        {/* Banner Ad */}
        <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <svg
                className="w-6 h-6 text-blue-600 dark:text-blue-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-1.447-.894L15 4m0 13V4m-6 3l6-3"
                />
              </svg>
              <span className="text-blue-900 dark:text-blue-100 font-medium">
                Looking for maps?
              </span>
            </div>
            <a
              href="https://map.f3nation.com"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
            >
              Visit Maps →
            </a>
          </div>
        </div>

        <div className="mb-4 text-sm text-gray-500">
          Found {regions.length} regions
        </div>
        <Suspense fallback={<div>Loading regions...</div>}>
          <RegionsClient
            regions={regions}
            currentLetter={currentLetter}
            regionsByLetter={regionsByLetter}
          />
        </Suspense>
      </main>
    </div>
  );
}
