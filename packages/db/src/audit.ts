import { sql } from "drizzle-orm";

import type { AppDb } from "./client";

/** Run source writes with attribution that expires at transaction end. */
export const withAuditUser = async <T>(
  db: AppDb,
  context: { userId: number | null; source?: string | null },
  fn: (tx: AppDb) => Promise<T>,
): Promise<T> =>
  db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT set_config('app.user_id', ${context.userId?.toString() ?? ""}, true),
             set_config('app.source', ${context.source ?? ""}, true)
    `);
    // Drizzle transactions support the queries and nested transactions used by
    // write helpers; the connection-only $client property is not used here.
    return fn(tx as unknown as AppDb);
  });
