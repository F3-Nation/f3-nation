import type { SQL } from "drizzle-orm";
import type { PgColumn, PgSelect } from "drizzle-orm/pg-core";

export function withPagination<T extends PgSelect>(
  qb: T,
  orderByColumns: (PgColumn | SQL | SQL.Aliased)[],
  offset = 0,
  limit = 10,
) {
  return qb
    .orderBy(...orderByColumns)
    .limit(limit)
    .offset(offset);
}
