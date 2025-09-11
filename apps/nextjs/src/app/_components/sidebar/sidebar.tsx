"use client";

import { cn } from "@acme/ui";

import { filterStore } from "~/utils/store/filter";
import { DesktopNearbyLocations } from "../map/desktop-nearby-locations";
import { FiltersAll } from "../map/filters-all";
import { MapSearchBox } from "../map/map-searchbox-desktop";

export const Sidebar = () => {
  const allFilters = filterStore.use.allFilters();
  return (
    <>
      <div className="relative">
        <MapSearchBox hideLogo className="" />
      </div>
      <FiltersAll className={cn({ hidden: !allFilters })} />
      <DesktopNearbyLocations className={cn({ hidden: allFilters })} />
    </>
  );
};
