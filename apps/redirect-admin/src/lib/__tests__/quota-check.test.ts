import { describe, it, expect, vi } from "vitest";

import { checkQuota, DEFAULT_MAX_DOMAINS_PER_ORG } from "../quota-check";
import type { QuotaDbRunner } from "../quota-check";

/**
 * Tiny fake DB. The `select()` chain swaps implementations across calls
 * so we can model the two queries `checkQuota` makes (max_domains, count).
 */
function fakeDb(params: {
  quotaRows: { value: number }[];
  countRows: { value: number }[];
}): QuotaDbRunner {
  let call = 0;
  const runner = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => {
          call += 1;
          return call === 1 ? params.quotaRows : params.countRows;
        }),
      })),
    })),
  };
  return runner as unknown as QuotaDbRunner;
}

describe("checkQuota", () => {
  it("allows when current < explicit max", async () => {
    const db = fakeDb({
      quotaRows: [{ value: 25 }],
      countRows: [{ value: 3 }],
    });
    const result = await checkQuota(db, 42);
    expect(result).toEqual({
      allowed: true,
      current: 3,
      max: 25,
      source: "explicit",
    });
  });

  it("falls back to default max when no quota row", async () => {
    const db = fakeDb({
      quotaRows: [],
      countRows: [{ value: 0 }],
    });
    const result = await checkQuota(db, 1);
    expect(result.max).toBe(DEFAULT_MAX_DOMAINS_PER_ORG);
    expect(result.source).toBe("default");
    expect(result.allowed).toBe(true);
  });

  it("rejects when current equals max", async () => {
    const db = fakeDb({
      quotaRows: [{ value: 10 }],
      countRows: [{ value: 10 }],
    });
    const result = await checkQuota(db, 1);
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(10);
    expect(result.max).toBe(10);
  });

  it("rejects when current exceeds max (race with another inserter)", async () => {
    const db = fakeDb({
      quotaRows: [{ value: 5 }],
      countRows: [{ value: 6 }],
    });
    const result = await checkQuota(db, 1);
    expect(result.allowed).toBe(false);
  });

  it("defaults current to 0 when count returns nothing", async () => {
    const db = fakeDb({
      quotaRows: [{ value: 10 }],
      countRows: [],
    });
    const result = await checkQuota(db, 1);
    expect(result.current).toBe(0);
    expect(result.allowed).toBe(true);
  });

  it("coerces count strings to numbers", async () => {
    // Postgres count() comes back as string unless cast; we call ::int
    // in the query but defend against legacy behavior in the helper too.
    const db = fakeDb({
      quotaRows: [{ value: 10 }],
      countRows: [{ value: "4" as unknown as number }],
    });
    const result = await checkQuota(db, 1);
    expect(result.current).toBe(4);
    expect(result.allowed).toBe(true);
  });
});
