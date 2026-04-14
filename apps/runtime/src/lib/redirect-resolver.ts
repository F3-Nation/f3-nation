/**
 * Pure redirect resolution — "given a Host header and a path, what
 * redirect target (if any) should we issue?"
 *
 * No I/O, no env access, no imports other than types. The route
 * handler wires this up with the DB-backed cache, but the resolver
 * itself is trivially unit-testable.
 *
 * R5 Decision 3 collapses the old per-region `apps/web` and `apps/stats`
 * into this one function:
 *
 *   - `apex.f3marshall.com`       → https://regions.f3nation.com/<slug>
 *   - `stats.f3marshall.com`      → https://pax-vault.f3nation.com/stats/region/<id>
 *   - unknown hostname            → handled by caller (fallback URL)
 *
 * The hostname/stats disambiguation is done on the Host header prefix,
 * not on a DB column. Both `apex` and `stats` rows live in
 * `region_custom_domains`, keyed by hostname, so the cache already has
 * the right row for whichever one was looked up. The `stats.` prefix
 * is the signal that this is the stats variant.
 */

import type { CacheEntry } from "./cache";
import { normalizeHostname } from "./cache";

const REGION_BASE_URL = "https://regions.f3nation.com";
const STATS_BASE_URL = "https://pax-vault.f3nation.com/stats/region";
const STATS_PREFIX = "stats.";

export type ResolverKind = "apex_redirect" | "stats_redirect" | "unknown_host";

export interface ResolverResult {
  kind: ResolverKind;
  target?: string;
  statusCode: 307 | 404;
  /** The hostname (normalized) that was looked up. For logging. */
  hostname: string;
  /** True if this host header arrived with a `stats.` prefix. */
  isStatsHost: boolean;
}

export type CacheGetter = (hostname: string) => CacheEntry | null;

export function isStatsHostname(hostname: string): boolean {
  return normalizeHostname(hostname).startsWith(STATS_PREFIX);
}

export function buildRegionRedirectUrl(regionSlug: string): string {
  return `${REGION_BASE_URL}/${regionSlug}`;
}

export function buildStatsRedirectUrl(regionId: string): string {
  return `${STATS_BASE_URL}/${regionId}`;
}

/**
 * Resolve a single incoming request. The caller is responsible for
 * turning the result into an actual HTTP response (and for falling
 * back to `RUNTIME_FALLBACK_REDIRECT_URL` when `kind === "unknown_host"`).
 *
 * @param hostname Host header value, case-insensitive, trailing-dot tolerant.
 * @param _path    Request path. Unused today — every redirect is catch-all
 *                  and drops the path — but we take it as a parameter so a
 *                  future "preserve path on redirect" feature doesn't need a
 *                  signature change.
 * @param cacheGet  Cache lookup function (injected for testability).
 */
export function resolveRedirect(
  hostname: string,
  _path: string,
  cacheGet: CacheGetter,
): ResolverResult {
  const normalized = normalizeHostname(hostname);
  const isStats = normalized.startsWith(STATS_PREFIX);

  const entry = cacheGet(normalized);
  if (!entry) {
    return {
      kind: "unknown_host",
      statusCode: 404,
      hostname: normalized,
      isStatsHost: isStats,
    };
  }

  if (isStats) {
    return {
      kind: "stats_redirect",
      target: buildStatsRedirectUrl(entry.regionId),
      statusCode: 307,
      hostname: normalized,
      isStatsHost: true,
    };
  }

  return {
    kind: "apex_redirect",
    target: buildRegionRedirectUrl(entry.regionSlug),
    statusCode: 307,
    hostname: normalized,
    isStatsHost: false,
  };
}
