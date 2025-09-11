import axios from "axios";

import type { PlaceResult } from "@acme/shared/app/types";
import { MAX_PLACES_AUTOCOMPLETE_RADIUS } from "@acme/shared/app/constants";
import { zoomToRadius } from "@acme/shared/app/functions";

import { env } from "~/env";

export async function placesAutocomplete({
  input,
  center,
  zoom,
}: {
  input: string;
  center: { lat: number; lng: number };
  zoom: number;
}) {
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
    return axios
      .post<{ suggestions: PlaceResult[] }>(
        `https://places.googleapis.com/v1/places:autocomplete`,
        { input, locationBias },
        {
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": env.NEXT_PUBLIC_GOOGLE_API_KEY,
          },
        },
      )
      .then((response) => response.data.suggestions);
  } catch (error) {
    console.error("Error fetching places:", error);
    throw error;
  }
}
