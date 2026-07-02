"use client";

import type { ReactNode } from "react";
import { createContext, Suspense, useContext, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";

import {
  CLOSE_ZOOM,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
} from "@acme/shared/app/constants";
import { safeParseFloat, safeParseInt } from "@acme/shared/common/functions";

import { getQueryData, orpc } from "~/orpc/react";
import { mapStore } from "~/utils/store/map";
import { setSelectedItem } from "~/utils/store/selected-item";

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
  const didSetQueryParamLocation = useRef(false);
  const hasSyncedInitialMapState = useRef(false);

  // Calculate initial values during render (reading is safe)
  if (center.current === null) {
    const locationLatLng = getQueryData(
      orpc.map.location.eventsAndLocations.queryKey({
        input: undefined,
      }),
    )?.find((location) => location[0] === queryLocationId);
    const locLat = locationLatLng?.[3];
    const locLon = locationLatLng?.[4];

    const queryParamCenter =
      locLat != null && locLon != null
        ? { lat: locLat, lng: locLon }
        : queryLat != null && queryLon != null
          ? { lat: queryLat, lng: queryLon }
          : null;

    didSetQueryParamLocation.current = !!queryParamCenter;
    center.current = queryParamCenter ??
      mapStore.get("center") ?? {
        lat: DEFAULT_CENTER[0],
        lng: DEFAULT_CENTER[1],
      };
  }

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  zoom.current ??= queryZoom
    ? queryZoom
    : // If we have a query location or lat/lon, use the close zoom
      !!queryLocationId || (queryLat != null && queryLon != null)
      ? CLOSE_ZOOM
      : // Otherwise, use the stored zoom or default zoom
        (mapStore.get("zoom") ?? DEFAULT_ZOOM);

  // Sync the derived initial state into the external stores in an effect.
  // Writing to these stores during render updates other subscribed components
  // (e.g. the ancestor UserLocationProvider) mid-render, which React flags.
  useEffect(() => {
    if (hasSyncedInitialMapState.current) return;
    hasSyncedInitialMapState.current = true;

    mapStore.setState({
      didSetQueryParamLocation: didSetQueryParamLocation.current,
      nearbyLocationCenter: center.current
        ? { ...center.current, name: "", type: "default" }
        : null,
    });

    if (queryLocationId != null) {
      setSelectedItem({
        locationId: queryLocationId,
        eventId: queryEventId,
        showPanel: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
