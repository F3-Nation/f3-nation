import { withAuditUser } from "@acme/db";

import type { Context } from "../shared";

// Keep this upper bound aligned with users.id, each audit history table's
// changed_by type and trigger parsing; larger actor IDs are recorded as NULL.
const MAX_PG_INTEGER = 2_147_483_647;

/** Attribute only the write block; use the original context after commit. */
export const withAuditContext = <T>(
  ctx: Context,
  fn: (auditCtx: Context) => Promise<T>,
): Promise<T> => {
  // Cookie sessions can carry a numeric string despite Session.id's type.
  // A key identifies a credential, not the human who owns that credential.
  const id = Number(ctx.session?.id);
  const userId =
    !ctx.session?.apiKey &&
    Number.isInteger(id) &&
    id > 0 &&
    id <= MAX_PG_INTEGER
      ? id
      : null;
  return withAuditUser(ctx.db, { userId }, (db) => fn({ ...ctx, db }));
};
