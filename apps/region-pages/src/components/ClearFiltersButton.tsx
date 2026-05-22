'use client';

import { useSearchParams, useRouter } from 'next/navigation';

export function ClearFiltersButton() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasFilters = searchParams.has('day') || searchParams.has('type');

  if (!hasFilters) return null;

  const handleClearAll = () => {
    router.push(window.location.pathname);
  };

  return (
    <button
      onClick={handleClearAll}
      className="w-full mt-4 px-4 py-2.5 rounded-lg text-sm font-medium 
                bg-red-50 text-red-600 hover:bg-red-100 
                dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30 
                transition-colors flex items-center justify-center gap-2"
    >
      <svg
        className="w-4 h-4"
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
