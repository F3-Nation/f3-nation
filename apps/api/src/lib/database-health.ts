import type { CheckRunnerResult } from "@f3nation/health";
import { checkDb } from "@acme/db/client";

import { logWarn } from "./logging";

export const DATABASE_HEALTH_TIMEOUT_MS = 3_000;

let outstanding: Promise<CheckRunnerResult> | undefined;

/** Keep physical ownership while sharing a deadline-bounded health response. */
export function checkDatabase() {
  if (outstanding) return outstanding;
  outstanding = new Promise((resolve, reject) => {
    const stalled = setTimeout(() => {
      logWarn("api.health.database_probe_stalled", {});
      resolve({
        status: "down",
        message: "Check timed out",
        details: { reason: "timeout", timeoutMs: DATABASE_HEALTH_TIMEOUT_MS },
      });
    }, DATABASE_HEALTH_TIMEOUT_MS).unref();
    void Promise.resolve()
      .then(() => checkDb())
      .then(() => resolve({ status: "ok" }), reject)
      .finally(() => {
        clearTimeout(stalled);
        outstanding = undefined;
      });
  });
  return outstanding;
}
