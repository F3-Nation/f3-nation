/**
 * Resolves the limit/offset/opt-in flag shared by every paginated list
 * endpoint in this API.
 *
 * A caller opts into pagination by supplying EITHER `pageSize` or
 * `pageIndex` — requiring both was the original bug (F3-Nation/f3-nation
 * PR #696): a caller who sent only `pageIndex` (explicitly asking for a
 * specific page) silently got every row back, exactly like one who sent
 * only `pageSize` did before that PR. Both are equally a request to
 * paginate.
 *
 * `pageSize=0` is clamped up to `defaultPageSize` rather than producing a
 * silent `LIMIT 0` — no caller means "give me zero rows" by passing
 * `pageSize=0`; it's a zod-coerced default that was never actually applied.
 */
export function resolvePagination(params: {
  pageSize?: number;
  pageIndex?: number;
  defaultPageSize: number;
}): { limit: number; offset: number; usePagination: boolean } {
  const { pageSize, pageIndex, defaultPageSize } = params;
  const usePagination = pageSize !== undefined || pageIndex !== undefined;
  const limit =
    pageSize !== undefined && pageSize > 0 ? pageSize : defaultPageSize;
  const offset = (pageIndex ?? 0) * limit;
  return { limit, offset, usePagination };
}
