/**
 * Process-global cache bootstrap.
 *
 * The Next.js App Router is split into multiple route handler modules,
 * but they all share the same Node.js module graph at runtime. Exporting
 * a single lazily-initialized `hostnameCache` from here guarantees the
 * catch-all route and the `/health` route (and any future admin probes)
 * share one in-memory snapshot and one 60-second refresh loop.
 *
 * This module is intentionally NOT imported by `/health` — the health
 * check must return 200 even if the DB is unreachable or env validation
 * would otherwise throw (R5 Decision 4 — the TLS handshake has already
 * proven cert match, so HTTP liveness is enough). Keeping the cache
 * in its own module means `/health/route.ts` can stay import-free from
 * anything that touches `env` or the DB client.
 */

import { env } from "../env";
import { createDbFetcher, createHostnameCache } from "./cache";
import type { HostnameCache } from "./cache";
import { createRuntimeDb } from "./db-client";
import type { RuntimeDbHandle } from "./db-client";
import { logger } from "./logger";

let handle: RuntimeDbHandle | null = null;
let cache: HostnameCache | null = null;
let bootstrapPromise: Promise<HostnameCache> | null = null;

/**
 * Lazy-initialize the shared cache on first request. We do this here
 * (rather than at module top-level) so `next build` doesn't try to
 * dial Neon during the compile step.
 */
export function getHostnameCache(): Promise<HostnameCache> {
  if (cache !== null) {
    return Promise.resolve(cache);
  }
  if (bootstrapPromise !== null) {
    return bootstrapPromise;
  }
  bootstrapPromise = (async () => {
    handle = createRuntimeDb({
      connectionString: env.REDIRECT_PLATFORM_DATABASE_URL,
    });
    const built = createHostnameCache({
      fetcher: createDbFetcher(handle.db),
      logger,
    });
    // Populate before we start the interval — the first request will
    // wait on this, subsequent requests hit the in-memory map.
    await built.refreshNow();
    built.start();

    // Graceful shutdown: Cloud Run sends SIGTERM ~10s before killing
    // the container. We stop the refresh timer and close the pool so
    // in-flight requests can drain cleanly.
    const shutdown = (): void => {
      built.stop();
      if (handle) {
        void handle.end();
      }
    };
    process.once("SIGTERM", shutdown);
    process.once("beforeExit", shutdown);

    cache = built;
    return built;
  })();
  return bootstrapPromise;
}
