import { describe, expect, it } from "vitest";

import {
  HEALTH_CONTRACT_VERSION,
  healthCheckSchema,
  healthResponseSchema,
} from "./index";

describe("health contract schemas", () => {
  it("accepts a valid v1 health response", () => {
    const parsed = healthResponseSchema.safeParse({
      service: "example-service",
      version: "2026.05.03+abc1234",
      contractVersion: HEALTH_CONTRACT_VERSION,
      status: "degraded",
      timestamp: "2026-05-03T14:20:09.120Z",
      durationMs: 42,
      checks: [
        {
          id: "primary-database",
          status: "ok",
          severity: "critical",
          latencyMs: 15,
        },
        {
          id: "upstream-api",
          status: "degraded",
          message: "Latency exceeded warning threshold",
        },
      ],
      notes: ["Non-critical latency increase in upstream dependency"],
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects responses with an invalid top-level status", () => {
    const parsed = healthResponseSchema.safeParse({
      service: "example-service",
      version: "2026.05.03+abc1234",
      contractVersion: HEALTH_CONTRACT_VERSION,
      status: "healthy",
      timestamp: "2026-05-03T14:20:09.120Z",
      durationMs: 42,
      checks: [{ id: "db", status: "ok" }],
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects responses with a negative duration", () => {
    const parsed = healthResponseSchema.safeParse({
      service: "example-service",
      version: "2026.05.03+abc1234",
      contractVersion: HEALTH_CONTRACT_VERSION,
      status: "ok",
      timestamp: "2026-05-03T14:20:09.120Z",
      durationMs: -1,
      checks: [{ id: "db", status: "ok" }],
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects responses with no checks", () => {
    const parsed = healthResponseSchema.safeParse({
      service: "example-service",
      version: "2026.05.03+abc1234",
      contractVersion: HEALTH_CONTRACT_VERSION,
      status: "ok",
      timestamp: "2026-05-03T14:20:09.120Z",
      durationMs: 42,
      checks: [],
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects responses with a non-ISO timestamp", () => {
    const parsed = healthResponseSchema.safeParse({
      service: "example-service",
      version: "2026.05.03+abc1234",
      contractVersion: HEALTH_CONTRACT_VERSION,
      status: "ok",
      timestamp: "05/03/2026 14:20:09",
      durationMs: 42,
      checks: [{ id: "db", status: "ok" }],
    });

    expect(parsed.success).toBe(false);
  });

  it("defaults check severity to warning when omitted", () => {
    const parsed = healthCheckSchema.parse({
      id: "upstream-api",
      status: "degraded",
    });

    expect(parsed.severity).toBe("warning");
  });
});
