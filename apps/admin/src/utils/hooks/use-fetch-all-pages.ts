import { useQuery } from "~/orpc/react";

// Must match packages/api/src/lib/pagination.ts's MAX_PAGE_SIZE — not
// imported directly since @acme/api doesn't export its internal pagination
// helpers from its public surface.
const MAX_PAGE_SIZE = 100;

/**
 * Fetches every page of a paginated oRPC list endpoint and flattens the
 * result into one array — for the handful of admin dropdowns that
 * genuinely need the complete list (all editable orgs, all event types),
 * not a page of it. Keeps every API route safely bounded server-side
 * (see pagination.ts) instead of relying on an unbounded "omit both
 * params" escape hatch that isn't safe for every entity type.
 */
export function useFetchAllPages<TItem>(params: {
  queryKey: unknown[];
  fetchPage: (page: {
    pageIndex: number;
    pageSize: number;
  }) => Promise<{ items: TItem[]; total: number }>;
  enabled?: boolean;
  throwOnError?: boolean;
}) {
  const { queryKey, fetchPage, enabled = true, throwOnError } = params;
  return useQuery({
    queryKey,
    enabled,
    throwOnError,
    queryFn: async () => {
      const pageSize = MAX_PAGE_SIZE;
      const all: TItem[] = [];
      let pageIndex = 0;
      for (;;) {
        const { items, total } = await fetchPage({ pageIndex, pageSize });
        all.push(...items);
        if (all.length >= total || items.length < pageSize) break;
        pageIndex++;
      }
      return all;
    },
  });
}
