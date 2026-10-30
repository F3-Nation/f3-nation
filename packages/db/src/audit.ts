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
    // Transactions lack AppDb's connection-only $client; callbacks and the
    // write helpers they call must use only queries and nested transactions.
    return fn(tx as unknown as AppDb);
  });
