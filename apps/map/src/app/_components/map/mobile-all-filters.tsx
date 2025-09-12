"use client";

import { Z_INDEX } from "@acme/shared/app/constants";
import { cn } from "@acme/ui";

import { filterStore } from "~/utils/store/filter";
import { FiltersAll } from "./filters-all";

export const MobileAllFilters = () => {
  const allFilters = filterStore.use.allFilters();
  return !allFilters ? null : (
    <div
      style={{ zIndex: Z_INDEX.MOBILE_ALL_FILTERS_CONTAINER }}
      className={cn(`absolute inset-0 block bg-background lg:hidden`)}
    >
      <FiltersAll />
    </div>
  );
};
