import { describe, expect, it } from "vitest";
import { z } from "zod";

import { resolvePagination } from "./pagination";

/**
 * Mirrors the pageIndex/pageSize schema fragment applied at every one of
 * the 11 resolvePagination call sites (event.ts, event-instance.ts,
 * event-tag.ts, event-type.ts, location.ts, map/event.ts, org.ts x2,
 * position.ts, request.ts, lib/user.ts). resolvePagination itself trusts
 * its inputs — rejecting negative/fractional values is the schema's job,
 * not this function's, so it's covered here rather than above.
 */
const paginationInputSchema = z.object({
  pageIndex: z.coerce.number().int().min(0).optional(),
  pageSize: z.coerce.number().int().optional(),
});

describe("resolvePagination", () => {
  it("does not paginate when neither pageSize nor pageIndex is supplied", () => {
    const result = resolvePagination({ defaultPageSize: 10 });
    expect(result.usePagination).toBe(false);
    expect(result.limit).toBe(10);
    expect(result.offset).toBe(0);
  });

  it("paginates when only pageSize is supplied", () => {
    const result = resolvePagination({ pageSize: 25, defaultPageSize: 10 });
    expect(result.usePagination).toBe(true);
    expect(result.limit).toBe(25);
    expect(result.offset).toBe(0);
  });

  it("paginates when only pageIndex is supplied — the bug this fixes", () => {
    // Before PR #696's fix, pageIndex alone silently returned every row
    // instead of the requested page.
    const result = resolvePagination({ pageIndex: 3, defaultPageSize: 10 });
    expect(result.usePagination).toBe(true);
    expect(result.limit).toBe(10);
    expect(result.offset).toBe(30);
  });

  it("paginates when both pageSize and pageIndex are supplied", () => {
    const result = resolvePagination({
      pageSize: 20,
      pageIndex: 2,
      defaultPageSize: 10,
    });
    expect(result.usePagination).toBe(true);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(40);
  });

  it("computes offset from pageIndex * the resolved limit, not the default", () => {
    const result = resolvePagination({
      pageSize: 5,
      pageIndex: 4,
      defaultPageSize: 10,
    });
    expect(result.offset).toBe(20); // 4 * 5, not 4 * 10
  });

  it("clamps pageSize=0 up to defaultPageSize instead of producing LIMIT 0", () => {
    const result = resolvePagination({ pageSize: 0, defaultPageSize: 10 });
    expect(result.usePagination).toBe(true);
    expect(result.limit).toBe(10);
  });

  it("clamps a negative pageSize up to defaultPageSize", () => {
    const result = resolvePagination({ pageSize: -5, defaultPageSize: 10 });
    expect(result.limit).toBe(10);
  });

  it("defaults pageIndex to 0 when only pageSize is supplied", () => {
    const result = resolvePagination({ pageSize: 15, defaultPageSize: 10 });
    expect(result.offset).toBe(0);
  });
});

describe("pagination input schema", () => {
  it("rejects a negative pageIndex — would otherwise produce a negative SQL OFFSET", () => {
    const result = paginationInputSchema.safeParse({ pageIndex: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a fractional pageIndex", () => {
    const result = paginationInputSchema.safeParse({ pageIndex: 2.5 });
    expect(result.success).toBe(false);
  });

  it("rejects a fractional pageSize", () => {
    const result = paginationInputSchema.safeParse({ pageSize: 1.5 });
    expect(result.success).toBe(false);
  });

  it("still accepts a negative pageSize — resolvePagination clamps it to defaultPageSize", () => {
    const result = paginationInputSchema.safeParse({ pageSize: -5 });
    expect(result.success).toBe(true);
  });

  it("accepts valid non-negative integers", () => {
    const result = paginationInputSchema.safeParse({
      pageIndex: 3,
      pageSize: 20,
    });
    expect(result.success).toBe(true);
  });
});
