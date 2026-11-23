import type { MetadataRoute } from "next";

import { env } from "~/env";
import { getSiteUrl } from "~/lib/site";

// Read the site URL per request: the image is built without F3_MAP_BASE_URL
// and promoted unchanged from Staging to Production, so a build-time render
// would bake the localhost fallback into both.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  // Only Production is meant to be found through search.
  if (env.F3_CHANNEL !== "prod") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  };
}
