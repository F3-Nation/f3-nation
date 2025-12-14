"use client";

import Image from "next/image"; // Next.js Image component for optimized image rendering.

import { CalendarPlus2, Clock, Filter, Sunrise, Sunset } from "lucide-react";

import { RERENDER_LOGS } from "@acme/shared/common/constants";
import { cn } from "@acme/ui";

import type { FiltersType } from "~/utils/store/filter";
import {
  filterStore,
  isAnyFilterActive,
  useTodayAndTomorrowFilters,
} from "~/utils/store/filter";

// Defining items for the filter options with their names and corresponding SVG components or image paths.

// The main component for the map drawer.
export const FiltersSome = () => {
  RERENDER_LOGS && console.log("DrawerSomeFilters rerender");
  const filters = filterStore.useBoundStore();
  const { today, tomorrow, todayVar, tomorrowVar } =
    useTodayAndTomorrowFilters();

  // Function to toggle the state of a filter when clicked.
  const handleFilterClick = (
    filterName: keyof FiltersType,
    newState?: boolean,
  ) => {
    if (filterName === "allFilters") {
      filterStore.setState({ allFilters: !filters.allFilters });
    } else {
      filterStore.setState({
        [filterName]: newState ?? !filters[filterName],
      });
    }
  };
  const filterItems = [
    {
      name: "am" as const,
      img: Sunrise,
      onClick: () => {
        handleFilterClick("am");
        handleFilterClick("pm", false);
      },
    },
    {
      name: "pm" as const,
      img: Sunset,
      onClick: () => {
        handleFilterClick("pm");
        handleFilterClick("am", false);
      },
    },
    {
      name: "allFilters" as const,
      img: Filter,
      onClick: () => handleFilterClick("allFilters"),
      active: isAnyFilterActive(filters),
    },
  ];

  return (
    <div className="mt-2 max-w-sm self-center overflow-hidden px-2">
      {/* Grid layout for filter options */}
      <div className="flex flex-row flex-wrap gap-4">
        {/* Mapping over each filter item to create its visual representation */}
        <button
          className="flex cursor-pointer flex-col items-center"
          onClick={() => handleFilterClick(todayVar)} // Toggle filter state on click.
        >
          {/* Container for the filter icon, changes appearance based on filter state */}
          <div
            className={cn(
              `rounded-lg border border-foreground bg-background p-2`,
              {
                "border-muted-foreground bg-muted-foreground":
                  today ?? filters[todayVar],
              },
            )}
          >
            {/* Centering container for the filter icon */}
            <div className="flex h-7 w-full items-center justify-center">
              {/* Conditional rendering of either an SVG component or an image based on the item type */}
              {typeof Clock === "string" ? (
                <Image
                  className="max-h-full w-auto object-contain"
                  src={Clock}
                  alt={todayVar}
                />
              ) : (
                <Clock
                  strokeWidth={1.25}
                  className={cn("size-8 stroke-foreground", {
                    "stroke-background": today ?? filters[todayVar],
                  })}
                />
              )}
            </div>
          </div>
          {/* Name of the filter below its icon */}
          <p className="text-xs text-foreground">Today</p>
        </button>
        <button
          className="flex cursor-pointer flex-col items-center"
          onClick={() => handleFilterClick(tomorrowVar)} // Toggle filter state on click.
        >
          {/* Container for the filter icon, changes appearance based on filter state */}
          <div
            className={cn(
              `rounded-lg border border-foreground bg-background p-2`,
              {
                "border-muted-foreground bg-muted-foreground":
                  tomorrow ?? filters[tomorrowVar],
              },
            )}
          >
            {/* Centering container for the filter icon */}
            <div className="flex h-7 w-full items-center justify-center">
              {/* Conditional rendering of either an SVG component or an image based on the item type */}
              {typeof CalendarPlus2 === "string" ? (
                <Image
                  className="max-h-full w-auto object-contain"
                  src={CalendarPlus2}
                  alt={tomorrowVar}
                />
              ) : (
                <CalendarPlus2
                  strokeWidth={1.25}
                  className={cn("size-8 stroke-foreground", {
                    "stroke-background": tomorrow ?? filters[tomorrowVar],
                  })}
                />
              )}
            </div>
          </div>
          {/* Name of the filter below its icon */}
          <p className="text-xs text-foreground">Tomorrow</p>
        </button>
        {filterItems.map((item, index) => (
          <button
            key={index} // React key for list rendering.
            className="flex cursor-pointer flex-col items-center"
            onClick={item.onClick ?? (() => handleFilterClick(item.name))} // Toggle filter state on click.
          >
            {/* Container for the filter icon, changes appearance based on filter state */}
            <div
              className={cn(
                `rounded-lg border border-foreground bg-background p-2`,
                {
                  "border-muted-foreground bg-muted-foreground":
                    item.active ?? filters[item.name],
                },
              )}
            >
              {/* Centering container for the filter icon */}
              <div className="flex h-7 w-full items-center justify-center">
                {/* Conditional rendering of either an SVG component or an image based on the item type */}
                {typeof item.img === "string" ? (
                  <Image
                    className="max-h-full w-auto object-contain"
                    src={item.img}
                    alt={item.name}
                  />
                ) : (
                  <item.img
                    strokeWidth={1.25}
                    className={cn("size-8 stroke-foreground", {
                      "stroke-background": item.active ?? filters[item.name],
                    })}
                  />
                )}
              </div>
            </div>
            {/* Name of the filter below its icon */}
            <p className="text-xs text-foreground">{item.name}</p>
          </button>
        ))}
      </div>
    </div>
  );
};
