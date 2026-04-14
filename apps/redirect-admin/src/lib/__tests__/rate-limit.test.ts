import { describe, expect, it } from "vitest";

import { createTokenBucket } from "../rate-limit";

describe("createTokenBucket", () => {
  it("allows capacity tokens then refuses", () => {
    const clock = { t: 0 };
    const b = createTokenBucket({
      capacity: 10,
      refillRatePerSecond: 10 / 60,
      now: () => clock.t,
    });
    for (let i = 0; i < 10; i++) {
      expect(b.tryConsume("alice")).toBe(true);
    }
    expect(b.tryConsume("alice")).toBe(false);
  });

  it("refills over time", () => {
    const clock = { t: 0 };
    const b = createTokenBucket({
      capacity: 10,
      refillRatePerSecond: 10 / 60, // 10 per minute
      now: () => clock.t,
    });
    for (let i = 0; i < 10; i++) b.tryConsume("bob");
    expect(b.tryConsume("bob")).toBe(false);
    // advance 6s → 1 token refilled
    clock.t = 6_000;
    expect(b.tryConsume("bob")).toBe(true);
    expect(b.tryConsume("bob")).toBe(false);
  });

  it("per-key isolation", () => {
    const b = createTokenBucket({
      capacity: 1,
      refillRatePerSecond: 0,
      now: () => 0,
    });
    expect(b.tryConsume("a")).toBe(true);
    expect(b.tryConsume("b")).toBe(true);
    expect(b.tryConsume("a")).toBe(false);
    expect(b.tryConsume("b")).toBe(false);
  });
});
