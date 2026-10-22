export const SITE_TITLE = "F3 Region Workouts";
export const SITE_DESCRIPTION =
  "Find F3 workout locations and schedules in your region";

/**
 * Canonical origin for metadata and the sitemap. The legacy app fell back to
 * an unrelated domain when this was unset; fall back to production instead.
 */
export const getSiteUrl = (): string =>
  (process.env.SITE_URL ?? "https://regions.f3nation.com").replace(/\/$/, "");

/** Region list/page ISR window, in seconds. */
export const REVALIDATE_SECONDS = 3600;

/**
 * The Docker image build has no API access: render nothing at build time and
 * let ISR fill pages on first request.
 */
export const isStaticGenerationSkipped = (): boolean =>
  process.env.SKIP_SSG === "1" || process.env.F3_CHANNEL === "ci";
