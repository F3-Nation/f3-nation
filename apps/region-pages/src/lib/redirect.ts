export const CANONICAL_HOST = "regions.f3nation.com";
export const LEGACY_ALIAS_HOST = "regions2.f3nation.com";

const normalizeHost = (host: string | null): string | undefined =>
  host?.split(",")[0]?.trim().toLowerCase().replace(/:\d+$/, "") ?? undefined;

/**
 * The 301 target for a request to the regions2 alias, or null. Inert until
 * SITE_URL points at regions.f3nation.com, so it can ship before the domain
 * moves (docs/REGION_PAGES_CUTOVER.md).
 */
export const canonicalRedirect = (
  requestHost: string | null,
  url: URL,
  siteUrl: string,
): string | null => {
  if (new URL(siteUrl).host !== CANONICAL_HOST) return null;
  if (normalizeHost(requestHost) !== LEGACY_ALIAS_HOST) return null;
  return `https://${CANONICAL_HOST}${url.pathname}${url.search}`;
};
