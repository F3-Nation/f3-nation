import "server-only";

import { unstable_cache } from "next/cache";

import { fetchRegion, fetchRegions } from "@/lib/api";
import { DATA_TTL_SECONDS } from "@/lib/site";

/**
 * API reads cached for DATA_TTL_SECONDS (stale-while-revalidate), so a burst
 * of page renders costs one upstream call. Failures are never cached.
 */
export const getRegions = unstable_cache(
  fetchRegions,
  ["region-pages:regions"],
  {
    revalidate: DATA_TTL_SECONDS,
  },
);

const getCachedRegion = unstable_cache(fetchRegion, ["region-pages:region"], {
  revalidate: DATA_TTL_SECONDS,
});

/**
 * A region and its workouts, or null. Unknown slugs are rejected against the
 * cached region list first, so made-up URLs never reach the API and never add
 * per-slug cache entries.
 */
export async function getRegion(slug: string) {
  const regions = await getRegions();
  if (!regions.some((region) => region.slug === slug)) return null;
  return getCachedRegion(slug);
}
