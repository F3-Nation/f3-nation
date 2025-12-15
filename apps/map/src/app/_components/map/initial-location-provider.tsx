"use client";

import type { ReactNode } from "react";
import { createContext, Suspense, useContext, useRef } from "react";
import { useSearchParams } from "next/navigation";

import {
  CLOSE_ZOOM,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
} from "@acme/shared/app/constants";
import { safeParseFloat, safeParseInt } from "@acme/shared/common/functions";

import type { SparseF3Marker } from "~/utils/types";
import { getQueryData, orpc } from "~/orpc/react";
import { mapStore } from "~/utils/store/map";
import { setSelectedItem } from "~/utils/store/selected-item";

export type LocationMarkerWithDistance = SparseF3Marker & {
  distance: number | null;
};

const InitialLocationContext = createContext<{
  initialCenter: google.maps.LatLngLiteral;
  initialZoom: number;
}>({
  initialCenter: {
    lat: DEFAULT_CENTER[0],
    lng: DEFAULT_CENTER[1],
  },
  initialZoom: DEFAULT_ZOOM,
});

export const InitialLocationProvider = (params: { children: ReactNode }) => {
  return (
    <Suspense>
      <SuspendedInitialLocationProvider {...params} />
    </Suspense>
  );
};

const SuspendedInitialLocationProvider = (params: { children: ReactNode }) => {
  const searchParams = useSearchParams();
  const queryLat = safeParseFloat(searchParams?.get("lat"));
  const queryLon = safeParseFloat(
    searchParams?.get("lon") ?? searchParams?.get("lng"),
  );
  const queryZoom = safeParseFloat(searchParams?.get("zoom"));
  const queryLocationId = safeParseInt(searchParams?.get("locationId"));
  const queryEventId = safeParseInt(searchParams?.get("eventId"));

  const center = useRef<google.maps.LatLngLiteral | null>(null);
  const zoom = useRef<number | null>(null);
  const hasAttemptedSetInitialSelectedItem = useRef(false);

  if (center.current === null) {
    const locationLatLng = getQueryData(
      orpc.map.location.eventsAndLocations.queryKey({
        input: undefined,
      }),
    )?.find((location) => location[0] === queryLocationId);
    const locLat = locationLatLng?.[3];
    const locLon = locationLatLng?.[4];

    center.current =
      locLat != null && locLon != null
        ? { lat: locLat, lng: locLon }
        : queryLat != null && queryLon != null
          ? { lat: queryLat, lng: queryLon }
          : null;

    mapStore.setState({
      didSetQueryParamLocation: !!center.current,
    });
    center.current ??= mapStore.get("center") ?? {
      lat: DEFAULT_CENTER[0],
      lng: DEFAULT_CENTER[1],
    };

    mapStore.setState({
      nearbyLocationCenter: {
        ...center.current,
        name: "",
        type: "default",
      },
    });
  }

  if (zoom.current === null) {
    // If we have a query zoom, use that
    zoom.current = queryZoom
      ? queryZoom
      : // If we have a query location or lat/lon, use the close zoom
        !!queryLocationId || (queryLat != null && queryLon != null)
        ? CLOSE_ZOOM
        : // Otherwise, use the stored zoom or default zoom
          mapStore.get("zoom") ?? DEFAULT_ZOOM;
  }

  if (!hasAttemptedSetInitialSelectedItem.current) {
    hasAttemptedSetInitialSelectedItem.current = true;
    if (queryLocationId != null) {
      setSelectedItem({
        locationId: queryLocationId,
        eventId: queryEventId,
        showPanel: true,
      });
    }
  }

  return (
    <InitialLocationContext.Provider
      value={{
        initialCenter: center.current,
        initialZoom: zoom.current,
      }}
    >
      {params.children}
    </InitialLocationContext.Provider>
  );
};

export const useInitialLocation = () => {
  return useContext(InitialLocationContext);
};
