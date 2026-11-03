"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

import SearchableRegionList from "@/components/searchable-region-list";
import { groupRegionsByLetter, resolveLetter } from "@/lib/letters";
import type { RegionSummary } from "@/types/region";

interface RegionsClientProps {
  regions: RegionSummary[];
}

export function RegionsClient({ regions }: RegionsClientProps) {
  const currentLetter = resolveLetter(useSearchParams().get("letter"));
  // Grouped here rather than on the server so each region crosses the
  // server/client boundary once.
  const regionsByLetter = useMemo(
    () => groupRegionsByLetter(regions),
    [regions],
  );

  return (
    <SearchableRegionList
      regions={regions}
      currentLetter={currentLetter}
      regionsByLetter={regionsByLetter}
    />
  );
}
