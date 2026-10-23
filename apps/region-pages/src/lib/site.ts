import { env } from "@/env";

export const SITE_TITLE = "F3 Region Workouts";
export const SITE_DESCRIPTION =
  "Find F3 workout locations and schedules in your region";

/** Treats "" (an unset value in an env file) the same as undefined. */
export const nonEmpty = (value: string | undefined): string | undefined =>
  value?.trim() ? value.trim() : undefined;

/**
 * Canonical origin for metadata and the sitemap. The legacy app fell back to
 * an unrelated domain when this was unset; fall back to production instead.
 */
export const getSiteUrl = (): string =>
  (nonEmpty(env.SITE_URL) ?? "https://regions.f3nation.com").replace(
    /\/+$/,
    "",
  );

/**
 * Freshness budget (spec AC-13: edits visible within 1 h). Worst case is
 * API cache (60 s) + DATA_TTL_SECONDS + region page ISR (3000 s) = 56 min.
 */
export const DATA_TTL_SECONDS = 300;
