import "server-only";

import { unstable_cache } from "next/cache";

import { fetchRegion, fetchRegions } from "@/lib/api";
import { REVALIDATE_SECONDS } from "@/lib/site";

/**
 * API reads cached for REVALIDATE_SECONDS (stale-while-revalidate), so a burst
 * of page renders costs one upstream call. Failures are never cached.
 */
export const getRegions = unstable_cache(
  fetchRegions,
  ["region-pages:regions"],
  {
    revalidate: REVALIDATE_SECONDS,
  },
);

export const getRegion = unstable_cache(fetchRegion, ["region-pages:region"], {
  revalidate: REVALIDATE_SECONDS,
});
