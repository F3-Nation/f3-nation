import axios from "axios";

import type { PlaceDetails } from "@acme/shared/app/types";

import { env } from "~/env";

export async function placesDetails(placeId: string) {
  try {
    return axios
      .get<PlaceDetails>(`https://places.googleapis.com/v1/places/${placeId}`, {
        headers: {
          "X-Goog-Api-Key": env.NEXT_PUBLIC_GOOGLE_API_KEY,
        },
        params: {
          fields: "id,displayName,location",
        },
      })
      .then((response) => response.data);
  } catch (error) {
    console.error("Error fetching places:", error);
    throw error;
  }
}
