import type { MetadataRoute } from "next";

import { getSiteUrl } from "~/lib/site";

// Read the site URL per request: the same image serves Staging and Production,
// so a build-time value would point Staging's robots file at Production.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  };
}
