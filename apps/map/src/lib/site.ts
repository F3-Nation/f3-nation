import { env } from "~/env";

/**
 * Canonical origin for robots.txt and the sitemap. Falls back to localhost
 * when validation is skipped (CI and lint builds), as map-metadata.ts does.
 */
export const getSiteUrl = (): string => {
  // Widened on purpose: the value is undefined when validation is skipped.
  const configured: string | undefined = env.F3_MAP_BASE_URL;
  const raw = configured?.trim();
  return (raw ? raw : "http://localhost:3000").replace(/\/+$/, "");
};
