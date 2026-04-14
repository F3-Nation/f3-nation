/**
 * In-memory hostname → redirect-target cache for the runtime.
 *
 * Design per R5 Decision 3:
 *
 *   - Load the full `active` slice of `region_custom_domains` once at
 *     cold start, then refresh every 60s in the background.
 *   - Atomically swap the whole map on each successful refresh. Never
 *     partial-update — cache consumers should always see a consistent
 *     snapshot.
 *   - If a refresh fails, keep serving from the last snapshot and log
 *     a WARN. The next tick retries. This is the "fail-open on DB
 *     outage" behavior the decision mandates.
 *   - Lookups are case-insensitive and trailing-dot tolerant. The
 *     wire `Host` header may arrive as `F3Marshall.COM.` or similar;
 *     we normalize both sides.
 *
 * Expected cache size at 10k domains is well under 10MB (each entry
 * is ~200 bytes), so no eviction logic is needed.
 *
 * The fetcher is injected so tests don't have to stand up a Postgres
 * client. The production factory (`createHostnameCacheFromDb`) wires
 * it to a Drizzle query against `@acme/redirect-platform-db`.
 */

import type { schema } from "@acme/redirect-platform-db";
import { regionCustomDomains } from "@acme/redirect-platform-db";
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";

import type { Logger } from "./logger";

export interface CacheEntry {
  id: string;
  hostname: string;
  regionSlug: string;
  regionId: string;
  lifecycleState: string;
}

export interface HostnameCache {
  /** Trigger a refresh immediately — used on cold start. */
  refreshNow(): Promise<void>;
  /** Start the background refresh loop. Safe to call once. */
  start(): void;
  /** Stop the background refresh loop and clear timers. */
  stop(): void;
  /** Look up a host header value, case-insensitively. */
  get(hostname: string): CacheEntry | null;
  /** Number of entries in the current snapshot. */
  getSize(): number;
}

export type CacheFetcher = () => Promise<CacheEntry[]>;

export interface CreateHostnameCacheOptions {
  fetcher: CacheFetcher;
  logger: Logger;
  /** Refresh interval in ms. Defaults to 60 000 (60s), per R5 Decision 3. */
  refreshIntervalMs?: number;
  /**
   * Inject a scheduler so tests can drive ticks with fake timers rather
   * than waiting real wall-clock seconds. Defaults to `setInterval` /
   * `clearInterval`.
   *
   * The handle is kept as `unknown` so a test fake can use any opaque
   * sentinel type without having to mock the whole `NodeJS.Timeout`
   * interface.
   */
  scheduler?: CacheScheduler;
}

export interface CacheScheduler {
  setInterval: (cb: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

const DEFAULT_REFRESH_MS = 60_000;

/**
 * Normalize a Host header (or a hostname column) to the same canonical
 * form. Strips any trailing dot and lowercases.
 */
export function normalizeHostname(input: string): string {
  const stripped = input.endsWith(".") ? input.slice(0, -1) : input;
  return stripped.toLowerCase();
}

/**
 * Build the map that backs a snapshot. Exported for the unit tests.
 */
export function buildCacheMap(
  entries: readonly CacheEntry[],
): Map<string, CacheEntry> {
  const map = new Map<string, CacheEntry>();
  for (const entry of entries) {
    map.set(normalizeHostname(entry.hostname), entry);
  }
  return map;
}

export function createHostnameCache(
  options: CreateHostnameCacheOptions,
): HostnameCache {
  const {
    fetcher,
    logger,
    refreshIntervalMs = DEFAULT_REFRESH_MS,
    scheduler = {
      setInterval: (cb, ms) => setInterval(cb, ms),
      clearInterval: (handle) =>
        clearInterval(handle as ReturnType<typeof setInterval>),
    },
  } = options;

  // Start empty — `get()` returns null for everything until the first
  // successful refresh populates the map.
  let snapshot: ReadonlyMap<string, CacheEntry> = new Map();
  let timerHandle: unknown = null;
  let started = false;
  let inflight: Promise<void> | null = null;

  async function refreshNow(): Promise<void> {
    // Collapse concurrent refresh calls so only one DB hit is in flight.
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const entries = await fetcher();
        const next = buildCacheMap(entries);
        // Atomic swap: the new reference becomes visible in a single
        // assignment. Readers either see the old snapshot or the new
        // one — never a half-built one.
        snapshot = next;
        logger.info("hostname_cache_refreshed", {
          size: next.size,
        });
      } catch (error) {
        logger.warn("hostname_cache_refresh_failed", {
          error: error instanceof Error ? error.message : String(error),
          retained_size: snapshot.size,
        });
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  function start(): void {
    if (started) return;
    started = true;
    timerHandle = scheduler.setInterval(() => {
      void refreshNow();
    }, refreshIntervalMs);
    // Node keeps the process alive while a timer is active. The runtime
    // is a long-lived HTTP server, so that's fine — but we still unref
    // to let Next.js gracefully drain on SIGTERM without waiting for the
    // next tick. Unref is a no-op in browsers; only Node has it.
    const handleWithUnref = timerHandle as { unref?: () => void };
    if (typeof handleWithUnref.unref === "function") {
      handleWithUnref.unref();
    }
  }

  function stop(): void {
    started = false;
    if (timerHandle !== null) {
      scheduler.clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  function get(hostname: string): CacheEntry | null {
    const key = normalizeHostname(hostname);
    return snapshot.get(key) ?? null;
  }

  function getSize(): number {
    return snapshot.size;
  }

  return { refreshNow, start, stop, get, getSize };
}

// ---------------------------------------------------------------------------
// DB-backed production factory
// ---------------------------------------------------------------------------

type RuntimeDrizzle = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Build a fetcher that runs the R5 Decision 3 query against Drizzle.
 *
 * The SELECT list here must match the GRANT in R5 Decision 8 exactly:
 * the `redirect_runtime` role can only read these 5 columns.
 */
export function createDbFetcher(db: RuntimeDrizzle): CacheFetcher {
  return async () => {
    const rows = await db
      .select({
        id: regionCustomDomains.id,
        hostname: regionCustomDomains.hostname,
        regionSlug: regionCustomDomains.regionSlug,
        regionId: regionCustomDomains.regionId,
        lifecycleState: regionCustomDomains.lifecycleState,
      })
      .from(regionCustomDomains)
      .where(eq(regionCustomDomains.lifecycleState, "active"));
    return rows.map((row) => ({
      id: row.id,
      hostname: row.hostname,
      regionSlug: row.regionSlug,
      regionId: row.regionId,
      lifecycleState: row.lifecycleState,
    }));
  };
}
