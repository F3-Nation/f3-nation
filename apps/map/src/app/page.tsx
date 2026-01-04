import { Suspense } from "react";

import { RERENDER_LOGS } from "@acme/shared/common/constants";

import { MapPageWrapper } from "~/app/_components/map-page-wrapper";
import { FilteredMapResultsProvider } from "~/app/_components/map/filtered-map-results-provider";
import { GoogleMapComponent } from "~/app/_components/map/google-map";
import { InitialLocationProvider } from "~/app/_components/map/initial-location-provider";
import { ReactQueryHydrator } from "~/app/_components/map/react-query-hydrator";
import { TextSearchResultsProvider } from "~/app/_components/map/search-results-provider";
import type { RouterOutputs } from "~/orpc/types";
import { SecondaryEffectsProvider } from "~/utils/secondary-effects-provider";
import { TouchDeviceProvider } from "~/utils/touch-device-provider";

const shouldSkipSsg =
  // process.env.CI === "true" || // Needed to turn this off so that docker builds do SSG for inital location loads
  process.env.SKIP_SSG === "1" || process.env.NEXT_PUBLIC_CHANNEL === "ci";

export default async function MapPage() {
  interface MapPageData {
    eventsAndLocations: RouterOutputs["map"]["location"]["eventsAndLocations"];
    regionsWithLocation: RouterOutputs["map"]["location"]["regionsWithLocation"];
  }

  const { eventsAndLocations, regionsWithLocation }: MapPageData = shouldSkipSsg
    ? {
        eventsAndLocations: [],
        regionsWithLocation: { regionsWithLocation: [] },
      }
    : await (async () => {
        const { client } = await import("~/orpc/client");

        const eventsAndLocations =
          await client.map.location.eventsAndLocations();
        const regionsWithLocation =
          await client.map.location.regionsWithLocation();

        return { eventsAndLocations, regionsWithLocation };
      })();

  RERENDER_LOGS && console.log("MapPage rerender");

  return (
    <ReactQueryHydrator
      eventsAndLocations={eventsAndLocations}
      regionsWithLocation={regionsWithLocation}
    >
      <TouchDeviceProvider>
        <InitialLocationProvider>
          <FilteredMapResultsProvider>
            {/* Textsearch results provider must be inside FilteredMapResultsProvider */}
            <TextSearchResultsProvider>
              <MapPageWrapper>
                <main className="pointer-events-auto relative h-dvh w-full">
                  {/* Must have relative so that absolute things show up on the map */}
                  <Suspense>
                    <SecondaryEffectsProvider />
                    <GoogleMapComponent />
                  </Suspense>
                </main>
              </MapPageWrapper>
            </TextSearchResultsProvider>
          </FilteredMapResultsProvider>
        </InitialLocationProvider>
      </TouchDeviceProvider>
    </ReactQueryHydrator>
  );
}
