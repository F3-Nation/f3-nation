"use client";

import type { ComponentProps } from "react";
import { Suspense } from "react";
import { ControlPosition, MapControl } from "@vis.gl/react-google-maps";

import { Z_INDEX } from "@acme/shared/app/constants";

import { useIsMobileWidth } from "~/utils/hooks/use-is-mobile-width";
import { mapStore } from "~/utils/store/map";
import { DebugInfo } from "./map/debug-info";
import DesktopSelectedItem from "./map/desktop-selected-item";
import { GeoJsonPane } from "./map/geo-json-pane";
import { GeolocationMarker } from "./map/geolocation-marker";
import { HelpButton } from "./map/help-button";
import { InfoButton } from "./map/info-button";
import { LayoutEditButton } from "./map/layout-edit-button";
import { MapProvider } from "./map/map-provider";
import { MapSearchBoxMobile } from "./map/map-searchbox-mobile";
import { MobileAllFilters } from "./map/mobile-all-filters";
import { FiltersButton } from "./map/filters-button";
import { MobileSearchResultsAndNearbyLocations } from "./map/mobile-search-results-and-nearby-locations";
import { MobileSelectedItem } from "./map/mobile-selected-item";
import { NearbyLocationUpdateButton } from "./map/nearby-location-update-button";
import { Projection } from "./map/projection";
import { ScheduleChangesNotice } from "./map/schedule-changes-notice";
import { SettingsButton } from "./map/settings-button";
import { StagingWatermark } from "./map/staging-watermark";
import { UserLocationIcon } from "./map/user-location-icon";

const SHOW_DEBUG = false as boolean;
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
      <DesktopSelectedItem />

      <MapControl
        position={isMobileWidth ? ControlPosition.TOP : ControlPosition.BOTTOM}
      >
        <StagingWatermark />
      </MapControl>
      <MapControl
        position={isMobileWidth ? ControlPosition.TOP : ControlPosition.BOTTOM}
      >
        <ScheduleChangesNotice />
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
          <MapControl position={ControlPosition.TOP_RIGHT}>
            <HelpButton />
          </MapControl>
        </>
      ) : (
        <>
          <MapControl position={ControlPosition.RIGHT_TOP}>
            <SettingsButton className="-mt-[6px] mr-[10px]" />
          </MapControl>
          <MapControl position={ControlPosition.RIGHT_TOP}>
            <UserLocationIcon className="mt-1 mr-[10px]" />
          </MapControl>
          <MapControl position={ControlPosition.RIGHT_TOP}>
            <InfoButton className="mt-1 mr-[10px]" />
          </MapControl>
          <MapControl position={ControlPosition.RIGHT_TOP}>
            <LayoutEditButton className="mt-1 mr-[10px]" />
          </MapControl>
        </>
      )}
      <NearbyLocationUpdateButton />

      <MobileAboveSearchBox>
        <div className="flex flex-row items-center justify-start gap-2 px-2">
          <FiltersButton />
          <HelpButton className="m-0" />
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

const MobileAboveSearchBox = (props: ComponentProps<"div">) => (
  <div
    style={{ zIndex: Z_INDEX.OVERLAY_BUTTONS }}
    // 46px and 6px to keep the slider in the middle between them
    className="absolute right-0 bottom-[44px] left-0 block md:hidden"
    {...props}
  />
);
