/**
 * Tests for rate limiting middleware in shared.ts
 *
 * Tests the base middleware that applies rate limiting to all API requests.
 */

import { createRouterClient } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the MemoryRatelimiter before importing shared.ts
const mockLimit = vi.fn();
const maxRequests = 10;
// const maxRequests = 200;

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn().mockImplementation(() => ({
    limit: mockLimit,
  })),
}));

// Helper to create a test client with custom headers
const createTestClientWithHeaders = async (headers: Headers) => {
  const { publicProcedure } = await import("./shared");

  // Create a simple test router
  const testRouter = {
    test: publicProcedure.handler(() => ({ message: "success" })),
  };

  return createRouterClient(testRouter, {
    context: () => ({
      reqHeaders: headers,
    }),
  });
};

describe("Rate Limiting Middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("should allow request when rate limit is not exceeded", async () => {
    // Setup: limiter returns success
    mockLimit.mockResolvedValue({
      success: true,
      limit: maxRequests,
      remaining: 9,
      reset: Date.now() + 60000,
    });

    const mockHeaders = new Headers({
      "x-forwarded-for": "192.168.1.1",
    });

    const client = await createTestClientWithHeaders(mockHeaders);
    const result = await client.test();

    expect(result).toEqual({ message: "success" });
    expect(mockLimit).toHaveBeenCalledWith("192.168.1.1");
  });

  it("should use x-real-ip when x-forwarded-for is not present", async () => {
    mockLimit.mockResolvedValue({
      success: true,
      limit: maxRequests,
      remaining: 9,
      reset: Date.now() + 60000,
    });

    const mockHeaders = new Headers({
      "x-real-ip": "10.0.0.1",
    });

    const client = await createTestClientWithHeaders(mockHeaders);
    await client.test();

    expect(mockLimit).toHaveBeenCalledWith("10.0.0.1");
  });

  it("should use 'anonymous' when no IP headers are present", async () => {
    mockLimit.mockResolvedValue({
      success: true,
      limit: maxRequests,
      remaining: 9,
      reset: Date.now() + 60000,
    });

    const mockHeaders = new Headers();

    const client = await createTestClientWithHeaders(mockHeaders);
    await client.test();

    expect(mockLimit).toHaveBeenCalledWith("anonymous");
  });

  it("should throw TOO_MANY_REQUESTS error when rate limit is exceeded", async () => {
    const resetTime = Date.now() + 30000; // 30 seconds from now
    mockLimit.mockResolvedValue({
      success: false,
      limit: maxRequests,
      remaining: 0,
      reset: resetTime,
    });

    const mockHeaders = new Headers({
      "x-forwarded-for": "192.168.1.1",
    });

    const client = await createTestClientWithHeaders(mockHeaders);

    try {
      await client.test();
      expect.fail("Expected error to be thrown");
    } catch (error) {
      expect((error as Error).message).toMatch(/Rate limit exceeded/);
      expect((error as Error).message).toMatch(/Try again in \d+s/);
    }
  });

  it("should use fallback retry time when reset is not provided", async () => {
    mockLimit.mockResolvedValue({
      success: false,
      limit: maxRequests,
      remaining: 0,
      // No reset time provided
    });

    const mockHeaders = new Headers({
      "x-forwarded-for": "192.168.1.1",
    });

    const client = await createTestClientWithHeaders(mockHeaders);

    try {
      await client.test();
      expect.fail("Expected error to be thrown");
    } catch (error) {
      // Should use fallback of 60 seconds
      expect((error as Error).message).toMatch(/Try again in 60s/);
    }
  });

  it("should prefer x-forwarded-for over x-real-ip", async () => {
    mockLimit.mockResolvedValue({
      success: true,
      limit: maxRequests,
      remaining: 9,
      reset: Date.now() + 60000,
    });

    const mockHeaders = new Headers({
      "x-forwarded-for": "192.168.1.1",
      "x-real-ip": "10.0.0.1",
    });

    const client = await createTestClientWithHeaders(mockHeaders);
    await client.test();

    expect(mockLimit).toHaveBeenCalledWith("192.168.1.1");
  });
});
