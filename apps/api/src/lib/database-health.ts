import { checkDb } from "@acme/db/client";

import { logWarn } from "./logging";

export const DATABASE_HEALTH_TIMEOUT_MS = 3_000;

let outstanding: Promise<{ status: "ok" }> | undefined;

/** Retain the query after a health deadline to bound abandoned pool work. */
export function checkDatabase() {
  if (outstanding) return outstanding;
  const stalled = setTimeout(() => {
    logWarn("api.health.database_probe_stalled", {});
  }, DATABASE_HEALTH_TIMEOUT_MS).unref();
  outstanding = Promise.resolve()
    .then(() => checkDb())
    .then(() => ({ status: "ok" as const }))
    .finally(() => {
      clearTimeout(stalled);
      outstanding = undefined;
    });
  return outstanding;
}
