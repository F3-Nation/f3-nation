'use client';

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  KeyboardEvent,
  useMemo,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ALL_LETTERS } from '@/lib/const';
import { Region } from '@/types/Region';
import { calculateHaversineDistance } from '@/utils/mapUtils';

interface Props {
  regions: (Omit<Region, 'id'> & { workoutCount: number })[];
  currentLetter: string;
  regionsByLetter: Record<
    string,
    (Omit<Region, 'id'> & { workoutCount: number })[]
  >;
}

interface UserLocation {
  latitude: number;
  longitude: number;
}

interface RegionWithDistance extends Omit<Region, 'id'> {
  distance: number;
}

export default function SearchableRegionList({
  regions = [],
  currentLetter = ALL_LETTERS[0] || 'A',
  regionsByLetter = {},
}: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [isGpsMode, setIsGpsMode] = useState(false);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Get user's location when GPS mode is activated
  const getUserLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by this browser.');
      return;
    }

    setIsGettingLocation(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setIsGettingLocation(false);
      },
      (error) => {
        let errorMessage = 'Unable to retrieve your location.';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage =
              'Location access denied. Please enable location services.';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = 'Location information is unavailable.';
            break;
          case error.TIMEOUT:
            errorMessage = 'Location request timed out.';
            break;
        }
        setLocationError(errorMessage);
        setIsGettingLocation(false);
        setIsGpsMode(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  }, []);

  // Toggle GPS mode
  const toggleGpsMode = useCallback(() => {
    if (isGpsMode) {
      setIsGpsMode(false);
      setUserLocation(null);
      setLocationError(null);
      setSearchQuery('');
    } else {
      setIsGpsMode(true);
      getUserLocation();
    }
  }, [isGpsMode, getUserLocation]);

  // Filter regions based on search query
  const filteredRegions = useMemo(() => {
    if (!searchQuery) return [];
    const query = searchQuery.toLowerCase();
    return regions.filter((region) => {
      // Search in name, city, state, zip, and country
      const searchableFields = [
        region.name,
        region.city,
        region.state,
        region.zip,
        region.country,
      ].filter(Boolean); // Remove undefined/null values

      return searchableFields.some((field) =>
        field?.toLowerCase().includes(query)
      );
    });
  }, [searchQuery, regions]);

  // Filter regions by proximity when in GPS mode
  const nearbyRegions = useMemo((): RegionWithDistance[] => {
    if (!isGpsMode || !userLocation) return [];

    const regionsWithCoords = regions.filter(
      (region) => region.latitude != null && region.longitude != null
    );

    const regionsWithDistance = regionsWithCoords
      .map((region) => ({
        ...region,
        distance: calculateHaversineDistance(
          userLocation.latitude,
          userLocation.longitude,
          region.latitude!,
          region.longitude!
        ),
      }))
      .filter((region) => region.distance <= 200) // Within 200 miles (increased from 100)
      .sort((a, b) => a.distance - b.distance); // Sort by proximity

    return regionsWithDistance;
  }, [isGpsMode, userLocation, regions]);

  // Determine which regions to display
  const displayRegions = useMemo(() => {
    if (isGpsMode) return nearbyRegions;
    if (searchQuery) return filteredRegions;
    return regionsByLetter[currentLetter];
  }, [
    isGpsMode,
    nearbyRegions,
    searchQuery,
    filteredRegions,
    regionsByLetter,
    currentLetter,
  ]);

  const handleLetterChange = useCallback(
    (letter: string) => {
      setSearchQuery('');
      setSelectedIndex(-1);
      router.push(`/?letter=${letter.toLowerCase()}`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [router]
  );

  useEffect(() => {
    if (filteredRegions.length === 1) setSelectedIndex(0);
  }, [filteredRegions]);

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
            const { slug } = filteredRegions[selectedIndex];
            if (slug) {
              setIsLoading(true);
              router.push(`/${slug}`);
            }
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
    (slug: string | null) => {
      if (slug) {
        setIsLoading(true);
        router.push(`/${slug}`);
      }
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
                if (!e.target.value) {
                  router.push(`/?letter=${currentLetter.toLowerCase()}`);
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search regions..."
              className="w-full p-4 pr-16 rounded-lg border border-gray-200 dark:border-gray-700 
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
              disabled={isLoading || isGpsMode}
            />

            {/* GPS Toggle Button */}
            <button
              onClick={toggleGpsMode}
              disabled={isGettingLocation}
              className={`absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-all
                ${
                  isGpsMode
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }
                ${
                  isGettingLocation
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:scale-105'
                }
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800`}
              title={
                isGpsMode ? 'Disable location search' : 'Find regions near me'
              }
              aria-label={
                isGpsMode ? 'Disable location search' : 'Find regions near me'
              }
            >
              {isGettingLocation ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
              ) : (
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
                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              )}
            </button>
          </div>

          {isLoading && !isGpsMode && (
            <div className="absolute right-12 top-1/2 -translate-y-1/2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-900 dark:border-gray-100" />
            </div>
          )}
        </div>

        {/* Location Error Message */}
        {locationError && (
          <div className="mt-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-red-700 dark:text-red-300 text-sm">
              {locationError}
            </p>
          </div>
        )}

        {/* GPS Mode Status */}
        {isGpsMode && userLocation && (
          <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-blue-700 dark:text-blue-300 text-sm">
              Showing regions within 200 miles of your location
              {nearbyRegions.length > 0 && ` (${nearbyRegions.length} found)`}
            </p>
          </div>
        )}

        {searchQuery && filteredRegions.length > 0 && !isGpsMode && (
          <div
            ref={listRef}
            id="search-suggestions"
            role="listbox"
            className="absolute top-full left-0 right-0 mt-1 
              bg-white dark:bg-gray-800 
              border border-gray-200 dark:border-gray-700 
              rounded-lg shadow-lg max-h-60 overflow-y-auto z-10"
          >
            {filteredRegions.map((region, index) => (
              <button
                key={`suggestion-${region.slug}`}
                id={`suggestion-${region.slug}`}
                role="option"
                aria-selected={index === selectedIndex}
                onClick={() => handleSuggestionClick(region.slug)}
                className={`w-full text-left px-4 py-2 
                  text-gray-900 dark:text-gray-100
                  hover:bg-gray-50 dark:hover:bg-gray-700 
                  focus:bg-gray-50 dark:focus:bg-gray-700 
                  focus:outline-none capitalize
                  ${
                    index === selectedIndex ? 'bg-gray-50 dark:bg-gray-700' : ''
                  }`}
              >
                <div>
                  <div className="font-medium">{region.name}</div>
                  {(region.city ||
                    region.state ||
                    region.zip ||
                    region.country) && (
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {[region.city, region.state, region.zip]
                        .filter(Boolean)
                        .join(', ')}
                      {region.country && (
                        <div className="mt-1">{region.country}</div>
                      )}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Show alphabetical navigation only when not in GPS mode and no search query */}
      {!searchQuery && !isGpsMode && (
        <nav className="mb-8" aria-label="Alphabetical navigation">
          <div className="flex flex-col items-center gap-2">
            {/* First row: A-G */}
            <div className="flex gap-2">
              {ALL_LETTERS.slice(0, 7).map((letter) => {
                const hasRegions = (regionsByLetter[letter]?.length || 0) > 0;
                return (
                  <button
                    key={letter}
                    onClick={() => handleLetterChange(letter)}
                    disabled={letter === currentLetter}
                    className={`w-10 h-10 flex items-center justify-center rounded-lg border
                      ${
                        letter === currentLetter
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                      }
                      ${!hasRegions ? 'opacity-50' : ''}
                      transition-colors`}
                  >
                    {letter}
                  </button>
                );
              })}
            </div>
            {/* Second row: H-N */}
            <div className="flex gap-2">
              {ALL_LETTERS.slice(7, 14).map((letter) => {
                const hasRegions = (regionsByLetter[letter]?.length || 0) > 0;
                return (
                  <button
                    key={letter}
                    onClick={() => handleLetterChange(letter)}
                    disabled={letter === currentLetter}
                    className={`w-10 h-10 flex items-center justify-center rounded-lg border
                      ${
                        letter === currentLetter
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                      }
                      ${!hasRegions ? 'opacity-50' : ''}
                      transition-colors`}
                  >
                    {letter}
                  </button>
                );
              })}
            </div>
            {/* Third row: O-U */}
            <div className="flex gap-2">
              {ALL_LETTERS.slice(14, 21).map((letter) => {
                const hasRegions = (regionsByLetter[letter]?.length || 0) > 0;
                return (
                  <button
                    key={letter}
                    onClick={() => handleLetterChange(letter)}
                    disabled={letter === currentLetter}
                    className={`w-10 h-10 flex items-center justify-center rounded-lg border
                      ${
                        letter === currentLetter
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                      }
                      ${!hasRegions ? 'opacity-50' : ''}
                      transition-colors`}
                  >
                    {letter}
                  </button>
                );
              })}
            </div>
            {/* Fourth row: V-Z */}
            <div className="flex gap-2">
              {ALL_LETTERS.slice(21).map((letter) => {
                const hasRegions = (regionsByLetter[letter]?.length || 0) > 0;
                return (
                  <button
                    key={letter}
                    onClick={() => handleLetterChange(letter)}
                    disabled={letter === currentLetter}
                    className={`w-10 h-10 flex items-center justify-center rounded-lg border
                      ${
                        letter === currentLetter
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                      }
                      ${!hasRegions ? 'opacity-50' : ''}
                      transition-colors`}
                  >
                    {letter}
                  </button>
                );
              })}
            </div>
          </div>
        </nav>
      )}

      <div className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        {isGpsMode
          ? nearbyRegions.length > 0
            ? `Found ${nearbyRegions.length} regions within 200 miles`
            : 'No regions found within 200 miles'
          : searchQuery
            ? `Found ${filteredRegions.length} matching regions`
            : regionsByLetter[currentLetter].length > 0
              ? `Showing ${regionsByLetter[currentLetter].length} regions starting with "${currentLetter}"`
              : `No regions found starting with "${currentLetter}"`}
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {displayRegions.map((region) => (
          <li key={region.slug}>
            <Link
              href={`/${region.slug}`}
              className="block p-4 rounded-lg 
                border border-gray-200 dark:border-gray-700 
                hover:border-gray-300 dark:hover:border-gray-600 
                bg-white dark:bg-gray-800
                text-gray-900 dark:text-gray-100
                transition-colors"
            >
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-lg capitalize">{region.name}</span>
                  {(region.city ||
                    region.state ||
                    region.zip ||
                    region.country) && (
                    <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      {[region.city, region.state, region.zip]
                        .filter(Boolean)
                        .join(', ')}
                      {region.country && (
                        <div className="mt-1">{region.country}</div>
                      )}
                    </div>
                  )}
                  {/* Show distance in GPS mode */}
                  {isGpsMode && 'distance' in region && (
                    <div className="text-sm text-blue-600 dark:text-blue-400 mt-1">
                      {(region as RegionWithDistance).distance.toFixed(1)} miles
                      away
                    </div>
                  )}
                </div>
                <span className="text-gray-500 dark:text-gray-400">→</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {filteredRegions.length === 0 && searchQuery && !isGpsMode && (
        <div className="text-center text-gray-500 dark:text-gray-400 py-8">
          No regions found matching &quot;{searchQuery}&quot;
        </div>
      )}

      {isGpsMode && nearbyRegions.length === 0 && !isGettingLocation && (
        <div className="text-center text-gray-500 dark:text-gray-400 py-8">
          <div className="mb-4">
            <p className="text-lg font-medium mb-2">
              No regions found within 200 miles
            </p>
            <p className="text-sm">
              F3 regions might not be available in your area yet. Try using the
              search or alphabetical filters to explore all available regions.
            </p>
          </div>
          <button
            onClick={() => setIsGpsMode(false)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Switch to Search Mode
          </button>
        </div>
      )}
    </div>
  );
}
