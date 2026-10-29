"use client";

import { useSearchParams, useRouter } from "next/navigation";

export function ClearFiltersButton() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasFilters = searchParams.has("day") || searchParams.has("type");

  if (!hasFilters) return null;

  const handleClearAll = () => {
    router.push(window.location.pathname);
  };

  return (
    <button
      onClick={handleClearAll}
      className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
    >
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
          d="M6 18L18 6M6 6l12 12"
        />
      </svg>
      Clear All Filters
    </button>
  );
}
