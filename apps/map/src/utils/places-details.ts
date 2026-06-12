import axios from "axios";

import type { PlaceDetails } from "@acme/shared/app/types";

import { getGoogleApiKey } from "./runtime-config";

// Cache for place details (placeId -> details)
const placeDetailsCache = new Map<
  string,
  { details: PlaceDetails; timestamp: number }
>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours (place details don't change often)

export async function placesDetails(placeId: string): Promise<PlaceDetails> {
  const googleApiKey = getGoogleApiKey();
  // Check cache first
  const cached = placeDetailsCache.get(placeId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.details;
  }

  try {
    const response = await axios.get<PlaceDetails>(
      `https://places.googleapis.com/v1/places/${placeId}`,
      {
        headers: {
          "X-Goog-Api-Key": googleApiKey,
        },
        params: {
          fields: "id,displayName,location",
        },
      },
    );

    const details = response.data;

    // Cache the result
    placeDetailsCache.set(placeId, {
      details,
      timestamp: Date.now(),
    });

    // Clean up old cache entries (keep only last 500)
    if (placeDetailsCache.size > 500) {
      const entries = Array.from(placeDetailsCache.entries());
      entries
        .sort((a, b) => b[1].timestamp - a[1].timestamp)
        .slice(500)
        .forEach(([key]) => placeDetailsCache.delete(key));
    }

    return details;
  } catch (error) {
    console.error("Error fetching place details:", error);
    // Return cached result on error if available
    if (cached) {
      return cached.details;
    }
    throw error;
  }
}
