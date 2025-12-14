"use client";

import type { ComponentProps } from "react";
import { Suspense } from "react";
import { ControlPosition, MapControl } from "@vis.gl/react-google-maps";

import { Z_INDEX } from "@acme/shared/app/constants";

import { useIsMobileWidth } from "~/utils/hooks/use-is-mobile-width";
import { mapStore } from "~/utils/store/map";
import { DebugInfo } from "./map/debug-info";
import { DesktopFilterButtons } from "./map/desktop-filter-buttons";
import { DesktopLocationPanelContent } from "./map/desktop-location-panel-content";
import DesktopSelectedItem from "./map/desktop-selected-item";
import { GeoJsonPane } from "./map/geo-json-pane";
import { GeolocationMarker } from "./map/geolocation-marker";
import { HelpButton } from "./map/help-button";
import { InfoButton } from "./map/info-button";
import { LayoutEditButton } from "./map/layout-edit-button";
import { MapProvider } from "./map/map-provider";
import { MapSearchBoxMobile } from "./map/map-searchbox-mobile";
import { MobileAllFilters } from "./map/mobile-all-filters";
import { MobileFilterButtons } from "./map/mobile-filter-buttons";
import { MobileSearchResultsAndNearbyLocations } from "./map/mobile-search-results-and-nearby-locations";
import { MobileSelectedItem } from "./map/mobile-selected-item";
import { NearbyLocationUpdateButton } from "./map/nearby-location-update-button";
import { Projection } from "./map/projection";
import { SettingsButton } from "./map/settings-button";
import { StagingWatermark } from "./map/staging-watermark";
import { UserLocationIcon } from "./map/user-location-icon";

const SHOW_DEBUG = false;
export const MapLayoutItems = () => {
  console.log("MapLayoutItems rerender");
  const { isDesktopWidth, isMobileWidth } = useIsMobileWidth();
  const showDebugStore = mapStore.use.showDebug();

  const showDebug =
    showDebugStore || (process.env.NODE_ENV === "development" && SHOW_DEBUG)
      ? true
      : false;

  return (
    <Suspense>
      <GeoJsonPane />
      <Projection />
      <MapProvider />
      <GeolocationMarker />
      <DesktopLocationPanelContainer>
        <DesktopLocationPanelContent />
      </DesktopLocationPanelContainer>
      <DesktopSelectedItem />

      <MapControl
        position={isMobileWidth ? ControlPosition.TOP : ControlPosition.BOTTOM}
      >
        <StagingWatermark />
      </MapControl>
      {isDesktopWidth ? (
        <>
          <MapControl position={ControlPosition.RIGHT_BOTTOM}>
            <SettingsButton className="-mb-[6px]" />
          </MapControl>
          <MapControl position={ControlPosition.RIGHT_BOTTOM}>
            <UserLocationIcon className="mb-1" />
          </MapControl>
          <MapControl position={ControlPosition.RIGHT_BOTTOM}>
            <InfoButton className="mb-1" />
          </MapControl>
          <MapControl position={ControlPosition.RIGHT_BOTTOM}>
            <LayoutEditButton className="mb-1" />
          </MapControl>
          <MapControl position={ControlPosition.TOP_LEFT}>
            <DesktopFilterButtons />
          </MapControl>
          <MapControl position={ControlPosition.TOP_LEFT}>
            <HelpButton />
          </MapControl>
        </>
      ) : (
        <>
          <MapControl position={ControlPosition.RIGHT_TOP}>
            <SettingsButton className="-mt-[6px] mr-[10px]" />
          </MapControl>
          <MapControl position={ControlPosition.RIGHT_TOP}>
            <UserLocationIcon className="mr-[10px] mt-1" />
          </MapControl>
          <MapControl position={ControlPosition.RIGHT_TOP}>
            <InfoButton className="mr-[10px] mt-1" />
          </MapControl>
          <MapControl position={ControlPosition.RIGHT_TOP}>
            <LayoutEditButton className="mr-[10px] mt-1" />
          </MapControl>
        </>
      )}
      <NearbyLocationUpdateButton />

      <MobileAboveSearchBox>
        <div className="mb-[0px] flex flex-row items-center justify-start gap-2 overflow-auto px-2">
          <HelpButton />
          <MobileFilterButtons />
        </div>
        <MobileSelectedItem />
      </MobileAboveSearchBox>
      <MobileAllFilters />
      <MobileSearchResultsAndNearbyLocations />
      <MapSearchBoxMobile />
      {showDebug ? <DebugInfo /> : null}
    </Suspense>
  );
};

const DesktopLocationPanelContainer = (props: ComponentProps<"div">) => (
  <div
    style={{ zIndex: Z_INDEX.LOCATION_PANEL }}
    // max-w-md must match to MAX_DESKTOP_WORKOUT_PANEL_WIDTH
    className="scrollbar-hide pointer-events-none absolute bottom-0 left-2 top-0 hidden w-1/2 max-w-md overflow-y-auto pb-2 pt-12 lg:block"
    {...props}
  />
);

const MobileAboveSearchBox = (props: ComponentProps<"div">) => (
  <div
    style={{ zIndex: Z_INDEX.OVERLAY_BUTTONS }}
    // 46px and 6px to keep the slider in the middle between them
    className="absolute bottom-[44px] left-0 right-0 block lg:hidden"
    {...props}
  />
);
