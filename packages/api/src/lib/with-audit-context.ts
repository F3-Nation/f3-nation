import { withAuditUser } from "@acme/db";

import type { Context } from "../shared";

/** Attribute only the write block; use the original context after commit. */
export const withAuditContext = <T>(
  ctx: Context,
  fn: (auditCtx: Context) => Promise<T>,
): Promise<T> => {
  // Cookie sessions can carry a numeric string despite Session.id's type.
  // A key identifies a credential, not the human who owns that credential.
  const id = Number(ctx.session?.id);
  const userId =
    !ctx.session?.apiKey && Number.isInteger(id) && id > 0 && id <= 2147483647
      ? id
      : null;
  return withAuditUser(ctx.db, { userId }, (db) => fn({ ...ctx, db }));
};
