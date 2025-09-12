"use client";

import {
  CalendarIcon,
  CalendarPlus2,
  SlidersHorizontal,
  Sunrise,
  Sunset,
} from "lucide-react";

import { cn } from "@acme/ui";

import {
  filterStore,
  isAnyFilterActive,
  useTodayAndTomorrowFilters,
} from "~/utils/store/filter";

const filterButtonClassName =
  "text-sm font-semibold pointer-events-auto flex items-center justify-center gap-2 rounded-md bg-background px-2 py-1 shadow text-foreground flex-shrink-0";

export const MobileFilterButtons = () => {
  const { today, tomorrow, todayVar, tomorrowVar } =
    useTodayAndTomorrowFilters();
  const am = filterStore.use.am();
  const pm = filterStore.use.pm();
  const filters = filterStore.useBoundStore();
  // Remove tomorrow since we have a separate button for it
  const isFilterActive = isAnyFilterActive({
    ...filters,
    [tomorrowVar]: false,
    [todayVar]: false,
  });

  return (
    <div className="flex flex-row gap-2">
      {/* All filters */}
      <button
        className={cn(filterButtonClassName, {
          "bg-red-500 text-white": isFilterActive,
        })}
        onClick={(e) => {
          filterStore.setState((fs) => ({ allFilters: !fs.allFilters }));
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        <SlidersHorizontal strokeWidth={2} className={cn("size-4")} />
        All filters
      </button>
      {/* Today */}
      <button
        className={cn(filterButtonClassName, {
          "bg-red-500 text-white": today,
        })}
        onClick={(e) => {
          filterStore.setState((fs) => ({ [todayVar]: !fs[todayVar] }));
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        <CalendarIcon strokeWidth={2} className={cn("size-4")} />
        Today
      </button>
      {/* Tomorrow */}
      <button
        className={cn(filterButtonClassName, {
          "bg-red-500 text-white": tomorrow,
        })}
        onClick={(e) => {
          filterStore.setState((fs) => ({ [tomorrowVar]: !fs[tomorrowVar] }));
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        <CalendarPlus2 strokeWidth={2} className={cn("size-4")} />
        Tomorrow
      </button>
      {/* AM */}
      <button
        className={cn(filterButtonClassName, {
          "bg-red-500 text-white": am,
        })}
        onClick={(e) => {
          filterStore.setState((fs) => ({ am: !fs.am }));
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        <Sunrise strokeWidth={2} className={cn("size-4")} />
        AM
      </button>
      {/* PM */}
      <button
        className={cn(filterButtonClassName, {
          "bg-red-500 text-white": pm,
        })}
        onClick={(e) => {
          filterStore.setState((fs) => ({ pm: !fs.pm }));
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        <Sunset strokeWidth={2} className={cn("size-4")} />
        PM
      </button>
    </div>
  );
};
