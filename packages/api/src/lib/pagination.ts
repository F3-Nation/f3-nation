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
 * Sanity bound on `pageSize`. Deliberately generous: it exists to keep
 * `pageIndex * pageSize` far from Number.MAX_SAFE_INTEGER (see
 * MAX_PAGE_INDEX), not to shape API usage — real callers request pages of
 * 500-10000 today, and omitting both fields still returns everything, so a
 * tight cap here would only push callers back to the unpaginated path.
 * Tightening this to a real product limit (router/user.ts uses 100) is a
 * deliberate contract change for a follow-up, alongside bounding the
 * unpaginated branch.
 */
export const MAX_PAGE_SIZE = 10_000;

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
 *
 * `unpaginatedBehavior` lets a route override the default "returns
 * everything" description when its own unpaginated branch doesn't actually
 * do that (event-instance.ts caps at 40 rows either way) — the published
 * OpenAPI contract should describe what the route does, not what most
 * routes do.
 */
export function paginationFields(
  entityPlural: string,
  unpaginatedBehavior = `returns all matching ${entityPlural} unpaginated (unchanged default)`,
) {
  return {
    pageIndex: z.coerce
      .number()
      .int()
      .min(0)
      .max(MAX_PAGE_INDEX)
      .optional()
      .describe(
        `Zero-based page index. Supplying this (or pageSize) opts into paginated results; omitting both ${unpaginatedBehavior}.`,
      ),
    pageSize: z.coerce
      .number()
      .int()
      .max(MAX_PAGE_SIZE)
      .optional()
      .describe(
        `Number of ${entityPlural} per page (max ${MAX_PAGE_SIZE}). Supplying this (or pageIndex) opts into paginated results; omitting both ${unpaginatedBehavior}.`,
      ),
  };
}
