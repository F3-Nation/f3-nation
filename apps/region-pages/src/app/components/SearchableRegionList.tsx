'use client';

import { useState, useMemo, useCallback, useRef, KeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface SearchableRegionListProps {
  regionSlugs: string[];
}

export default function SearchableRegionList({
  regionSlugs,
}: SearchableRegionListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredRegions = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return regionSlugs.filter((slug) =>
      slug.replace(/-/g, ' ').toLowerCase().includes(query)
    );
  }, [regionSlugs, searchQuery]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!searchQuery) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < filteredRegions.length - 1 ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > -1 ? prev - 1 : prev));
          break;
        case 'Enter':
          e.preventDefault();
          if (selectedIndex >= 0 && selectedIndex < filteredRegions.length) {
            const selectedSlug = filteredRegions[selectedIndex];
            setIsLoading(true);
            router.push(`/${selectedSlug}`);
          }
          break;
        case 'Escape':
          e.preventDefault();
          setSearchQuery('');
          setSelectedIndex(-1);
          inputRef.current?.blur();
          break;
      }
    },
    [searchQuery, filteredRegions, selectedIndex, router]
  );

  const handleSuggestionClick = useCallback(
    (slug: string) => {
      setIsLoading(true);
      router.push(`/${slug}`);
    },
    [router]
  );

  return (
    <div className="w-full">
      <div className="relative mb-6">
        <div className="relative">
          <div
            role="combobox"
            aria-expanded={searchQuery.length > 0}
            aria-controls="search-suggestions"
            aria-haspopup="listbox"
          >
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedIndex(-1);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search regions..."
              className="w-full p-4 rounded-lg border border-gray-200 dark:border-gray-700 
                bg-white dark:bg-gray-800 
                text-gray-900 dark:text-gray-100
                focus:border-gray-300 dark:focus:border-gray-600 
                focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700 
                outline-none transition-all
                placeholder-gray-500 dark:placeholder-gray-400
                disabled:opacity-50"
              aria-label="Search regions"
              aria-activedescendant={
                selectedIndex >= 0
                  ? `suggestion-${filteredRegions[selectedIndex]}`
                  : undefined
              }
              aria-autocomplete="list"
              disabled={isLoading}
            />
            {isLoading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-900 dark:border-gray-100" />
              </div>
            )}
          </div>
        </div>

        {searchQuery && filteredRegions.length > 0 && (
          <div
            ref={listRef}
            id="search-suggestions"
            role="listbox"
            className="absolute top-full left-0 right-0 mt-1 
              bg-white dark:bg-gray-800 
              border border-gray-200 dark:border-gray-700 
              rounded-lg shadow-lg max-h-60 overflow-y-auto z-10"
          >
            {filteredRegions.map((slug, index) => (
              <button
                key={`suggestion-${slug}`}
                id={`suggestion-${slug}`}
                role="option"
                aria-selected={index === selectedIndex}
                onClick={() => handleSuggestionClick(slug)}
                className={`w-full text-left px-4 py-2 
                  text-gray-900 dark:text-gray-100
                  hover:bg-gray-50 dark:hover:bg-gray-700 
                  focus:bg-gray-50 dark:focus:bg-gray-700 
                  focus:outline-none capitalize
                  ${
                    index === selectedIndex ? 'bg-gray-50 dark:bg-gray-700' : ''
                  }`}
              >
                {slug.replace(/-/g, ' ')}
              </button>
            ))}
          </div>
        )}
      </div>

      <div aria-live="polite" className="sr-only">
        {filteredRegions.length === 0 && searchQuery
          ? `No regions found matching ${searchQuery}`
          : `${filteredRegions.length} regions found`}
      </div>

      <ul className="grid gap-4">
        {(filteredRegions.length > 0 ? filteredRegions : []).map((slug) => (
          <li key={slug}>
            <Link
              href={`/${slug}`}
              className="block p-4 rounded-lg 
                border border-gray-200 dark:border-gray-700 
                hover:border-gray-300 dark:hover:border-gray-600 
                bg-white dark:bg-gray-800
                text-gray-900 dark:text-gray-100
                transition-colors"
            >
              <span className="text-lg capitalize">
                {slug.replace(/-/g, ' ')}
              </span>
              <span className="ml-2 text-gray-500 dark:text-gray-400">→</span>
            </Link>
          </li>
        ))}
        {filteredRegions.length === 0 && searchQuery && (
          <li className="text-center text-gray-500 dark:text-gray-400 py-8">
            No regions found matching &quot;{searchQuery}&quot;
          </li>
        )}
      </ul>
    </div>
  );
}
