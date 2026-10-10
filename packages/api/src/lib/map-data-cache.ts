/**
 * Short-lived, per-instance cache for the public map datasets
 * (map.location.eventsAndLocations / regionsWithLocation). They take no input
 * and are identical for every caller, yet each call rebuilt them from scratch
 * (eventsAndLocations: ~6.7k rows into a 1.5 MB response, ~650ms of API time
 * on staging). With a TTL, an instance builds each dataset at most once per
 * window, and concurrent misses share one load instead of stampeding the DB.
 *
 * Staleness: an edit reaches browsers within MAP_DATA_TTL_MS (plus the
 * client's own staleTime). The cache is also cleared whenever this instance
 * triggers a map revalidation (see revalidate-map.ts), and by tests that write
 * map data.
 *
 * The map's SSG/ISR page render never uses it (mapDataFor): that render runs
 * this router in-process inside the map service (apps/map/src/orpc/
 * client.server.ts), and a revalidation after an edit must bake fresh data
 * into a page the map then serves for up to an hour.
 */
import { Client, Header } from "@acme/shared/common/enums";

export const MAP_DATA_TTL_MS = 60_000;

interface Entry {
  value: unknown;
  expiresAt: number;
}

const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();
// Bumped by clearMapDataCache so a load that started before a clear can't
// repopulate the cache with data from before it.
let generation = 0;

export async function cachedMapData<T>(
  key: string,
  load: () => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  const hit = entries.get(key);
  if (hit && hit.expiresAt > now()) return hit.value as T;

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const startedIn = generation;
  const promise = load()
    .then((value) => {
      if (startedIn === generation) {
        entries.set(key, { value, expiresAt: now() + MAP_DATA_TTL_MS });
      }
      return value;
    })
    .finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return promise;
}

export function clearMapDataCache(): void {
  generation += 1;
  entries.clear();
  inFlight.clear();
}

/**
 * cachedMapData for API callers; a direct load for the map's own SSG/ISR
 * render (Client.ORPC_SSG), which must never bake cached data into a page.
 */
export function mapDataFor<T>(
  reqHeaders: Headers | undefined,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  if (reqHeaders?.get(Header.Client) === Client.ORPC_SSG) return load();
  return cachedMapData(key, load);
}
