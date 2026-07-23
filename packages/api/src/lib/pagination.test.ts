import { describe, expect, it } from "vitest";

import { resolvePagination } from "./pagination";

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
