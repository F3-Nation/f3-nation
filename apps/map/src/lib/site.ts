import { env } from "~/env";

/**
 * Canonical origin for robots.txt and the sitemap. Falls back to localhost,
 * as map-metadata.ts does, when env validation is skipped (see `skipValidation`
 * in env.ts) and F3_MAP_BASE_URL is empty or unset.
 */
export const getSiteUrl = (): string => {
  // Typed as possibly unset: with validation skipped, env.ts doesn't enforce it.
  const raw = (env.F3_MAP_BASE_URL as string | undefined)?.trim();
  const origin =
    raw === undefined || raw === "" ? "http://localhost:3000" : raw;
  return origin.replace(/\/+$/, "");
};
