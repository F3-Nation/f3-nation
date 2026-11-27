import type { MetadataRoute } from "next";

// This app is sign-in only; ask every crawler to stay off every path.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
