import { env } from "@acme/env";

import { logError, logInfo } from "../logger";
import { clearMapDataCache } from "./map-data-cache";

/**
 * Triggers the Map app's cache revalidation via HTTP.
 * API and Map are separate services, so the Map app must be notified explicitly.
 *
 * Returns a Promise that resolves when the request completes (success or failure).
 * Callers can await it or fire-and-forget with `void triggerMapAppRevalidation()`.
 *
 * @param context - Optional context for logging (e.g. the webhook event that triggered this)
 */
export const triggerMapAppRevalidation = (context?: {
  event?: unknown;
}): Promise<void> => {
  // Map data changed: this instance's cached datasets are stale now (other
  // instances catch up within MAP_DATA_TTL_MS).
  clearMapDataCache();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- env validation is skipped on CI/SKIP_ENV_VALIDATION builds
  const mapUrl = env.NEXT_PUBLIC_MAP_URL?.endsWith("/")
    ? env.NEXT_PUBLIC_MAP_URL.slice(0, -1)
    : env.NEXT_PUBLIC_MAP_URL;

  if (!mapUrl || !env.SUPER_ADMIN_API_KEY) {
    logError("api.map_revalidate.missing_config", {
      mapUrl: !!mapUrl,
      superAdminKeyExists: !!env.SUPER_ADMIN_API_KEY,
    });
    return Promise.resolve();
  }

  return fetch(`${mapUrl}/api/revalidate`, {
    method: "POST",
    headers: { "x-api-key": env.SUPER_ADMIN_API_KEY },
  })
    .then((response) => {
      if (!response.ok) {
        logError("api.map_revalidate.failed", {
          status: response.status,
          statusText: response.statusText,
          revalidationEvent: context?.event,
        });
      } else {
        logInfo("api.map_revalidate.success", {
          revalidationEvent: context?.event,
        });
      }
    })
    .catch((error: unknown) => {
      logError(
        "api.map_revalidate.error",
        { revalidationEvent: context?.event },
        error,
      );
    });
};
