import { sql } from "@acme/db";
import { db } from "@acme/db/client";

let outstanding: Promise<{ status: "ok" }> | undefined;

/** Retain the query after a health deadline to bound abandoned pool work. */
export function checkDatabase() {
  outstanding ??= Promise.resolve()
    .then(() => db.execute(sql`select 1`))
    .then(() => ({ status: "ok" as const }))
    .finally(() => {
      outstanding = undefined;
    });
  return outstanding;
}
