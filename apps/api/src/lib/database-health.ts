import { checkDb } from "@acme/db/client";

let outstanding: Promise<{ status: "ok" }> | undefined;

/** Retain the query after a health deadline to bound abandoned pool work. */
export function checkDatabase() {
  outstanding ??= Promise.resolve()
    .then(() => checkDb())
    .then(() => ({ status: "ok" as const }))
    .finally(() => {
      outstanding = undefined;
    });
  return outstanding;
}
