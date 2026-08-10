import "server-only";

import { logWarn } from "~/lib/logging";

export async function isApiDown(base: string | undefined): Promise<boolean> {
  if (!base) return false;
  try {
    const res = await fetch(new URL("/v1/ping", base).href, {
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(3000),
    });
    // 4xx (e.g. 429 rate-limit) means the API is up and responding
    return res.status >= 500;
  } catch (err) {
    logWarn("admin.api_health.check_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}
