import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLimit = vi.hoisted(() => vi.fn());

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mockLimit };
  }),
}));

import { createTestClient } from "../__tests__/test-utils";

describe("Status Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60000,
    });
  });

  it("returns aggregated status payload", async () => {
    const client = createTestClient();

    const result = await client.status();

    expect(result.ttlSeconds).toBe(60);
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.generatedAt).toBeTruthy();
  });
});
