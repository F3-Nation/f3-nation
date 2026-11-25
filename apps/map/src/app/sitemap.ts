import type { MetadataRoute } from "next";

import { getSiteUrl } from "~/lib/site";

// Built per request, never at image build time (see robots.ts).
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  return [
    { url: `${siteUrl}/`, changeFrequency: "daily", priority: 1 },
    { url: `${siteUrl}/help`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${siteUrl}/changelog`, changeFrequency: "weekly", priority: 0.3 },
  ];
}
