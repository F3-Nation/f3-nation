import type { Metadata } from "next";
import { Suspense } from "react";

import { RegionsClient } from "@/components/regions-client";
import { getRegions } from "@/lib/data";
import { toRegionSummary } from "@/types/region";

export const metadata: Metadata = {
  title: "All Regions",
  description: "Browse all F3 workout regions",
};

// Read the cached list per request so the image build needs no API access.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const regions = (await getRegions()).map(toRegionSummary);

  return (
    <div className="min-h-screen p-8 font-(family-name:--font-geist-sans)">
      <main className="mx-auto max-w-4xl">
        <h1 className="mb-8 text-3xl font-bold">Available Regions</h1>

        <div className="mb-6 rounded-lg border border-blue-200 bg-linear-to-r from-blue-50 to-indigo-50 p-4 dark:border-blue-800 dark:from-blue-900/20 dark:to-indigo-900/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <svg
                className="h-6 w-6 text-blue-600 dark:text-blue-400"
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
              <span className="font-medium text-blue-900 dark:text-blue-100">
                Looking for maps?
              </span>
            </div>
            <a
              href="https://map.f3nation.com"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Visit Maps →
            </a>
          </div>
        </div>

        <div className="mb-4 text-sm text-gray-500">
          Found {regions.length} regions
        </div>
        <Suspense fallback={<div>Loading regions...</div>}>
          <RegionsClient regions={regions} />
        </Suspense>
      </main>
    </div>
  );
}
