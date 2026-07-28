import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  MAX_PAGE_INDEX,
  MAX_PAGE_SIZE,
  paginationFields,
  resolvePagination,
} from "./pagination";

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

  it("paginates when only pageIndex is supplied — either field is equally a request to paginate", () => {
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

// Imports the real fragment every one of the 11 call sites spreads into its
// own input schema (event.ts, event-instance.ts, event-tag.ts, event-type.ts,
// location.ts, map/event.ts, org.ts x2, position.ts, request.ts, lib/user.ts)
// — not a hand-copied mirror, so a regression at any of those 11 sites (or
// in this shared definition) actually fails this suite. user.byF3Name
// (router/user.ts) intentionally differs — it defaults and lower-bounds both
// fields, so it always paginates — and isn't covered by this fragment.
const paginationSchema = z.object(paginationFields("things"));

describe("pagination input schema (paginationFields)", () => {
  it("rejects a negative pageIndex — would otherwise produce a negative SQL OFFSET", () => {
    expect(paginationSchema.safeParse({ pageIndex: -1 }).success).toBe(false);
  });

  it("rejects a fractional pageIndex", () => {
    expect(paginationSchema.safeParse({ pageIndex: 2.5 }).success).toBe(false);
  });

  it("rejects a fractional pageSize", () => {
    expect(paginationSchema.safeParse({ pageSize: 1.5 }).success).toBe(false);
  });

  it("still accepts a negative pageSize — resolvePagination clamps it to defaultPageSize", () => {
    expect(paginationSchema.safeParse({ pageSize: -5 }).success).toBe(true);
  });

  it("accepts valid non-negative integers", () => {
    expect(
      paginationSchema.safeParse({ pageIndex: 3, pageSize: 20 }).success,
    ).toBe(true);
  });

  it("rejects a pageSize above MAX_PAGE_SIZE — an unbounded pageSize became reachable the moment pageSize-alone started opting into pagination", () => {
    expect(
      paginationSchema.safeParse({ pageSize: MAX_PAGE_SIZE }).success,
    ).toBe(true);
    expect(
      paginationSchema.safeParse({ pageSize: MAX_PAGE_SIZE + 1 }).success,
    ).toBe(false);
  });

  it("rejects a pageIndex above MAX_PAGE_INDEX — guards offset from overflowing on an adversarial request", () => {
    expect(
      paginationSchema.safeParse({ pageIndex: MAX_PAGE_INDEX }).success,
    ).toBe(true);
    expect(
      paginationSchema.safeParse({ pageIndex: MAX_PAGE_INDEX + 1 }).success,
    ).toBe(false);
  });
});
