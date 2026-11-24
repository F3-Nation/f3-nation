import type { MetadataRoute } from "next";

// These apps are sign-in only; keep every path out of search results.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
