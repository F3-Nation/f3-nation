import type { MetadataRoute } from "next";

import { getSiteUrl } from "@/lib/site";

// Read SITE_URL per request: a build-time render would bake the production
// fallback into the image that also serves staging.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  };
}
