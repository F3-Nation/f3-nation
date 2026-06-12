import { useMemo } from "react";
import type { Region } from "@/lib/types";

// ---------------------------------------------------------------------------
// Pure helpers (exported for direct unit testing)
// ---------------------------------------------------------------------------

/**
 * Filter regions: include active regions plus the currently-selected region
 * (even if inactive), then apply an optional search term.
 */
function filterRegions(
  regions: Region[],
  selectedId: number | null,
  search: string,
): Region[] {
  const base = regions.filter((r) => r.isActive || r.id === selectedId);
  if (!search) return base;
  const lower = search.toLowerCase();
  return base.filter((r) => r.name.toLowerCase().includes(lower));
}

/** Find a region by id. */
function findRegionById(
  regions: Region[],
  id: number | null,
): Region | undefined {
  if (id === null) return undefined;
  return regions.find((r) => r.id === id);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseRegionFilterOptions {
  regions: Region[];
  selectedId: number | null;
  search: string;
}

export interface UseRegionFilterReturn {
  selectedRegion: Region | undefined;
  filteredRegions: Region[];
}

export function useRegionFilter({
  regions,
  selectedId,
  search,
}: UseRegionFilterOptions): UseRegionFilterReturn {
  const selectedRegion = useMemo(
    () => findRegionById(regions, selectedId),
    [regions, selectedId],
  );

  const filteredRegions = useMemo(
    () => filterRegions(regions, selectedId, search),
    [regions, selectedId, search],
  );

  return { selectedRegion, filteredRegions };
}
