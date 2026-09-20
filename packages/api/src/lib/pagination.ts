import { z } from "zod";

/**
 * Resolves the limit/offset/opt-in flag shared by every paginated list
 * endpoint in this API.
 *
 * Supplying EITHER `pageSize` or `pageIndex` opts into pagination — both are
 * equally a request to paginate; requiring both meant a caller who asked
 * for a specific page (pageIndex alone) silently received every row.
 *
 * `pageSize=0` is clamped up to `defaultPageSize` rather than producing a
 * silent `LIMIT 0`: `z.coerce.number()` turns an empty query param
 * (`?pageSize=`) into 0, and no caller means "give me zero rows".
 *
 * Trusts its inputs are already validated non-negative integers — bounding
 * them (including the upper bound that prevents `offset` from overflowing
 * on an adversarial `pageIndex`) is the schema's job, via
 * {@link paginationFields}, not this function's.
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

/**
 * Product limit on `pageSize`, not just an overflow guard. No internal
 * caller in this repo requests more than this per page (verified directly
 * against the codebase, not assumed) — the two admin dropdowns that used to
 * request 200/1000 "everything in one page" now page through results via
 * `useFetchAllPages` (apps/admin, apps/map) instead, which itself fetches in
 * pages of exactly this size, so the two must stay in sync. Also matches
 * MAX_PAGE_INDEX in keeping `pageIndex * pageSize` far from
 * Number.MAX_SAFE_INTEGER.
 */
export const MAX_PAGE_SIZE = 100;

/**
 * Upper bound on `pageIndex`. Generous relative to any real dataset (even at
 * MAX_PAGE_SIZE that's 10M+ rows of headroom) — exists only to keep
 * `pageIndex * pageSize` from approaching Number.MAX_SAFE_INTEGER and
 * producing a nonsensical OFFSET on an adversarial request.
 */
export const MAX_PAGE_INDEX = 100_000;

/**
 * The pageIndex/pageSize schema fragment every `resolvePagination` call site
 * should spread into its input schema — the single source of truth these
 * fields validate against, so a test importing it (rather than a hand-copied
 * mirror) actually exercises what each route runs.
 */
export function paginationFields(entityPlural: string) {
  return {
    pageIndex: z.coerce
      .number()
      .int()
      .min(0)
      .max(MAX_PAGE_INDEX)
      .optional()
      .describe(
        `Zero-based page index. Supplying this (or pageSize) opts into paginated results; omitting both still returns a single default-sized page of ${entityPlural}, not every matching row.`,
      ),
    pageSize: z.coerce
      .number()
      .int()
      .max(MAX_PAGE_SIZE)
      .optional()
      .describe(
        `Number of ${entityPlural} per page (max ${MAX_PAGE_SIZE}). Supplying this (or pageIndex) opts into paginated results; omitting both still returns a single default-sized page of ${entityPlural}, not every matching row.`,
      ),
  };
}
