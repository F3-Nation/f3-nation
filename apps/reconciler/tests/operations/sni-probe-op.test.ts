/**
 * Unit tests for the SNI probe *operation* (op 3) — the state-machine
 * wrapper. The underlying probe implementation is exercised separately in
 * `tests/probe/sni-probe.test.ts` with a real in-process TLS server.
 */

import { describe, expect, it } from "vitest";

import type { CertManagerClient } from "../../src/gcp/cert-manager-client.js";
import {
  MissingLbIpError,
  bothRegionsFresh,
  loadSniProbeConfig,
  reconcileOneSniProbe,
} from "../../src/operations/sni-probe.js";
import type { SniProbeOpConfig } from "../../src/operations/sni-probe.js";
import type { OperationContext } from "../../src/operations/shared.js";
import type { SniProbeResult } from "../../src/probe/index.js";
import { createFakeDb, makeRow, setStateGuard } from "../helpers/fake-db.js";
import { createFakeLogger } from "../helpers/fake-logger.js";

function certManagerStub(): CertManagerClient {
  return {
    dnsAuthorizationResourcePath: (id) => `dns-${id}`,
    certificateResourcePath: (id) => `cert-${id}`,
    async getDnsAuthorization() {
      return null;
    },
    async getCertificate() {
      throw new Error("not used by op 3");
    },
    async createCertificate() {},
    async getCertificateMapEntry() {
      return null;
    },
    async createCertificateMapEntry() {},
  };
}

function makeCtx(
  fakeDb: ReturnType<typeof createFakeDb>,
  region: string,
): OperationContext {
  return {
    db: fakeDb.db,
    logger: createFakeLogger(),
    reconcilerRunId: "run-test",
    region,
    certManager: certManagerStub(),
  };
}

const successResult: SniProbeResult = {
  handshake_ok: true,
  http_status: 200,
  cert: {
    serialNumber: "DEADBEEF",
    validFrom: "2026-01-01T00:00:00Z",
    validTo: "2026-12-31T00:00:00Z",
    subjectCN: "f3marshall.com",
    issuerCN: "GTS CA 1P5",
  },
  latency_ms: 42,
  redirect_platform_header_ok: true,
  error: null,
};

const failureResult: SniProbeResult = {
  handshake_ok: false,
  http_status: null,
  cert: null,
  latency_ms: 5,
  redirect_platform_header_ok: false,
  error: "self-signed certificate",
};

describe("loadSniProbeConfig", () => {
  it("throws MissingLbIpError when REDIRECT_LB_IPV4 is not set", () => {
    expect(() => loadSniProbeConfig({})).toThrow(MissingLbIpError);
  });

  it("loads the lbIpv4 from env", () => {
    const config = loadSniProbeConfig({
      REDIRECT_LB_IPV4: "34.102.136.180",
      REDIRECT_LB_IPV6: "2600:1901:0:d0d7::",
    });
    expect(config.lbIpv4).toBe("34.102.136.180");
    expect(config.lbIpv6).toBe("2600:1901:0:d0d7::");
  });
});

describe("bothRegionsFresh", () => {
  const now = new Date("2026-04-14T12:00:00Z");
  it("returns true when both regions have a recent success", () => {
    expect(
      bothRegionsFresh({
        probeRegionUsCentral1LastSuccess: "2026-04-14T11:58:30Z",
        probeRegionEuropeWest1LastSuccess: "2026-04-14T11:59:00Z",
        now,
      }),
    ).toBe(true);
  });

  it("returns false when us-central1 is stale", () => {
    expect(
      bothRegionsFresh({
        probeRegionUsCentral1LastSuccess: "2026-04-14T11:50:00Z",
        probeRegionEuropeWest1LastSuccess: "2026-04-14T11:59:00Z",
        now,
      }),
    ).toBe(false);
  });

  it("returns false when a column is null", () => {
    expect(
      bothRegionsFresh({
        probeRegionUsCentral1LastSuccess: null,
        probeRegionEuropeWest1LastSuccess: "2026-04-14T11:59:00Z",
        now,
      }),
    ).toBe(false);
  });
});

describe("reconcileOneSniProbe", () => {
  const now = new Date("2026-04-14T12:00:00Z");

  it("on success, marks this region's last_success and does not increment counter alone", async () => {
    const row = makeRow({
      id: "row-1",
      lifecycleState: "awaiting_probe",
      probeConsecutiveSuccesses: 0,
      probeRegionUsCentral1LastSuccess: null,
      probeRegionEuropeWest1LastSuccess: null,
    });
    const fake = createFakeDb({ rows: [row] });
    const config: SniProbeOpConfig = { lbIpv4: "1.2.3.4" };
    await reconcileOneSniProbe(makeCtx(fake, "us-central1"), config, row, {
      now,
      probeFn: async () => successResult,
    });
    const updated = fake.state.rows[0];
    expect(updated?.probeRegionUsCentral1LastSuccess).toBe(now.toISOString());
    expect(updated?.probeConsecutiveSuccesses).toBe(0);
    expect(updated?.lifecycleState).toBe("awaiting_probe");
  });

  it("on failure, resets consecutive successes to 0", async () => {
    const row = makeRow({
      id: "row-2",
      lifecycleState: "awaiting_probe",
      probeConsecutiveSuccesses: 2,
    });
    const fake = createFakeDb({ rows: [row] });
    await reconcileOneSniProbe(
      makeCtx(fake, "us-central1"),
      { lbIpv4: "1.2.3.4" },
      row,
      {
        now,
        probeFn: async () => failureResult,
      },
    );
    expect(fake.state.rows[0]?.probeConsecutiveSuccesses).toBe(0);
    expect(fake.state.rows[0]?.lifecycleState).toBe("awaiting_probe");
  });

  it("on success in both regions with 3 consecutive, advances to awaiting_cutover", async () => {
    const row = makeRow({
      id: "row-3",
      lifecycleState: "awaiting_probe",
      probeConsecutiveSuccesses: 2,
      // Simulate eu-west1 just succeeded 30 seconds ago (fresh).
      probeRegionEuropeWest1LastSuccess: "2026-04-14T11:59:30Z",
      probeRegionUsCentral1LastSuccess: "2026-04-14T11:57:00Z",
    });
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: "row-3", expectedState: "awaiting_probe" });
    await reconcileOneSniProbe(
      makeCtx(fake, "us-central1"),
      { lbIpv4: "1.2.3.4" },
      row,
      {
        now,
        probeFn: async () => successResult,
      },
    );
    expect(fake.state.rows[0]?.lifecycleState).toBe("awaiting_cutover");
    expect(
      fake.state.events.find(
        (e) => e.eventType === "reconciler.probe_advanced",
      ),
    ).toBeDefined();
  });

  it("2-hour hard timeout transitions to degraded", async () => {
    const longAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
    const row = makeRow({
      id: "row-4",
      lifecycleState: "awaiting_probe",
      probeConsecutiveSuccesses: 0,
      createdAt: longAgo,
      updatedAt: longAgo,
    });
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: "row-4", expectedState: "awaiting_probe" });
    await reconcileOneSniProbe(
      makeCtx(fake, "us-central1"),
      { lbIpv4: "1.2.3.4" },
      row,
      {
        now,
        probeFn: async () => failureResult,
      },
    );
    expect(fake.state.rows[0]?.lifecycleState).toBe("degraded");
    const err = fake.state.rows[0]?.reconcilerError as {
      recoverable_from?: string;
    } | null;
    expect(err?.recoverable_from).toBe("awaiting_probe");
  });
});
