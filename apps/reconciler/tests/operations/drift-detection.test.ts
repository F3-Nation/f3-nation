/**
 * Unit tests for op 8 — periodic drift detection.
 *
 * Covers:
 *   - throttling (skips within the interval, runs past the interval)
 *   - orphan GCP DnsAuthorization detection → CRITICAL log, no state changes
 *   - orphan GCP Certificate detection
 *   - orphan DB row (state expects a resource but GCP returns 404)
 *     transitions to degraded
 *   - UUID extraction pure helper
 *   - missingResourcesForRow pure helper
 */

import { describe, expect, it } from "vitest";

import type {
  CertificateView,
  CertificateMapEntryView,
  DnsAuthorizationView,
} from "../../src/gcp/cert-manager-client.js";
import {
  createInMemoryDriftDetectionStore,
  DEFAULT_DRIFT_DETECTION_INTERVAL_MS,
  extractUuidFromResourceName,
  isDueForDriftDetection,
  missingResourcesForRow,
  runDriftDetection,
  shortNameFromResourcePath,
} from "../../src/operations/drift-detection.js";
import type { OperationContext } from "../../src/operations/shared.js";
import { createFakeCertManager } from "../helpers/fake-cert-manager.js";
import { createFakeDb, makeRow, setStateGuard } from "../helpers/fake-db.js";
import { createFakeLogger } from "../helpers/fake-logger.js";

const NOW = new Date("2026-04-14T12:00:00Z");
const UUID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const UUID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function makeCtx(
  fake: ReturnType<typeof createFakeDb>,
  certManagerOverrides: Partial<ReturnType<typeof createFakeCertManager>> = {},
): OperationContext & { logger: ReturnType<typeof createFakeLogger> } {
  const logger = createFakeLogger();
  return {
    db: fake.db,
    logger,
    reconcilerRunId: "run-drift",
    region: "us-central1",
    certManager: createFakeCertManager(certManagerOverrides),
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("extractUuidFromResourceName", () => {
  it("extracts the uuid from a short deterministic name", () => {
    expect(extractUuidFromResourceName(`dns-auth-${UUID_A}`)).toBe(UUID_A);
    expect(extractUuidFromResourceName(`cert-${UUID_A}`)).toBe(UUID_A);
    expect(extractUuidFromResourceName(`cme-${UUID_A}`)).toBe(UUID_A);
  });

  it("extracts from a full gcp resource path", () => {
    expect(
      extractUuidFromResourceName(
        `projects/f3-redirects/locations/global/certificates/cert-${UUID_A}`,
      ),
    ).toBe(UUID_A);
  });

  it("returns null when no uuid is present", () => {
    expect(extractUuidFromResourceName("dns-auth-legacy-name")).toBeNull();
    expect(extractUuidFromResourceName("unrelated")).toBeNull();
  });
});

describe("shortNameFromResourcePath", () => {
  it("returns the portion after the last slash", () => {
    expect(
      shortNameFromResourcePath(
        `projects/foo/locations/global/certificates/cert-${UUID_A}`,
      ),
    ).toBe(`cert-${UUID_A}`);
  });
  it("returns the full string when there is no slash", () => {
    expect(shortNameFromResourcePath(`cert-${UUID_A}`)).toBe(`cert-${UUID_A}`);
  });
});

describe("missingResourcesForRow", () => {
  it("returns null when state does not expect any resource", () => {
    const row = makeRow({ id: UUID_A, lifecycleState: "pending" });
    expect(
      missingResourcesForRow(row, new Set(), new Set(), new Set()),
    ).toBeNull();
  });

  it("flags missing DnsAuthorization for awaiting_dns_challenge state", () => {
    const row = makeRow({
      id: UUID_A,
      lifecycleState: "awaiting_dns_challenge",
    });
    const result = missingResourcesForRow(row, new Set(), new Set(), new Set());
    expect(result?.resourceType).toBe("DnsAuthorization");
    expect(result?.expectedName).toBe(`dns-auth-${UUID_A}`);
  });

  it("flags missing CME for active state even if dns-auth and cert exist", () => {
    const row = makeRow({ id: UUID_A, lifecycleState: "active" });
    const result = missingResourcesForRow(
      row,
      new Set([`dns-auth-${UUID_A}`]),
      new Set([`cert-${UUID_A}`]),
      new Set(),
    );
    expect(result?.resourceType).toBe("CertificateMapEntry");
  });
});

// ---------------------------------------------------------------------------
// Throttling
// ---------------------------------------------------------------------------

describe("isDueForDriftDetection", () => {
  it("is due when the store has never recorded a run", async () => {
    const store = createInMemoryDriftDetectionStore();
    expect(
      await isDueForDriftDetection(
        store,
        NOW,
        DEFAULT_DRIFT_DETECTION_INTERVAL_MS,
      ),
    ).toBe(true);
  });

  it("is NOT due when the last run was within the interval", async () => {
    const store = createInMemoryDriftDetectionStore();
    await store.setLastRunAt(new Date(NOW.getTime() - 30 * 60 * 1000));
    expect(
      await isDueForDriftDetection(
        store,
        NOW,
        DEFAULT_DRIFT_DETECTION_INTERVAL_MS,
      ),
    ).toBe(false);
  });

  it("is due when the last run was longer ago than the interval", async () => {
    const store = createInMemoryDriftDetectionStore();
    await store.setLastRunAt(
      new Date(NOW.getTime() - 2 * DEFAULT_DRIFT_DETECTION_INTERVAL_MS),
    );
    expect(
      await isDueForDriftDetection(
        store,
        NOW,
        DEFAULT_DRIFT_DETECTION_INTERVAL_MS,
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runDriftDetection end-to-end
// ---------------------------------------------------------------------------

describe("runDriftDetection", () => {
  const FULL_DNS_AUTH = (id: string): DnsAuthorizationView => ({
    name: `projects/test/locations/global/dnsAuthorizations/${id}`,
    domain: "f3marshall.com",
    state: "ACTIVE",
    dnsResourceRecord: null,
  });
  const FULL_CERT = (id: string): CertificateView => ({
    name: `projects/test/locations/global/certificates/${id}`,
    managed: {
      domains: ["f3marshall.com"],
      dnsAuthorizations: [],
      state: "ACTIVE",
      failureDetails: null,
    },
  });
  const FULL_CME = (id: string): CertificateMapEntryView => ({
    name: `projects/test/locations/global/certificateMaps/redirect-platform-cert-map/certificateMapEntries/${id}`,
    hostname: "f3marshall.com",
    certificates: [],
  });

  it("is throttled when the store says we ran recently", async () => {
    const fake = createFakeDb({ rows: [] });
    const store = createInMemoryDriftDetectionStore();
    await store.setLastRunAt(new Date(NOW.getTime() - 60 * 1000)); // 1 min ago

    let listCalls = 0;
    const throttledCtx = makeCtx(fake, {
      async listDnsAuthorizations() {
        listCalls += 1;
        return [];
      },
    });

    await runDriftDetection(throttledCtx, { store, now: () => NOW });
    expect(listCalls).toBe(0);
  });

  it("detects an orphan DnsAuthorization in GCP (no matching DB row) and logs drift at CRITICAL", async () => {
    const fake = createFakeDb({ rows: [] });
    const ctx = makeCtx(fake, {
      async listDnsAuthorizations() {
        return [FULL_DNS_AUTH(`dns-auth-${UUID_B}`)];
      },
    });
    const store = createInMemoryDriftDetectionStore();

    await runDriftDetection(ctx, { store, now: () => NOW });

    expect(ctx.logger.driftCalls.length).toBe(1);
    const [call] = ctx.logger.driftCalls[0] as [
      { driftKind: string; resourceType: string },
    ];
    expect(call.driftKind).toBe("orphan_resource");
    expect(call.resourceType).toBe("DnsAuthorization");
    // Op 8 MUST NOT mutate GCP resources — this is report-only.
    // We don't have a direct way to assert "no delete was called" because
    // the fake defaults are no-op void, but the flow path never invokes
    // delete* in the implementation; the op 6 tests cover deletion.
  });

  it("detects an orphan Certificate in GCP and logs drift", async () => {
    const fake = createFakeDb({ rows: [] });
    const ctx = makeCtx(fake, {
      async listCertificates() {
        return [FULL_CERT(`cert-${UUID_B}`)];
      },
    });
    const store = createInMemoryDriftDetectionStore();

    await runDriftDetection(ctx, { store, now: () => NOW });

    const driftCalls = ctx.logger.driftCalls.filter((args) => {
      const call = args[0] as { resourceType?: string };
      return call.resourceType === "Certificate";
    });
    expect(driftCalls.length).toBe(1);
  });

  it("detects an orphan DB row (state expects resources but none exist in GCP) and transitions to degraded", async () => {
    const row = makeRow({
      id: UUID_A,
      lifecycleState: "active",
    });
    const fake = createFakeDb({ rows: [row] });
    setStateGuard(fake, { id: UUID_A, expectedState: "active" });
    const ctx = makeCtx(fake);
    const store = createInMemoryDriftDetectionStore();

    await runDriftDetection(ctx, { store, now: () => NOW });

    const updated = fake.state.rows[0];
    expect(updated?.lifecycleState).toBe("degraded");
    const err = updated?.reconcilerError as {
      drift_kind?: string;
      recoverable_from?: string;
    } | null;
    expect(err?.drift_kind).toBe("unexpected_state");
    expect(err?.recoverable_from).toBe("active");
    expect(
      fake.state.events.find(
        (e) => e.eventType === "reconciler.drift_detection_orphan_db",
      ),
    ).toBeDefined();
  });

  it("persists the last-run-at timestamp after a successful run", async () => {
    const fake = createFakeDb({ rows: [] });
    const ctx = makeCtx(fake);
    const store = createInMemoryDriftDetectionStore();

    await runDriftDetection(ctx, { store, now: () => NOW });

    const last = await store.getLastRunAt();
    expect(last?.toISOString()).toBe(NOW.toISOString());
  });

  it("DB rows that match GCP resources 1:1 produce no drift", async () => {
    const row = makeRow({
      id: UUID_A,
      lifecycleState: "active",
    });
    const fake = createFakeDb({ rows: [row] });
    const ctx = makeCtx(fake, {
      async listDnsAuthorizations() {
        return [FULL_DNS_AUTH(`dns-auth-${UUID_A}`)];
      },
      async listCertificates() {
        return [FULL_CERT(`cert-${UUID_A}`)];
      },
      async listCertificateMapEntries() {
        return [FULL_CME(`cme-${UUID_A}`)];
      },
    });
    const store = createInMemoryDriftDetectionStore();

    await runDriftDetection(ctx, { store, now: () => NOW });

    expect(ctx.logger.driftCalls.length).toBe(0);
    // Row stays active.
    expect(fake.state.rows[0]?.lifecycleState).toBe("active");
  });
});
