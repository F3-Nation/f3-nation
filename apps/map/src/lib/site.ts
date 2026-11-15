import { env } from "~/env";

/**
 * Canonical origin for robots.txt and the sitemap. Falls back to localhost
 * when validation is skipped (CI and lint builds), as map-metadata.ts does.
 */
export const getSiteUrl = (): string => {
  // Typed as possibly unset: the value is undefined when validation is skipped.
  const raw = (env.F3_MAP_BASE_URL as string | undefined)?.trim();
  const origin =
    raw === undefined || raw === "" ? "http://localhost:3000" : raw;
  return origin.replace(/\/+$/, "");
};
