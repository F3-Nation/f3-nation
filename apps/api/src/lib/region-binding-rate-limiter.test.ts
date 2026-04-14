import { describe, expect, it } from "vitest";

import { createRegionBindingRateLimiter } from "./region-binding-rate-limiter";

describe("createRegionBindingRateLimiter", () => {
  it("allows up to maxRequests per window for a single caller", () => {
    const limiter = createRegionBindingRateLimiter({
      maxRequests: 3,
      windowMs: 10_000,
      now: () => 1_000,
    });
    expect(limiter.check(42).allowed).toBe(true);
    expect(limiter.check(42).allowed).toBe(true);
    expect(limiter.check(42).allowed).toBe(true);
    const denied = limiter.check(42);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("isolates callers from each other", () => {
    const limiter = createRegionBindingRateLimiter({
      maxRequests: 1,
      windowMs: 10_000,
      now: () => 1_000,
    });
    expect(limiter.check(1).allowed).toBe(true);
    expect(limiter.check(2).allowed).toBe(true);
    expect(limiter.check(1).allowed).toBe(false);
    expect(limiter.check(2).allowed).toBe(false);
  });

  it("resets the bucket after the window elapses", () => {
    let currentMs = 0;
    const limiter = createRegionBindingRateLimiter({
      maxRequests: 1,
      windowMs: 10_000,
      now: () => currentMs,
    });
    expect(limiter.check("user").allowed).toBe(true);
    expect(limiter.check("user").allowed).toBe(false);
    currentMs = 10_001;
    expect(limiter.check("user").allowed).toBe(true);
  });

  it("defaults to 60 rpm when no options are supplied", () => {
    const limiter = createRegionBindingRateLimiter({ now: () => 0 });
    for (let i = 0; i < 60; i += 1) {
      expect(limiter.check(1).allowed).toBe(true);
    }
    expect(limiter.check(1).allowed).toBe(false);
  });
});
