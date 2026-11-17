"use client";

import { SlidersHorizontal } from "lucide-react";

import { cn } from "@acme/ui";

import { activeFilterCount, filterStore } from "~/utils/store/filter";

/** The one Filters button: opens the filters and counts the active groups. */
export const FiltersButton = ({ className }: { className?: string }) => {
  const filters = filterStore.useBoundStore();
  const count = activeFilterCount(filters);

  return (
    <button
      type="button"
      aria-expanded={filters.allFilters}
      onClick={(e) => {
        filterStore.setState((s) => ({ allFilters: !s.allFilters }));
        e.stopPropagation();
        e.preventDefault();
      }}
      className={cn(
        "pointer-events-auto flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-bold shadow-sm transition-colors",
        count > 0
          ? "hover:bg-primary-hover bg-primary text-primary-foreground"
          : "bg-foreground text-background hover:bg-foreground/90",
        className,
      )}
    >
      <SlidersHorizontal aria-hidden strokeWidth={2} className="size-3.5" />
      {count > 0 ? `Filters · ${count}` : "Filters"}
    </button>
  );
};
