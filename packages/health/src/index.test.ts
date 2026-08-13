import { describe, expect, it } from "vitest";

import {
  HEALTH_CONTRACT_VERSION,
  buildHealthResponse,
  healthCheckSchema,
  healthResponseSchema,
  runChecks,
  summarizeStatus,
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

  it("normalizes thrown check errors without exposing exception messages or stack traces", async () => {
    const checks = await runChecks([
      {
        id: "throws-error",
        defaultSeverity: "critical",
        run: () => {
          throw new Error("db-password=super-secret");
        },
      },
    ]);

    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      id: "throws-error",
      status: "down",
      severity: "critical",
      message: "Check failed",
      details: { reason: "error" },
    });
    // Raw exception messages and stack traces must not appear in the payload.
    expect(JSON.stringify(checks[0]?.details)).not.toContain("super-secret");
    expect(
      (checks[0]?.details as { stack?: string } | undefined)?.stack,
    ).toBeUndefined();
    expect(
      (checks[0]?.details as { error?: string } | undefined)?.error,
    ).toBeUndefined();
  });

  it("marks timed out checks as down with timeout details", async () => {
    const checks = await runChecks([
      {
        id: "slow-check",
        timeoutMs: 5,
        defaultSeverity: "warning",
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { status: "ok" as const };
        },
      },
    ]);

    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      id: "slow-check",
      status: "down",
      severity: "warning",
      message: "Check timed out",
      details: { reason: "timeout", timeoutMs: 5 },
    });
  });

  it("summarizeStatus treats degraded+critical as degraded, not down", () => {
    const status = summarizeStatus([
      { id: "db", status: "degraded", severity: "critical" },
    ]);

    expect(status).toBe("degraded");
  });

  it("summarizeStatus returns down for critical failures", () => {
    const status = summarizeStatus([
      { id: "db", status: "down", severity: "critical" },
      { id: "cache", status: "ok", severity: "warning" },
    ]);

    expect(status).toBe("down");
  });

  it("summarizeStatus returns degraded for non-critical failures", () => {
    const status = summarizeStatus([
      { id: "upstream", status: "down", severity: "warning" },
    ]);

    expect(status).toBe("degraded");
  });

  it("summarizeStatus returns ok when all checks are ok", () => {
    const status = summarizeStatus([
      { id: "db", status: "ok", severity: "critical" },
      { id: "cache", status: "ok", severity: "warning" },
    ]);

    expect(status).toBe("ok");
  });

  it("runChecks passes through runner-provided severity, message, and details", async () => {
    const checks = await runChecks([
      {
        id: "latency-check",
        defaultSeverity: "critical",
        run: () => ({
          status: "degraded" as const,
          severity: "info" as const,
          message: "p99 latency spike",
          details: { p99Ms: 450, threshold: 300 },
        }),
      },
    ]);

    expect(checks[0]).toMatchObject({
      id: "latency-check",
      status: "degraded",
      severity: "info",
      message: "p99 latency spike",
      details: { p99Ms: 450, threshold: 300 },
    });
  });

  it("buildHealthResponse sets contractVersion, timestamp, and durationMs", () => {
    const startedAt = Date.now() - 20;
    const response = buildHealthResponse({
      service: "f3-me",
      version: "1.2.3+abc123",
      startedAt,
      checks: [{ id: "db", status: "ok", severity: "critical" }],
    });

    expect(response.contractVersion).toBe(HEALTH_CONTRACT_VERSION);
    expect(new Date(response.timestamp).toString()).not.toBe("Invalid Date");
    expect(response.durationMs).toBeGreaterThanOrEqual(0);
    expect(response.status).toBe("ok");
  });
});
