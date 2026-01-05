/**
 * Tests for Ping Router endpoint
 *
 * The ping router is a simple health check that doesn't require authentication.
 */

import { describe, expect, it } from "vitest";
import { createTestClient } from "../__tests__/test-utils";

describe("Ping Router", () => {
  it("should return alive status and timestamp", async () => {
    const client = createTestClient();
    const result = await client.ping();

    expect(result).toHaveProperty("alive");
    expect(result.alive).toBe(true);
    expect(result).toHaveProperty("timestamp");
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it("should return a recent timestamp", async () => {
    const client = createTestClient();
    const before = new Date();
    const result = await client.ping();
    const after = new Date();

    const timestamp = new Date(result.timestamp);
    expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });
});
