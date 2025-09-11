import type { SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { asc, desc } from "drizzle-orm";

import type { SortingSchema } from "@acme/validators";
import { isTruthy } from "@acme/shared/common/functions";

export const getSortingColumns = <T,>(
  sorting: SortingSchema | undefined,
  sortingIdToColumn: Record<keyof T, PgColumn | SQL | SQL.Aliased>,
  defaultId: keyof T,
) => {
  return (
    sorting
      ?.map((sorting) => {
        const direction = sorting.desc ? desc : asc;
        const column = sortingIdToColumn[sorting.id as keyof T];
        if (!column) {
          return undefined;
        }
        return direction(column);
      })
      .filter(isTruthy) ?? [desc(sortingIdToColumn[defaultId])]
  );
};
