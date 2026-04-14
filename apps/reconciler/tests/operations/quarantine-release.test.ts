/**
 * Unit tests for op 7 — quarantine release with mandatory drift check.
 *
 * Includes the R5 structural-fix lock-in test:
 *
 *   "advances to released only when all three deterministic resource
 *    GETs return 404"
 *
 * If that test is renamed or removed, the structural fix for R4 finding 5
 * ("`released` was pure timer — could free hostname while orphan GCP
 * resources still existed") has regressed.
 */

import { describe, expect, it } from "vitest";

import type {
  CertificateView,
  CertificateMapEntryView,
  DnsAuthorizationView,
} from "../../src/gcp/cert-manager-client.js";
import type { OperationContext } from "../../src/operations/shared.js";
import {
  reconcileOneQuarantineRelease,
  runQuarantineDriftCheck,
  runQuarantineRelease,
} from "../../src/operations/quarantine-release.js";
import { createFakeCertManager } from "../helpers/fake-cert-manager.js";
import { createFakeDb, makeRow, setStateGuard } from "../helpers/fake-db.js";
import { createFakeLogger } from "../helpers/fake-logger.js";

const NOW = new Date("2026-04-14T12:00:00Z");
const PAST = new Date("2026-04-13T00:00:00Z").toISOString();

const DNS_AUTH: DnsAuthorizationView = {
  name: "projects/test/locations/global/dnsAuthorizations/dns-auth-row-1",
  domain: "f3marshall.com",
  state: "ACTIVE",
  dnsResourceRecord: null,
};

const CERT: CertificateView = {
  name: "projects/test/locations/global/certificates/cert-row-1",
  managed: {
    domains: ["f3marshall.com"],
    dnsAuthorizations: [],
    state: "ACTIVE",
    failureDetails: null,
  },
};

const CME: CertificateMapEntryView = {
  name: "projects/test/locations/global/certificateMaps/redirect-platform-cert-map/certificateMapEntries/cme-row-1",
  hostname: "f3marshall.com",
  certificates: [],
};

function makeCtx(
  fake: ReturnType<typeof createFakeDb>,
  certManagerOverrides: Partial<ReturnType<typeof createFakeCertManager>> = {},
): OperationContext & { logger: ReturnType<typeof createFakeLogger> } {
  const logger = createFakeLogger();
  return {
    db: fake.db,
    logger,
    reconcilerRunId: "run-quarantine",
    region: "us-central1",
    certManager: createFakeCertManager(certManagerOverrides),
  };
}

// ---------------------------------------------------------------------------
// runQuarantineDriftCheck pure helper
// ---------------------------------------------------------------------------

describe("runQuarantineDriftCheck", () => {
  it("returns allAbsent=true when all three GETs return null", async () => {
    const row = makeRow({ id: "row-1", lifecycleState: "quarantined" });
    const fake = createFakeDb({ rows: [row] });
    const ctx = makeCtx(fake);
    const result = await runQuarantineDriftCheck(ctx, row);
    expect(result.allAbsent).toBe(true);
    expect(result.orphan).toBeNull();
  });

  it("returns orphan=DnsAuthorization when the dns-auth GET returns a value", async () => {
    const row = makeRow({ id: "row-1", lifecycleState: "quarantined" });
    const fake = createFakeDb({ rows: [row] });
    const ctx = makeCtx(fake, {
      async getDnsAuthorization() {
        return DNS_AUTH;
      },
    });
    const result = await runQuarantineDriftCheck(ctx, row);
    expect(result.allAbsent).toBe(false);
    expect(result.orphan?.resourceType).toBe("DnsAuthorization");
    expect(result.orphan?.resourceName).toBe("dns-auth-row-1");
  });

  it("returns orphan=Certificate when only the cert GET returns a value", async () => {
    const row = makeRow({ id: "row-1", lifecycleState: "quarantined" });
    const fake = createFakeDb({ rows: [row] });
    const ctx = makeCtx(fake, {
      async getCertificateView() {
        return CERT;
      },
    });
    const result = await runQuarantineDriftCheck(ctx, row);
    expect(result.orphan?.resourceType).toBe("Certificate");
    expect(result.orphan?.resourceName).toBe("cert-row-1");
  });

  it("returns orphan=CertificateMapEntry when only the CME GET returns a value", async () => {
    const row = makeRow({ id: "row-1", lifecycleState: "quarantined" });
    const fake = createFakeDb({ rows: [row] });
    const ctx = makeCtx(fake, {
      async getCertificateMapEntry() {
        return CME;
      },
    });
    const result = await runQuarantineDriftCheck(ctx, row);
    expect(result.orphan?.resourceType).toBe("CertificateMapEntry");
    expect(result.orphan?.resourceName).toBe("cme-row-1");
  });
});

// ---------------------------------------------------------------------------
// reconcileOneQuarantineRelease — happy path + orphan halt paths
// ---------------------------------------------------------------------------

describe("reconcileOneQuarantineRelease", () => {
  /**
   * R5 STRUCTURAL-FIX LOCK-IN TEST.
   *
   * R4 finding 5: `released` was a pure timer that could free a hostname
   * while orphan GCP resources still existed. R5 Decision 6 op 7 made the
   * drift check mandatory. If this test regresses or is removed, the
   * structural fix has been unwound.
   *
   * Do not rename this `it(...)` string — the F3R5_011 task spec
   * requires it to match exactly.
   */
  it("advances to released only when all three deterministic resource GETs return 404", async () => {
    const row = makeRow({
      id: "row-1",
      lifecycleState: "quarantined",
      releasedAt: PAST,
    });
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: "row-1", expectedState: "quarantined" });
    const ctx = makeCtx(fake, {
      // All three GETs return null → 404
      async getDnsAuthorization() {
        return null;
      },
      async getCertificateView() {
        return null;
      },
      async getCertificateMapEntry() {
        return null;
      },
    });

    await reconcileOneQuarantineRelease(ctx, row);

    expect(fake.state.rows[0]?.lifecycleState).toBe("released");
    const event = fake.state.events.find(
      (e) => e.eventType === "reconciler.quarantine_released",
    );
    expect(event).toBeDefined();
    const details = event?.details as { drift_check?: string } | null;
    expect(details?.drift_check).toBe("passed");
  });

  it("halts to degraded when DnsAuthorization is still present", async () => {
    const row = makeRow({
      id: "row-2",
      lifecycleState: "quarantined",
      releasedAt: PAST,
    });
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: "row-2", expectedState: "quarantined" });
    const ctx = makeCtx(fake, {
      async getDnsAuthorization() {
        return DNS_AUTH;
      },
    });

    await reconcileOneQuarantineRelease(ctx, row);

    const updated = fake.state.rows[0];
    expect(updated?.lifecycleState).toBe("degraded");
    const err = updated?.reconcilerError as {
      drift_kind?: string;
      resource_type?: string;
      recoverable_from?: string;
    } | null;
    expect(err?.drift_kind).toBe("orphan_resource");
    expect(err?.resource_type).toBe("DnsAuthorization");
    expect(err?.recoverable_from).toBe("quarantined");
    expect(ctx.logger.driftCalls.length).toBe(1);
  });

  it("halts to degraded when Certificate is still present", async () => {
    const row = makeRow({
      id: "row-3",
      lifecycleState: "quarantined",
      releasedAt: PAST,
    });
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: "row-3", expectedState: "quarantined" });
    const ctx = makeCtx(fake, {
      async getCertificateView() {
        return CERT;
      },
    });

    await reconcileOneQuarantineRelease(ctx, row);

    const updated = fake.state.rows[0];
    expect(updated?.lifecycleState).toBe("degraded");
    const err = updated?.reconcilerError as {
      resource_type?: string;
    } | null;
    expect(err?.resource_type).toBe("Certificate");
    expect(ctx.logger.driftCalls.length).toBe(1);
  });

  it("halts to degraded when CertificateMapEntry is still present", async () => {
    const row = makeRow({
      id: "row-4",
      lifecycleState: "quarantined",
      releasedAt: PAST,
    });
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: "row-4", expectedState: "quarantined" });
    const ctx = makeCtx(fake, {
      async getCertificateMapEntry() {
        return CME;
      },
    });

    await reconcileOneQuarantineRelease(ctx, row);

    const updated = fake.state.rows[0];
    expect(updated?.lifecycleState).toBe("degraded");
    const err = updated?.reconcilerError as {
      resource_type?: string;
    } | null;
    expect(err?.resource_type).toBe("CertificateMapEntry");
  });

  it("halts to degraded when multiple resources are still present (reports the first one found in the plan's ordering)", async () => {
    const row = makeRow({
      id: "row-5",
      lifecycleState: "quarantined",
      releasedAt: PAST,
    });
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: "row-5", expectedState: "quarantined" });
    const ctx = makeCtx(fake, {
      async getDnsAuthorization() {
        return DNS_AUTH;
      },
      async getCertificateView() {
        return CERT;
      },
      async getCertificateMapEntry() {
        return CME;
      },
    });

    await reconcileOneQuarantineRelease(ctx, row);

    const err = fake.state.rows[0]?.reconcilerError as {
      resource_type?: string;
    } | null;
    // The plan's drift check order is DnsAuth → Certificate → CME, so the
    // first orphan surfaced in the payload MUST be DnsAuthorization.
    expect(err?.resource_type).toBe("DnsAuthorization");
  });

  it("writes recoverable_from='quarantined' so the admin UI can retry the release", async () => {
    const row = makeRow({
      id: "row-6",
      lifecycleState: "quarantined",
      releasedAt: PAST,
    });
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: "row-6", expectedState: "quarantined" });
    const ctx = makeCtx(fake, {
      async getCertificateView() {
        return CERT;
      },
    });

    await reconcileOneQuarantineRelease(ctx, row);

    const err = fake.state.rows[0]?.reconcilerError as {
      recoverable_from?: string;
    } | null;
    expect(err?.recoverable_from).toBe("quarantined");
  });
});

// ---------------------------------------------------------------------------
// runQuarantineRelease — cycle-level released_at filter
// ---------------------------------------------------------------------------

describe("runQuarantineRelease", () => {
  it("skips rows whose released_at is in the future", async () => {
    const futureRow = makeRow({
      id: "future-1",
      lifecycleState: "quarantined",
      releasedAt: new Date(NOW.getTime() + 60_000).toISOString(),
    });
    const fake = createFakeDb({ rows: [futureRow] });
    let getCalls = 0;
    const ctx = makeCtx(fake, {
      async getDnsAuthorization() {
        getCalls += 1;
        return null;
      },
    });

    await runQuarantineRelease(ctx, { now: () => NOW });

    expect(getCalls).toBe(0);
    expect(fake.state.rows[0]?.lifecycleState).toBe("quarantined");
  });

  it("skips rows whose released_at is null", async () => {
    const row = makeRow({
      id: "null-1",
      lifecycleState: "quarantined",
      releasedAt: null,
    });
    const fake = createFakeDb({ rows: [row] });
    let getCalls = 0;
    const ctx = makeCtx(fake, {
      async getDnsAuthorization() {
        getCalls += 1;
        return null;
      },
    });

    await runQuarantineRelease(ctx, { now: () => NOW });
    expect(getCalls).toBe(0);
  });
});
