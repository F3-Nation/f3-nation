import type { MetadataRoute } from "next";

import { getRegions } from "@/lib/data";
import { getAllEventStaticParams } from "@/lib/region-events";
import { getSiteUrl } from "@/lib/site";

// Built per request from the cached region list (never at image build time).
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const regions = await getRegions();

  return [
    { url: `${siteUrl}/`, changeFrequency: "daily", priority: 1 },
    ...regions.map((region) => ({
      url: `${siteUrl}/${region.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...getAllEventStaticParams().map(({ regionSlug, eventSlug }) => ({
      url: `${siteUrl}/${regionSlug}/events/${eventSlug}`,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
  ];
}
