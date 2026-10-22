"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import SearchableRegionList from "@/components/searchable-region-list";
import { resolveLetter } from "@/lib/letters";
import type { Region } from "@/types/region";

interface RegionsClientProps {
  regions: Region[];
  regionsByLetter: Record<string, Region[]>;
}

export function RegionsClient({
  regions,
  regionsByLetter,
}: RegionsClientProps) {
  const [mounted, setMounted] = useState(false);
  const currentLetter = resolveLetter(useSearchParams().get("letter"));

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
            className="w-full rounded-lg border border-gray-200 bg-white p-4 text-gray-900 placeholder-gray-500 outline-hidden transition-all focus:border-gray-300 focus:ring-2 focus:ring-gray-200 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400 dark:focus:border-gray-600 dark:focus:ring-gray-700"
            disabled
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="mb-2 h-6 rounded-sm bg-gray-200 dark:bg-gray-700"></div>
              <div className="h-4 w-3/4 rounded-sm bg-gray-200 dark:bg-gray-700"></div>
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
