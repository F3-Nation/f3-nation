import type { MetadataRoute } from "next";

import { getSiteUrl } from "~/lib/site";

// Built per request, never at image build time (see robots.ts).
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${getSiteUrl()}/`, changeFrequency: "daily", priority: 1 }];
}
