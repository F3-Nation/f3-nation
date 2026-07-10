import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.includes("/health")) {
          return new Response(
            JSON.stringify({
              service: "f3-me",
              version: "test",
              contractVersion: "1.0.0",
              status: "ok",
              timestamp: "2026-07-09T12:00:00.000Z",
              durationMs: 10,
              checks: [
                {
                  id: "f3-api-upstream",
                  status: "ok",
                  severity: "critical",
                },
              ],
            }),
            { status: 200 },
          );
        }

        if (url.includes("slack-status.com/api/v2.0.0/current")) {
          return new Response(
            JSON.stringify({
              status: "ok",
              date_updated: "2026-07-09T12:00:00.000Z",
              active_incidents: [],
            }),
            { status: 200 },
          );
        }

        return new Response(JSON.stringify({ error: "unexpected url" }), {
          status: 404,
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
