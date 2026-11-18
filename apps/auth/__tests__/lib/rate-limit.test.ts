import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rateLimit } from "../../src/lib/rate-limit";

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts down, then refuses once the limit is spent", () => {
    expect(rateLimit("spend", 2, 60_000)).toEqual({
      allowed: true,
      remaining: 1,
    });
    expect(rateLimit("spend", 2, 60_000)).toEqual({
      allowed: true,
      remaining: 0,
    });
    expect(rateLimit("spend", 2, 60_000)).toEqual({
      allowed: false,
      remaining: 0,
    });
  });

  it("starts a fresh window after the old one expires", () => {
    rateLimit("window", 1, 60_000);
    expect(rateLimit("window", 1, 60_000).allowed).toBe(false);

    vi.advanceTimersByTime(60_001);

    expect(rateLimit("window", 1, 60_000)).toEqual({
      allowed: true,
      remaining: 0,
    });
  });

  it("keeps separate counts per key", () => {
    rateLimit("key-a", 1, 60_000);
    expect(rateLimit("key-a", 1, 60_000).allowed).toBe(false);
    expect(rateLimit("key-b", 1, 60_000).allowed).toBe(true);
  });
});
