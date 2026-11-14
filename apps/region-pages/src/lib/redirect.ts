const CANONICAL_HOST = "regions.f3nation.com";
const LEGACY_ALIAS_HOST = "regions2.f3nation.com";
// Exact paths, so a region slug such as /health-club still redirects.
const PASSTHROUGH_PATHS = new Set(["/health", "/favicon.ico"]);

const normalizeHost = (host: string | null): string | undefined =>
  host?.split(",")[0]?.trim().toLowerCase().replace(/:\d+$/, "") ?? undefined;

/**
 * The canonical-host target for a request to the regions2 alias, or null.
 * Null unless siteUrl's host is the canonical host, so the alias keeps serving
 * the app until the canonical domain points here.
 */
export const canonicalRedirect = (
  requestHost: string | null,
  url: URL,
  siteUrl: string,
): string | null => {
  if (new URL(siteUrl).host !== CANONICAL_HOST) return null;
  if (PASSTHROUGH_PATHS.has(url.pathname)) return null;
  if (normalizeHost(requestHost) !== LEGACY_ALIAS_HOST) return null;
  return `https://${CANONICAL_HOST}${url.pathname}${url.search}`;
};
