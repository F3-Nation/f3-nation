import type { PlaceResult } from "@acme/shared/app/types";
import { MAX_PLACES_AUTOCOMPLETE_RADIUS } from "@acme/shared/app/constants";
import { zoomToRadius } from "@acme/shared/app/functions";

import { getGoogleApiKey } from "./runtime-config";

// Cache for autocomplete results (key: input+center+zoom, value: results)
const autocompleteCache = new Map<
  string,
  { results: PlaceResult[]; timestamp: number }
>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Debounce utility - single timer per debounce context
// Use a simple timer variable since we want to debounce ALL autocomplete calls
let autocompleteDebounceTimer: NodeJS.Timeout | null = null;
// 300ms is the industry standard for autocomplete - balances UX and API cost savings
const DEBOUNCE_DELAY = 300; // 300ms debounce

// Rate limiting: max requests per minute
// Set to 100 to allow ~1.67 req/sec while still preventing abuse
// With 300ms debounce + 5min cache, normal usage rarely exceeds 20-30/min
const RATE_LIMIT = 100; // Max 100 requests per minute
const requestTimestamps: number[] = [];

function checkRateLimit(): boolean {
  const now = Date.now();
  const oneMinuteAgo = now - 60 * 1000;

  // Remove old timestamps
  while (requestTimestamps.length > 0 && requestTimestamps[0]! < oneMinuteAgo) {
    requestTimestamps.shift();
  }

  if (requestTimestamps.length >= RATE_LIMIT) {
    console.warn("[Places Autocomplete] Rate limit exceeded. Please wait.");
    return false;
  }

  requestTimestamps.push(now);
  return true;
}

async function placesAutocomplete({
  input,
  center,
  zoom,
}: {
  input: string;
  center: { lat: number; lng: number };
  zoom: number;
}): Promise<PlaceResult[]> {
  // Check cache first
  const cacheKey = `${input.toLowerCase().trim()}_${center.lat}_${center.lng}_${zoom}`;
  const cached = autocompleteCache.get(cacheKey);

  const googleApiKey = getGoogleApiKey();
  if (!googleApiKey) {
    return cached?.results ?? [];
  }
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.results;
  }

  // Check rate limit
  if (!checkRateLimit()) {
    // Return cached result even if expired, or empty array
    return cached?.results ?? [];
  }

  const radius = zoomToRadius(zoom);
  const locationBias =
    radius >= MAX_PLACES_AUTOCOMPLETE_RADIUS
      ? // Search in US
        // ? { circle: { center: { latitude: 39.5, longitude: -98.3 }, radius: 500000, }, }
        undefined // use default ipbias
      : {
          circle: {
            center: { latitude: center.lat, longitude: center.lng },
            radius,
          },
        };

  try {
    const response = await fetch(
      `https://places.googleapis.com/v1/places:autocomplete`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": googleApiKey,
        },
        body: JSON.stringify({ input, locationBias }),
      },
    );

    if (!response.ok) {
      throw new Error(`Places Autocomplete API error: ${response.status}`);
    }

    const results = ((await response.json()) as { suggestions: PlaceResult[] })
      .suggestions;

    // Cache the results
    autocompleteCache.set(cacheKey, {
      results,
      timestamp: Date.now(),
    });

    // Clean up old cache entries (keep only last 100)
    if (autocompleteCache.size > 100) {
      const entries = Array.from(autocompleteCache.entries());
      entries
        .sort((a, b) => b[1].timestamp - a[1].timestamp)
        .slice(100)
        .forEach(([key]) => autocompleteCache.delete(key));
    }

    return results;
  } catch (error) {
    console.error("Error fetching places autocomplete:", error);
    // Return cached result on error if available
    return cached?.results ?? [];
  }
}

/**
 * Debounced version of placesAutocomplete
 * Use this in components to reduce API calls
 *
 * Properly debounces by canceling previous timer when called again
 * Returns a cleanup function to cancel pending requests
 */
export function debouncedPlacesAutocomplete(
  input: string,
  center: { lat: number; lng: number },
  zoom: number,
  callback: (results: PlaceResult[]) => void,
): () => void {
  // Clear existing timer if any (this is the key to proper debouncing)
  if (autocompleteDebounceTimer) {
    clearTimeout(autocompleteDebounceTimer);
  }

  // Set new timer - this will be canceled if function is called again before delay
  autocompleteDebounceTimer = setTimeout(() => {
    autocompleteDebounceTimer = null;
    void placesAutocomplete({ input, center, zoom }).then(callback);
  }, DEBOUNCE_DELAY);

  // Return cleanup function
  return () => {
    if (autocompleteDebounceTimer) {
      clearTimeout(autocompleteDebounceTimer);
      autocompleteDebounceTimer = null;
    }
  };
}
