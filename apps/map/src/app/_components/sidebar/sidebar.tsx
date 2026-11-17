"use client";

import { cn } from "@acme/ui";

import { filterStore } from "~/utils/store/filter";
import { selectedItemStore } from "~/utils/store/selected-item";
import { DesktopLocationPanelContent } from "../map/desktop-location-panel-content";
import { DesktopNearbyLocations } from "../map/desktop-nearby-locations";
import { FiltersAll } from "../map/filters-all";
import { MapSearchBox } from "../map/map-searchbox-desktop";

/**
 * The left panel: search on top, then the nearby list, the filters, or a
 * workout's details. The nearby list stays mounted under the details so the
 * back link returns to the same scroll position.
 */
export const Sidebar = () => {
  const allFilters = filterStore.use.allFilters();
  const panelLocationId = selectedItemStore.use.panelLocationId();
  const showDetails = panelLocationId != null && !allFilters;
  return (
    <>
      <div className="relative border-b px-4 pt-4 pb-3">
        <MapSearchBox />
      </div>
      <FiltersAll className={cn({ hidden: !allFilters })} />
      {showDetails ? <DesktopLocationPanelContent /> : null}
      <DesktopNearbyLocations
        className={cn({ hidden: allFilters || showDetails })}
      />
    </>
  );
};
