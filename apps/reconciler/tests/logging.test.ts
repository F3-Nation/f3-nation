import { describe, expect, it } from "vitest";

import { createLogger } from "../src/logging.js";

/**
 * The log shapes asserted here are an interop contract with the F3R5_003
 * alert_policies.tf filter expressions:
 *
 *   severity=CRITICAL
 *   jsonPayload.labels.redirect_platform_drift="true"
 *   jsonPayload.labels.redirect_platform_stuck_operation="true"
 *   jsonPayload.labels.redirect_platform_cert_renewal="true"
 *
 * Cloud Logging lifts top-level stdout JSON fields into `jsonPayload`, so
 * emitting `labels.redirect_platform_*="true"` at the top of the stdout
 * object yields `jsonPayload.labels.redirect_platform_*="true"` on the
 * Cloud Logging entry, which is what the alert filters match.
 */

type LogEntry = Record<string, unknown>;

function capture(): {
  lines: string[];
  emit: (line: string) => void;
} {
  const lines: string[] = [];
  return {
    lines,
    emit: (line) => {
      lines.push(line);
    },
  };
}

function parseLog(line: string | undefined): LogEntry {
  if (line === undefined) {
    throw new Error("parseLog: expected a captured log line but got undefined");
  }
  return JSON.parse(line) as LogEntry;
}

const baseContext = {
  instanceId: "us-central1-exec-abc-task0-deadbe",
  region: "us-central1",
  runId: "run-1234",
};

describe("createLogger basic severities", () => {
  it("emits INFO/WARNING/ERROR/CRITICAL with instance+region metadata", () => {
    const { lines, emit } = capture();
    const log = createLogger({ context: baseContext, emit });

    log.info("info msg");
    log.warn("warn msg");
    log.error("error msg");
    log.critical("critical msg");

    expect(lines).toHaveLength(4);
    const entries = lines.map((l) => parseLog(l));
    expect(entries[0]).toMatchObject({
      severity: "INFO",
      message: "info msg",
      reconciler_instance_id: baseContext.instanceId,
      reconciler_region: baseContext.region,
      reconciler_run_id: baseContext.runId,
    });
    expect(entries[1]).toMatchObject({ severity: "WARNING" });
    expect(entries[2]).toMatchObject({ severity: "ERROR" });
    expect(entries[3]).toMatchObject({ severity: "CRITICAL" });
  });

  it("ignores reserved fields in extras so the contract is preserved", () => {
    const { lines, emit } = capture();
    const log = createLogger({ context: baseContext, emit });
    log.info("hello", {
      severity: "HACKED",
      message: "HACKED",
      labels: { redirect_platform_drift: "true" },
      custom: "ok",
    });
    const entry = parseLog(lines[0]);
    expect(entry.severity).toBe("INFO");
    expect(entry.message).toBe("hello");
    expect(entry.labels).toBeUndefined();
    expect(entry.custom).toBe("ok");
  });
});

describe("log.drift — redirect_platform_drift label contract", () => {
  it("emits severity=CRITICAL with labels.redirect_platform_drift='true'", () => {
    const { lines, emit } = capture();
    const log = createLogger({ context: baseContext, emit });
    log.drift({
      domainId: "abc123",
      driftKind: "spec_mismatch",
      resourceType: "Certificate",
      resourceName: "cert-abc123",
      observedSpec: { managed: { state: "FAILED" } },
      expectedSpec: { managed: { state: "ACTIVE" } },
      recoverableFrom: "awaiting_dns_challenge",
    });

    expect(lines).toHaveLength(1);
    const entry = parseLog(lines[0]);
    expect(entry.severity).toBe("CRITICAL");
    expect(entry.labels).toEqual({
      redirect_platform_drift: "true",
      domain_id: "abc123",
    });
    expect(entry.drift_kind).toBe("spec_mismatch");
    expect(entry.resource_type).toBe("Certificate");
    expect(entry.resource_name).toBe("cert-abc123");
    expect(entry.domain_id).toBe("abc123");
    expect(entry.observed_spec).toEqual({ managed: { state: "FAILED" } });
    expect(entry.expected_spec).toEqual({ managed: { state: "ACTIVE" } });
    expect(entry.recoverable_from).toBe("awaiting_dns_challenge");
  });
});

describe("log.stuckOperation — redirect_platform_stuck_operation label contract", () => {
  it("emits severity=CRITICAL with labels.redirect_platform_stuck_operation='true'", () => {
    const { lines, emit } = capture();
    const log = createLogger({ context: baseContext, emit });
    log.stuckOperation({
      operationName: "processTransientStates",
      lastLeaseExtendedAt: "2026-04-14T10:30:00.000Z",
    });

    expect(lines).toHaveLength(1);
    const entry = parseLog(lines[0]);
    expect(entry.severity).toBe("CRITICAL");
    expect(entry.labels).toEqual({
      redirect_platform_stuck_operation: "true",
    });
    expect(entry.operation_name).toBe("processTransientStates");
    expect(entry.last_lease_extended_at).toBe("2026-04-14T10:30:00.000Z");
  });

  it("carries domain_id through labels and payload when provided", () => {
    const { lines, emit } = capture();
    const log = createLogger({ context: baseContext, emit });
    log.stuckOperation({
      operationName: "cert-issuance",
      lastLeaseExtendedAt: "2026-04-14T10:30:00.000Z",
      domainId: "dom-xyz",
    });
    const entry = parseLog(lines[0]);
    expect(entry.labels).toMatchObject({ domain_id: "dom-xyz" });
    expect(entry.domain_id).toBe("dom-xyz");
  });
});

describe("log.certRenewal — redirect_platform_cert_renewal label contract", () => {
  it("emits severity=CRITICAL with labels.redirect_platform_cert_renewal='true'", () => {
    const { lines, emit } = capture();
    const log = createLogger({ context: baseContext, emit });
    log.certRenewal({
      domainId: "dom-abc",
      daysUntilExpiry: 1,
      escalationLevel: "T-1",
    });
    const entry = parseLog(lines[0]);
    expect(entry.severity).toBe("CRITICAL");
    expect(entry.labels).toEqual({
      redirect_platform_cert_renewal: "true",
      domain_id: "dom-abc",
      escalation_level: "T-1",
    });
    expect(entry.days_until_expiry).toBe(1);
  });
});
