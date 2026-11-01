import { env } from "@/env";

export const SITE_TITLE = "F3 Region Workouts";
export const SITE_DESCRIPTION =
  "Find F3 workout locations and schedules in your region";

/** Treats "" (an unset value in an env file) the same as undefined. */
export const nonEmpty = (value: string | undefined): string | undefined =>
  value?.trim() ? value.trim() : undefined;

/**
 * Canonical origin for metadata and the sitemap. Falls back to production, the
 * only correct public address, so an unset value never points links elsewhere.
 */
export const getSiteUrl = (): string =>
  (nonEmpty(env.SITE_URL) ?? "https://regions2.f3nation.com").replace(
    /\/+$/,
    "",
  );

/**
 * Freshness budget (spec AC-13: edits visible within 1 h). An edit reaches the
 * cached page within the API cache (60 s) + DATA_TTL_SECONDS (300 s) + the
 * page's ISR window (300 s; Next uses the shortest cache the page reads), about
 * 11 min, as long as the page keeps getting requests. A stale page is refreshed
 * in the background, so the first visit after an idle spell still sees the
 * previous version and the next one sees the update.
 */
export const DATA_TTL_SECONDS = 300;
