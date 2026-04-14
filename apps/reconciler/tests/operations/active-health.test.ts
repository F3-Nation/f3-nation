/**
 * Unit tests for op 5 — active health monitoring.
 *
 * Covers:
 *   - happy-path probe success, per-region timestamp bump, counter reset
 *   - first probe failure (counter = 1, stays `active`)
 *   - second consecutive probe failure (counter = 2, transitions to degraded)
 *   - cert renewal escalation ladder T-14 / T-7 / T-1
 *   - monotonic escalation (already-T-7 never regresses to T-14)
 *   - parseCertExpiry pure helper
 *   - isDueForReprobe cadence filter
 *   - computeNextEscalationLevel pure helper
 */

import { describe, expect, it } from "vitest";

import type { OperationContext } from "../../src/operations/shared.js";
import type { SniProbeOpConfig } from "../../src/operations/sni-probe.js";
import type { SniProbeResult } from "../../src/probe/index.js";
import {
  CONSECUTIVE_FAILURE_THRESHOLD,
  computeNextEscalationLevel,
  isDueForReprobe,
  parseCertExpiry,
  reconcileOneActiveHealth,
  runActiveHealth,
} from "../../src/operations/active-health.js";
import { createFakeCertManager } from "../helpers/fake-cert-manager.js";
import { createFakeDb, makeRow, setStateGuard } from "../helpers/fake-db.js";
import { createFakeLogger } from "../helpers/fake-logger.js";

const NOW = new Date("2026-04-14T12:00:00Z");

function makeCtx(
  fake: ReturnType<typeof createFakeDb>,
  region = "us-central1",
): OperationContext & { logger: ReturnType<typeof createFakeLogger> } {
  const logger = createFakeLogger();
  return {
    db: fake.db,
    logger,
    reconcilerRunId: "run-active-health",
    region,
    certManager: createFakeCertManager(),
  };
}

function successResult(certValidTo: string | null): SniProbeResult {
  return {
    handshake_ok: true,
    http_status: 200,
    cert: certValidTo
      ? {
          serialNumber: "ABC123",
          validFrom: "2026-01-01T00:00:00Z",
          validTo: certValidTo,
          subjectCN: "f3marshall.com",
          issuerCN: "GTS",
        }
      : null,
    latency_ms: 42,
    redirect_platform_header_ok: true,
    error: null,
  };
}

const failureResult: SniProbeResult = {
  handshake_ok: false,
  http_status: null,
  cert: null,
  latency_ms: 1,
  redirect_platform_header_ok: false,
  error: "ECONNRESET",
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("parseCertExpiry", () => {
  it("parses a standard RFC-3339 date and computes days until expiry", () => {
    const parsed = parseCertExpiry("2026-05-14T12:00:00Z", NOW);
    expect(parsed).not.toBeNull();
    expect(parsed?.daysUntilExpiry).toBe(30);
  });

  it("parses an OpenSSL ASN.1 date string (`Dec 31 00:00:00 2026 GMT`)", () => {
    const parsed = parseCertExpiry("Dec 31 00:00:00 2026 GMT", NOW);
    expect(parsed).not.toBeNull();
    expect(parsed?.daysUntilExpiry).toBeGreaterThan(200);
  });

  it("returns null for garbage input", () => {
    expect(parseCertExpiry("not-a-date", NOW)).toBeNull();
    expect(parseCertExpiry(null, NOW)).toBeNull();
    expect(parseCertExpiry(undefined, NOW)).toBeNull();
  });
});

describe("isDueForReprobe", () => {
  it("returns true when lastReconciledAt is null", () => {
    expect(isDueForReprobe(null, NOW)).toBe(true);
  });

  it("returns false when lastReconciledAt is within the 10-minute window", () => {
    const fiveMinAgo = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString();
    expect(isDueForReprobe(fiveMinAgo, NOW)).toBe(false);
  });

  it("returns true when lastReconciledAt is older than 10 minutes", () => {
    const fifteenMinAgo = new Date(
      NOW.getTime() - 15 * 60 * 1000,
    ).toISOString();
    expect(isDueForReprobe(fifteenMinAgo, NOW)).toBe(true);
  });
});

describe("computeNextEscalationLevel", () => {
  it("returns T-14 for 13-days-out cert with no prior alert", () => {
    expect(computeNextEscalationLevel(13, undefined)).toBe("T-14");
  });

  it("returns T-7 for 6-days-out cert with no prior alert", () => {
    expect(computeNextEscalationLevel(6, undefined)).toBe("T-7");
  });

  it("returns T-1 for 0-days-out cert with no prior alert", () => {
    expect(computeNextEscalationLevel(0, undefined)).toBe("T-1");
  });

  it("is monotonic — an already-T-7 row does not regress to T-14", () => {
    expect(computeNextEscalationLevel(13, "T-7")).toBeNull();
  });

  it("escalates T-14 → T-7 when cert crosses the 7-day line", () => {
    expect(computeNextEscalationLevel(6, "T-14")).toBe("T-7");
  });

  it("escalates T-7 → T-1 when cert crosses the 1-day line", () => {
    expect(computeNextEscalationLevel(0, "T-7")).toBe("T-1");
  });

  it("returns null for a fresh cert (> 14 days)", () => {
    expect(computeNextEscalationLevel(30, undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Operation behaviour
// ---------------------------------------------------------------------------

describe("reconcileOneActiveHealth — probe success", () => {
  it("bumps per-region last_success and resets consecutive_probe_failures", async () => {
    const row = makeRow({
      id: "row-1",
      lifecycleState: "active",
      reconcilerError: { consecutive_probe_failures: 1 },
    });
    const fake = createFakeDb({ rows: [row] });
    const ctx = makeCtx(fake, "us-central1");

    await reconcileOneActiveHealth(
      ctx,
      { lbIpv4: "1.2.3.4" } as SniProbeOpConfig,
      row,
      {
        now: NOW,
        // Cert 30 days out — no escalation.
        probeFn: async () =>
          successResult(
            new Date(NOW.getTime() + 30 * 24 * 3600 * 1000).toISOString(),
          ),
      },
    );

    const updated = fake.state.rows[0];
    expect(updated?.probeRegionUsCentral1LastSuccess).toBe(NOW.toISOString());
    expect(updated?.lifecycleState).toBe("active");
    const blob = updated?.reconcilerError as {
      consecutive_probe_failures?: number;
    } | null;
    expect(blob?.consecutive_probe_failures).toBe(0);
  });
});

describe("reconcileOneActiveHealth — probe failure", () => {
  it("first failure increments counter to 1 and keeps row in active", async () => {
    const row = makeRow({
      id: "row-2",
      lifecycleState: "active",
      reconcilerError: null,
    });
    const fake = createFakeDb({ rows: [row] });
    const ctx = makeCtx(fake);

    await reconcileOneActiveHealth(
      ctx,
      { lbIpv4: "1.2.3.4" } as SniProbeOpConfig,
      row,
      {
        now: NOW,
        probeFn: async () => failureResult,
      },
    );

    const updated = fake.state.rows[0];
    expect(updated?.lifecycleState).toBe("active");
    const blob = updated?.reconcilerError as {
      consecutive_probe_failures?: number;
    } | null;
    expect(blob?.consecutive_probe_failures).toBe(1);
  });

  it("second consecutive failure transitions active → degraded with recoverable_from='active'", async () => {
    expect(CONSECUTIVE_FAILURE_THRESHOLD).toBe(2);
    const row = makeRow({
      id: "row-3",
      lifecycleState: "active",
      reconcilerError: { consecutive_probe_failures: 1 },
    });
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: "row-3", expectedState: "active" });
    const ctx = makeCtx(fake);

    await reconcileOneActiveHealth(
      ctx,
      { lbIpv4: "1.2.3.4" } as SniProbeOpConfig,
      row,
      {
        now: NOW,
        probeFn: async () => failureResult,
      },
    );

    const updated = fake.state.rows[0];
    expect(updated?.lifecycleState).toBe("degraded");
    const err = updated?.reconcilerError as {
      recoverable_from?: string;
      drift_kind?: string;
      consecutive_probe_failures?: number;
    } | null;
    expect(err?.recoverable_from).toBe("active");
    expect(err?.drift_kind).toBe("unexpected_state");
    expect(err?.consecutive_probe_failures).toBe(2);
    expect(ctx.logger.driftCalls.length).toBe(1);
    expect(
      fake.state.events.find(
        (e) => e.eventType === "reconciler.active_health_failed",
      ),
    ).toBeDefined();
  });
});

describe("reconcileOneActiveHealth — cert renewal escalation", () => {
  it("T-14 transitions to degraded and emits a WARNING (not CRITICAL)", async () => {
    const row = makeRow({
      id: "row-4",
      lifecycleState: "active",
      reconcilerError: null,
    });
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: "row-4", expectedState: "active" });
    const ctx = makeCtx(fake);
    const certExpiry = new Date(
      NOW.getTime() + 10 * 24 * 3600 * 1000,
    ).toISOString();

    await reconcileOneActiveHealth(
      ctx,
      { lbIpv4: "1.2.3.4" } as SniProbeOpConfig,
      row,
      {
        now: NOW,
        probeFn: async () => successResult(certExpiry),
      },
    );

    const updated = fake.state.rows[0];
    expect(updated?.lifecycleState).toBe("degraded");
    const err = updated?.reconcilerError as {
      cert_renewal_escalation_level?: string;
      recoverable_from?: string;
    } | null;
    expect(err?.cert_renewal_escalation_level).toBe("T-14");
    expect(err?.recoverable_from).toBe("active");
    // T-14 MUST NOT fire the CRITICAL certRenewal log (that's T-7+).
    expect(ctx.logger.certRenewalCalls.length).toBe(0);
    // It MUST emit some WARNING-level metadata with escalation_level=T-14.
    const warnLine = ctx.logger.warnCalls.find(
      (args) =>
        typeof args[1] === "object" &&
        args[1] !== null &&
        (args[1] as { escalation_level?: string }).escalation_level === "T-14",
    );
    expect(warnLine).toBeDefined();
  });

  it("T-7 transitions to degraded and emits CRITICAL certRenewal", async () => {
    const row = makeRow({
      id: "row-5",
      lifecycleState: "active",
      reconcilerError: null,
    });
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: "row-5", expectedState: "active" });
    const ctx = makeCtx(fake);
    const certExpiry = new Date(
      NOW.getTime() + 3 * 24 * 3600 * 1000,
    ).toISOString();

    await reconcileOneActiveHealth(
      ctx,
      { lbIpv4: "1.2.3.4" } as SniProbeOpConfig,
      row,
      {
        now: NOW,
        probeFn: async () => successResult(certExpiry),
      },
    );

    expect(fake.state.rows[0]?.lifecycleState).toBe("degraded");
    expect(ctx.logger.certRenewalCalls.length).toBe(1);
    const call = ctx.logger.certRenewalCalls[0]?.[0] as
      | { escalationLevel?: string }
      | undefined;
    expect(call?.escalationLevel).toBe("T-7");
  });

  it("T-1 fires CRITICAL certRenewal regardless of prior T-14 state", async () => {
    const row = makeRow({
      id: "row-6",
      lifecycleState: "active",
      // Row was already marked T-14 on a prior cycle but is still active.
      // In practice op 5 would have transitioned it on the T-14 cycle, but
      // the ladder itself must handle the case of a cert whose expiry has
      // jumped past the T-1 line without an intermediate cycle.
      reconcilerError: { cert_renewal_escalation_level: "T-14" },
    });
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: "row-6", expectedState: "active" });
    const ctx = makeCtx(fake);
    // 12 hours out — under 1 day.
    const certExpiry = new Date(NOW.getTime() + 12 * 3600 * 1000).toISOString();

    await reconcileOneActiveHealth(
      ctx,
      { lbIpv4: "1.2.3.4" } as SniProbeOpConfig,
      row,
      {
        now: NOW,
        probeFn: async () => successResult(certExpiry),
      },
    );

    expect(fake.state.rows[0]?.lifecycleState).toBe("degraded");
    const err = fake.state.rows[0]?.reconcilerError as {
      cert_renewal_escalation_level?: string;
    } | null;
    expect(err?.cert_renewal_escalation_level).toBe("T-1");
    expect(ctx.logger.certRenewalCalls.length).toBe(1);
  });
});

describe("runActiveHealth — cadence gate", () => {
  it("skips rows whose last_reconciled_at is within the 10-minute re-probe window", async () => {
    const fresh = makeRow({
      id: "row-7",
      lifecycleState: "active",
      lastReconciledAt: new Date(NOW.getTime() - 60_000).toISOString(),
    });
    const fake = createFakeDb({ rows: [fresh] });
    let probeCalls = 0;
    await runActiveHealth(
      {
        db: fake.db,
        logger: createFakeLogger(),
        reconcilerRunId: "run-a",
        region: "us-central1",
        certManager: createFakeCertManager(),
      },
      {
        lbIpv4: "1.2.3.4",
        now: () => NOW,
        probeFn: async () => {
          probeCalls += 1;
          return failureResult;
        },
      },
    );
    expect(probeCalls).toBe(0);
  });
});
