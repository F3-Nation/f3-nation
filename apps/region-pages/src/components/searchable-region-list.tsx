"use client";

import type { KeyboardEvent } from "react";
import { useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ALL_LETTERS } from "@/lib/letters";
import type { RegionSummary } from "@/types/region";
import { calculateHaversineDistance } from "@/lib/map-utils";

interface Props {
  regions: RegionSummary[];
  currentLetter: string;
  regionsByLetter: Record<string, RegionSummary[]>;
}

const KM_TO_MILES = 0.621371;

// A–G, H–N, O–U, V–Z: four centered rows of seven (the last has five).
const LETTER_ROWS = [0, 7, 14, 21].map((start) =>
  ALL_LETTERS.slice(start, start + 7),
);

interface UserLocation {
  latitude: number;
  longitude: number;
}

interface RegionWithDistance extends RegionSummary {
  distance: number;
}

export default function SearchableRegionList({
  regions = [],
  currentLetter = "A",
  regionsByLetter = {},
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
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
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- absent in some browsers/webviews despite the DOM typings
    if (!navigator.geolocation) {
      setLocationError("Geolocation is not supported by this browser.");
      setIsGpsMode(false);
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
        let errorMessage = "Unable to retrieve your location.";
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage =
              "Location access denied. Please enable location services.";
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = "Location information is unavailable.";
            break;
          case error.TIMEOUT:
            errorMessage = "Location request timed out.";
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
      },
    );
  }, []);

  // Toggle GPS mode
  const toggleGpsMode = useCallback(() => {
    if (isGpsMode) {
      setIsGpsMode(false);
      setUserLocation(null);
      setLocationError(null);
      setSearchQuery("");
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
        field?.toLowerCase().includes(query),
      );
    });
  }, [searchQuery, regions]);

  // Filter regions by proximity when in GPS mode
  const nearbyRegions = useMemo((): RegionWithDistance[] => {
    if (!isGpsMode || !userLocation) return [];

    // Regions with no mapped workout have no location (null), so they can't
    // appear "near" anyone.
    const regionsWithCoords = regions.filter(
      (
        region,
      ): region is RegionSummary & { latitude: number; longitude: number } =>
        region.latitude != null && region.longitude != null,
    );

    const regionsWithDistance = regionsWithCoords
      .map((region) => ({
        ...region,
        // calculateHaversineDistance returns km; the UI speaks miles.
        distance:
          calculateHaversineDistance(
            userLocation.latitude,
            userLocation.longitude,
            region.latitude,
            region.longitude,
          ) * KM_TO_MILES,
      }))
      .filter((region) => region.distance <= 200)
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
      setSearchQuery("");
      setSelectedIndex(-1);
      // On this force-dynamic page, Next re-renders on the server for any URL
      // change (native history calls included), so a letter click costs one
      // server render. The letter stays in the query string so links share.
      router.push(`/?letter=${letter.toLowerCase()}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [router],
  );

  // A single match is highlighted without the user arrowing to it. Derived
  // during render rather than synced by an effect.
  const activeIndex =
    selectedIndex === -1 && filteredRegions.length === 1 ? 0 : selectedIndex;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!searchQuery) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex(
            activeIndex < filteredRegions.length - 1
              ? activeIndex + 1
              : activeIndex,
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex(activeIndex > -1 ? activeIndex - 1 : activeIndex);
          break;
        case "Enter":
          e.preventDefault();
          if (activeIndex >= 0 && activeIndex < filteredRegions.length) {
            const slug = filteredRegions[activeIndex]?.slug;
            if (slug) {
              setIsLoading(true);
              router.push(`/${slug}`);
            }
          }
          break;
        case "Escape":
          e.preventDefault();
          setSearchQuery("");
          setSelectedIndex(-1);
          inputRef.current?.blur();
          break;
      }
    },
    [searchQuery, filteredRegions, activeIndex, router],
  );

  const handleSuggestionClick = useCallback(
    (slug: string | null) => {
      if (slug) {
        setIsLoading(true);
        router.push(`/${slug}`);
      }
    },
    [router],
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
                  // replace, not push: clearing the box shouldn't add a
                  // back-button entry each time.
                  window.history.replaceState(
                    null,
                    "",
                    `/?letter=${currentLetter.toLowerCase()}`,
                  );
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search regions..."
              className="w-full rounded-lg border border-gray-200 bg-white p-4 pr-16 text-gray-900 placeholder-gray-500 outline-hidden transition-all focus:border-gray-300 focus:ring-2 focus:ring-gray-200 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400 dark:focus:border-gray-600 dark:focus:ring-gray-700"
              aria-label="Search regions"
              aria-activedescendant={
                activeIndex >= 0
                  ? `suggestion-${filteredRegions[activeIndex]?.slug ?? ""}`
                  : undefined
              }
              aria-autocomplete="list"
              disabled={isLoading || isGpsMode}
            />

            {/* GPS Toggle Button */}
            <button
              onClick={toggleGpsMode}
              disabled={isGettingLocation}
              className={`absolute top-1/2 right-3 -translate-y-1/2 rounded-lg p-2 transition-all ${
                isGpsMode
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              } ${
                isGettingLocation
                  ? "cursor-not-allowed opacity-50"
                  : "hover:scale-105"
              } focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-hidden dark:focus:ring-offset-gray-800`}
              title={
                isGpsMode ? "Disable location search" : "Find regions near me"
              }
              aria-label={
                isGpsMode ? "Disable location search" : "Find regions near me"
              }
            >
              {isGettingLocation ? (
                <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-current" />
              ) : (
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
            <div className="absolute top-1/2 right-12 -translate-y-1/2">
              <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-gray-900 dark:border-gray-100" />
            </div>
          )}
        </div>

        {/* Location Error Message */}
        {locationError && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm text-red-700 dark:text-red-300">
              {locationError}
            </p>
          </div>
        )}

        {/* GPS Mode Status */}
        {isGpsMode && userLocation && (
          <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
            <p className="text-sm text-blue-700 dark:text-blue-300">
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
            className="absolute top-full right-0 left-0 z-10 mt-1 max-h-60 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
          >
            {filteredRegions.map((region, index) => (
              <button
                key={`suggestion-${region.slug}`}
                id={`suggestion-${region.slug}`}
                role="option"
                aria-selected={index === activeIndex}
                onClick={() => handleSuggestionClick(region.slug)}
                className={`w-full px-4 py-2 text-left text-gray-900 capitalize hover:bg-gray-50 focus:bg-gray-50 focus:outline-hidden dark:text-gray-100 dark:hover:bg-gray-700 dark:focus:bg-gray-700 ${
                  index === activeIndex ? "bg-gray-50 dark:bg-gray-700" : ""
                }`}
              >
                <div>
                  <div className="font-medium">{region.name}</div>
                  {[region.city, region.state, region.zip, region.country].some(
                    Boolean,
                  ) && (
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {[region.city, region.state, region.zip]
                        .filter(Boolean)
                        .join(", ")}
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
            {LETTER_ROWS.map((row) => (
              <div key={row.join("")} className="flex gap-2">
                {row.map((letter) => {
                  const hasRegions = (regionsByLetter[letter]?.length ?? 0) > 0;
                  return (
                    <button
                      key={letter}
                      onClick={() => handleLetterChange(letter)}
                      disabled={letter === currentLetter}
                      aria-current={
                        letter === currentLetter ? "page" : undefined
                      }
                      className={`flex h-10 w-10 items-center justify-center rounded-lg border ${
                        letter === currentLetter
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-gray-200 bg-white text-gray-900 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-gray-600"
                      } ${!hasRegions ? "opacity-50" : ""} transition-colors`}
                    >
                      {letter}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </nav>
      )}

      <div className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        {isGpsMode
          ? nearbyRegions.length > 0
            ? `Found ${nearbyRegions.length} regions within 200 miles`
            : "No regions found within 200 miles"
          : searchQuery
            ? `Found ${filteredRegions.length} matching regions`
            : (regionsByLetter[currentLetter]?.length ?? 0) > 0
              ? `Showing ${regionsByLetter[currentLetter]?.length ?? 0} regions starting with "${currentLetter}"`
              : `No regions found starting with "${currentLetter}"`}
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(displayRegions ?? []).map((region) => (
          <li key={region.slug}>
            <Link
              href={`/${region.slug}`}
              className="block rounded-lg border border-gray-200 bg-white p-4 text-gray-900 transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-gray-600"
            >
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-lg capitalize">{region.name}</span>
                  {[region.city, region.state, region.zip, region.country].some(
                    Boolean,
                  ) && (
                    <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {[region.city, region.state, region.zip]
                        .filter(Boolean)
                        .join(", ")}
                      {region.country && (
                        <div className="mt-1">{region.country}</div>
                      )}
                    </div>
                  )}
                  {/* Show distance in GPS mode */}
                  {isGpsMode && "distance" in region && (
                    <div className="mt-1 text-sm text-blue-600 dark:text-blue-400">
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
        <div className="py-8 text-center text-gray-500 dark:text-gray-400">
          No regions found matching &quot;{searchQuery}&quot;
        </div>
      )}

      {isGpsMode && nearbyRegions.length === 0 && !isGettingLocation && (
        <div className="py-8 text-center text-gray-500 dark:text-gray-400">
          <div className="mb-4">
            <p className="mb-2 text-lg font-medium">
              No regions found within 200 miles
            </p>
            <p className="text-sm">
              F3 regions might not be available in your area yet. Try using the
              search or alphabetical filters to explore all available regions.
            </p>
          </div>
          <button
            onClick={() => setIsGpsMode(false)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700"
          >
            Switch to Search Mode
          </button>
        </div>
      )}
    </div>
  );
}
