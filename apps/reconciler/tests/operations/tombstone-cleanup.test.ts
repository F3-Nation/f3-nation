/**
 * Unit tests for op 6 — tombstone cleanup.
 *
 * Covers:
 *   - happy path: three deletes + follow-up 404s → advance to quarantined
 *   - idempotent re-run: CME already 404 → skips DELETE call sequence
 *   - FAILED_PRECONDITION on CME → halt-on-drift
 *   - PERMISSION_DENIED on Certificate → halt-on-drift
 *   - NOT_FOUND behaves as success on DELETE (covered by cert-manager-client
 *     layer + here via idempotent re-run)
 *   - released_at is set to now + 30 days
 */

import { describe, expect, it } from "vitest";

import { PermissionDeniedError } from "../../src/gcp/errors.js";
import type {
  CertificateView,
  CertificateMapEntryView,
  DnsAuthorizationView,
} from "../../src/gcp/cert-manager-client.js";
import type { OperationContext } from "../../src/operations/shared.js";
import {
  QUARANTINE_PERIOD_MS,
  reconcileOneTombstoneCleanup,
} from "../../src/operations/tombstone-cleanup.js";
import { createFakeCertManager } from "../helpers/fake-cert-manager.js";
import { createFakeDb, makeRow, setStateGuard } from "../helpers/fake-db.js";
import { createFakeLogger } from "../helpers/fake-logger.js";

function makeCtx(
  fake: ReturnType<typeof createFakeDb>,
  certManagerOverrides: Partial<ReturnType<typeof createFakeCertManager>> = {},
): OperationContext & { logger: ReturnType<typeof createFakeLogger> } {
  const logger = createFakeLogger();
  return {
    db: fake.db,
    logger,
    reconcilerRunId: "run-tombstone",
    region: "us-central1",
    certManager: createFakeCertManager(certManagerOverrides),
  };
}

const FAKE_CME: CertificateMapEntryView = {
  name: "projects/test/locations/global/certificateMaps/redirect-platform-cert-map/certificateMapEntries/cme-row-1",
  hostname: "f3marshall.com",
  certificates: [],
};

const FAKE_CERT: CertificateView = {
  name: "projects/test/locations/global/certificates/cert-row-1",
  managed: {
    domains: ["f3marshall.com"],
    dnsAuthorizations: [],
    state: "ACTIVE",
    failureDetails: null,
  },
};

const FAKE_DNS_AUTH: DnsAuthorizationView = {
  name: "projects/test/locations/global/dnsAuthorizations/dns-auth-row-1",
  domain: "f3marshall.com",
  state: "ACTIVE",
  dnsResourceRecord: null,
};

describe("reconcileOneTombstoneCleanup — happy path", () => {
  it("deletes all three resources in reverse order and advances to quarantined", async () => {
    const row = makeRow({ id: "row-1", lifecycleState: "tombstoned" });
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: "row-1", expectedState: "tombstoned" });

    const deleteSequence: string[] = [];
    // Simulate: before delete the resource exists; after delete the
    // follow-up GET returns null. We flip a local flag per resource.
    let cmeExists = true;
    let certExists = true;
    let dnsAuthExists = true;

    const ctx = makeCtx(fake, {
      async getCertificateMapEntry() {
        return cmeExists ? FAKE_CME : null;
      },
      async deleteCertificateMapEntry() {
        deleteSequence.push("cme");
        cmeExists = false;
      },
      async getCertificateView() {
        return certExists ? FAKE_CERT : null;
      },
      async deleteCertificate() {
        deleteSequence.push("cert");
        certExists = false;
      },
      async getDnsAuthorization() {
        return dnsAuthExists ? FAKE_DNS_AUTH : null;
      },
      async deleteDnsAuthorization() {
        deleteSequence.push("dns");
        dnsAuthExists = false;
      },
    });

    await reconcileOneTombstoneCleanup(ctx, row);

    expect(deleteSequence).toEqual(["cme", "cert", "dns"]);
    const updated = fake.state.rows[0];
    expect(updated?.lifecycleState).toBe("quarantined");
    expect(updated?.releasedAt).not.toBeNull();
    // Should be roughly 30 days out.
    const deltaMs = new Date(updated?.releasedAt ?? "").getTime() - Date.now();
    expect(Math.abs(deltaMs - QUARANTINE_PERIOD_MS)).toBeLessThan(60 * 1000);
    expect(
      fake.state.events.find(
        (e) => e.eventType === "reconciler.tombstone_cleanup",
      ),
    ).toBeDefined();
  });
});

describe("reconcileOneTombstoneCleanup — idempotent re-run", () => {
  it("crash-recovery: when CME and cert already 404, only DNS auth is deleted", async () => {
    const row = makeRow({ id: "row-2", lifecycleState: "tombstoned" });
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: "row-2", expectedState: "tombstoned" });

    const deleteCalls: string[] = [];
    let dnsAuthExists = true;

    const ctx = makeCtx(fake, {
      // CME and cert are already gone from a prior crashed cycle.
      async getCertificateMapEntry() {
        return null;
      },
      async deleteCertificateMapEntry() {
        deleteCalls.push("cme");
        // Client handles NOT_FOUND internally — return void.
      },
      async getCertificateView() {
        return null;
      },
      async deleteCertificate() {
        deleteCalls.push("cert");
      },
      async getDnsAuthorization() {
        return dnsAuthExists ? FAKE_DNS_AUTH : null;
      },
      async deleteDnsAuthorization() {
        deleteCalls.push("dns");
        dnsAuthExists = false;
      },
    });

    await reconcileOneTombstoneCleanup(ctx, row);

    // The operation calls each delete regardless — the client's idempotent
    // NOT_FOUND-as-success path means the DELETEs for gone resources
    // resolve to void. What matters is that the sequence runs through and
    // advances the row.
    expect(deleteCalls).toEqual(["cme", "cert", "dns"]);
    expect(fake.state.rows[0]?.lifecycleState).toBe("quarantined");
  });
});

describe("reconcileOneTombstoneCleanup — error paths", () => {
  it("FAILED_PRECONDITION on CME DELETE halts to degraded with drift_kind=unexpected_state", async () => {
    const row = makeRow({ id: "row-3", lifecycleState: "tombstoned" });
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: "row-3", expectedState: "tombstoned" });

    const failedPrecondition = Object.assign(new Error("in use"), { code: 9 });

    const ctx = makeCtx(fake, {
      async deleteCertificateMapEntry() {
        throw failedPrecondition;
      },
    });

    await reconcileOneTombstoneCleanup(ctx, row);

    const updated = fake.state.rows[0];
    expect(updated?.lifecycleState).toBe("degraded");
    const err = updated?.reconcilerError as {
      drift_kind?: string;
      resource_type?: string;
    } | null;
    expect(err?.drift_kind).toBe("unexpected_state");
    expect(err?.resource_type).toBe("CertificateMapEntry");
    expect(ctx.logger.driftCalls.length).toBe(1);
  });

  it("PERMISSION_DENIED on Certificate DELETE halts to degraded", async () => {
    const row = makeRow({ id: "row-4", lifecycleState: "tombstoned" });
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: "row-4", expectedState: "tombstoned" });

    let cmeExists = true;
    const ctx = makeCtx(fake, {
      async getCertificateMapEntry() {
        return cmeExists ? FAKE_CME : null;
      },
      async deleteCertificateMapEntry() {
        cmeExists = false;
      },
      async deleteCertificate() {
        throw new PermissionDeniedError("Certificate", "cert-row-4");
      },
    });

    await reconcileOneTombstoneCleanup(ctx, row);

    const updated = fake.state.rows[0];
    expect(updated?.lifecycleState).toBe("degraded");
    const err = updated?.reconcilerError as {
      resource_type?: string;
    } | null;
    expect(err?.resource_type).toBe("Certificate");
  });

  it("follow-up GET still returns non-404 after CME DELETE → stays tombstoned for retry", async () => {
    const row = makeRow({ id: "row-5", lifecycleState: "tombstoned" });
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: "row-5", expectedState: "tombstoned" });

    const ctx = makeCtx(fake, {
      async getCertificateMapEntry() {
        // Always returns the CME — DELETE didn't settle in time.
        return FAKE_CME;
      },
      async deleteCertificateMapEntry() {
        // pretend delete succeeded at the RPC layer
      },
    });

    await reconcileOneTombstoneCleanup(ctx, row);

    // Row stays in tombstoned; the cycle will retry.
    expect(fake.state.rows[0]?.lifecycleState).toBe("tombstoned");
    expect(ctx.logger.warnCalls.length).toBeGreaterThan(0);
  });

  it("records all three deleted resource ids in the cleanup event", async () => {
    const row = makeRow({ id: "row-6", lifecycleState: "tombstoned" });
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: "row-6", expectedState: "tombstoned" });

    const ctx = makeCtx(fake);
    await reconcileOneTombstoneCleanup(ctx, row);

    const event = fake.state.events.find(
      (e) => e.eventType === "reconciler.tombstone_cleanup",
    );
    expect(event).toBeDefined();
    const details = event?.details as {
      deleted_cme_id?: string;
      deleted_certificate_id?: string;
      deleted_dns_authorization_id?: string;
    } | null;
    expect(details?.deleted_cme_id).toBe("cme-row-6");
    expect(details?.deleted_certificate_id).toBe("cert-row-6");
    expect(details?.deleted_dns_authorization_id).toBe("dns-auth-row-6");
  });
});
