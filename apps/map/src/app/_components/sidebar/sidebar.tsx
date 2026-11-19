"use client";

import { cn } from "@acme/ui";

import { filterStore } from "~/utils/store/filter";
import { selectedItemStore } from "~/utils/store/selected-item";
import { DesktopLocationPanelContent } from "../map/desktop-location-panel-content";
import { DesktopNearbyLocations } from "../map/desktop-nearby-locations";
import { FiltersAll } from "../map/filters-all";
import { FiltersButton } from "../map/filters-button";
import { MapSearchBox } from "../map/map-searchbox-desktop";

/**
 * The left panel: search and the Filters button on top, then the nearby list
 * or a workout's details. Filters open inline above the list. The list stays
 * mounted under the details so the back link returns to the same scroll
 * position.
 */
export const Sidebar = () => {
  const allFilters = filterStore.use.allFilters();
  const panelLocationId = selectedItemStore.use.panelLocationId();
  const showDetails = panelLocationId != null && !allFilters;
  return (
    <>
      <div className="relative flex flex-col items-start gap-3 border-b px-4 pt-4 pb-3">
        <MapSearchBox className="w-full" />
        <FiltersButton />
      </div>
      {allFilters ? (
        <div className="min-h-0 shrink overflow-y-auto px-4 pt-3">
          <FiltersAll />
        </div>
      ) : null}
      {showDetails ? <DesktopLocationPanelContent /> : null}
      <DesktopNearbyLocations
        className={cn("min-h-[160px]", { hidden: showDetails })}
      />
    </>
  );
};
