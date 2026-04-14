/**
 * Operation 8 — Periodic drift detection (R5 Decision 6 op 8).
 *
 * Runs at most once per hour (configurable; default `intervalMs = 1h`).
 * Compares every GCP Certificate Manager resource in the project against
 * the corresponding `region_custom_domains` row and reports bidirectional
 * drift.
 *
 *   - ORPHAN GCP RESOURCE (no matching DB row in a non-released state):
 *     → `log.drift(...)` at CRITICAL with `drift_kind='orphan_resource'`.
 *     Op 8 DOES NOT delete orphan GCP resources. Reports only. Manual
 *     cleanup via platform admin per the drift runbook.
 *
 *   - ORPHAN DB ROW (row is in a state that expects GCP resources but
 *     the corresponding resource returns 404):
 *     → state-guarded UPDATE transitions the row to `degraded` with
 *     `recoverable_from` set to the row's prior lifecycle state.
 *     `log.drift(...)` at CRITICAL with `drift_kind='unexpected_state'`.
 *
 * Throttling: the operation checks a `lastRunAt` timestamp via a
 * caller-injected `driftDetectionStore`. If the last run is within
 * `intervalMs`, op 8 exits immediately. Default production backing is
 * an in-memory singleton per Cloud Run revision; this is acceptable
 * because the reconciler is a singleton lease-holder — only one worker
 * runs op 8 at a time across both regions — and a revision restart
 * will cause at most one extra run.
 *
 * A persistent backing (reconciler_leases row with key 'drift-detection')
 * can be injected for deployments that want cross-revision throttling.
 */

import { regionCustomDomains } from "@acme/redirect-platform-db";
import type { RegionCustomDomain } from "@acme/redirect-platform-db";
import { inArray } from "drizzle-orm";

import type {
  CertificateView,
  CertificateMapEntryView,
  DnsAuthorizationView,
} from "../gcp/cert-manager-client.js";
import {
  appendDomainEvent,
  deterministicResourceName,
  stateGuardedUpdate,
} from "./shared.js";
import type { OperationContext } from "./shared.js";

export const DEFAULT_DRIFT_DETECTION_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Throttle store — injectable, default is in-memory-per-process
// ---------------------------------------------------------------------------

export interface DriftDetectionStore {
  getLastRunAt(): Promise<Date | null>;
  setLastRunAt(date: Date): Promise<void>;
}

export function createInMemoryDriftDetectionStore(): DriftDetectionStore {
  let last: Date | null = null;
  return {
    getLastRunAt(): Promise<Date | null> {
      return Promise.resolve(last);
    },
    setLastRunAt(date: Date): Promise<void> {
      last = date;
      return Promise.resolve();
    },
  };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface DriftDetectionConfig {
  /**
   * Minimum interval between op 8 runs. Default: 1 hour.
   * Plan says "configurable, default N=12 = ~1 hour" (12 × 5min cycles).
   */
  intervalMs?: number;
  now?: () => Date;
  store: DriftDetectionStore;
}

// ---------------------------------------------------------------------------
// UUID extraction from deterministic resource names
// ---------------------------------------------------------------------------

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Extract the UUID suffix from a deterministic resource short id or full
 * resource path. Returns null if no UUID is found.
 *
 *   "dns-auth-<uuid>"                → <uuid>
 *   "projects/.../dnsAuthorizations/dns-auth-<uuid>" → <uuid>
 *   "random-other-name"              → null
 */
export function extractUuidFromResourceName(name: string): string | null {
  const match = UUID_RE.exec(name);
  return match ? match[0].toLowerCase() : null;
}

/**
 * Pull the short id off the end of a full GCP resource path. `dns-auth-...`,
 * `cert-...`, `cme-...`.
 */
export function shortNameFromResourcePath(fullName: string): string {
  const idx = fullName.lastIndexOf("/");
  return idx >= 0 ? fullName.slice(idx + 1) : fullName;
}

// ---------------------------------------------------------------------------
// Which lifecycle states expect a given GCP resource to exist
// ---------------------------------------------------------------------------

const STATES_EXPECTING_DNS_AUTH: ReadonlySet<string> = new Set([
  "awaiting_dns_challenge",
  "validating",
  "provisioning_cert",
  "awaiting_probe",
  "awaiting_cutover",
  "active",
]);

const STATES_EXPECTING_CERT: ReadonlySet<string> = new Set([
  "provisioning_cert",
  "awaiting_probe",
  "awaiting_cutover",
  "active",
]);

const STATES_EXPECTING_CME: ReadonlySet<string> = new Set([
  "awaiting_probe",
  "awaiting_cutover",
  "active",
]);

export function stateExpectsDnsAuth(state: string): boolean {
  return STATES_EXPECTING_DNS_AUTH.has(state);
}
export function stateExpectsCert(state: string): boolean {
  return STATES_EXPECTING_CERT.has(state);
}
export function stateExpectsCme(state: string): boolean {
  return STATES_EXPECTING_CME.has(state);
}

// ---------------------------------------------------------------------------
// Throttling check
// ---------------------------------------------------------------------------

export async function isDueForDriftDetection(
  store: DriftDetectionStore,
  now: Date,
  intervalMs: number,
): Promise<boolean> {
  const last = await store.getLastRunAt();
  if (last === null) return true;
  return now.getTime() - last.getTime() >= intervalMs;
}

// ---------------------------------------------------------------------------
// Operation entry point
// ---------------------------------------------------------------------------

export async function runDriftDetection(
  ctx: OperationContext,
  config: DriftDetectionConfig,
): Promise<void> {
  const now = config.now?.() ?? new Date();
  const intervalMs = config.intervalMs ?? DEFAULT_DRIFT_DETECTION_INTERVAL_MS;

  if (!(await isDueForDriftDetection(config.store, now, intervalMs))) {
    ctx.logger.info("drift detection throttled; skipping", {
      interval_ms: intervalMs,
    });
    return;
  }

  ctx.logger.info("drift detection starting");

  // 1. List every GCP resource in scope.
  const [dnsAuths, certs, cmes] = await Promise.all([
    ctx.certManager.listDnsAuthorizations(),
    ctx.certManager.listCertificates(),
    ctx.certManager.listCertificateMapEntries(),
  ]);

  // 2. Collect all domain rows EXCEPT 'released' — released rows are the
  //    only state that legitimately has no GCP resources behind a
  //    deterministic name. All other states either expect resources or
  //    are terminal-degraded.
  const domainRows = await ctx.db
    .select()
    .from(regionCustomDomains)
    .where(
      inArray(regionCustomDomains.lifecycleState, [
        "pending",
        "awaiting_dns_challenge",
        "validating",
        "provisioning_cert",
        "awaiting_probe",
        "awaiting_cutover",
        "active",
        "degraded",
        "tombstoned",
        "quarantined",
      ]),
    )
    .limit(10_000);
  const rowsById = new Map<string, RegionCustomDomain>(
    domainRows.map((row) => [row.id, row] as const),
  );

  // 3. Cross-check: GCP → DB (orphan GCP resources).
  detectOrphanGcpResources(ctx, dnsAuths, certs, cmes, rowsById);

  // 4. Cross-check: DB → GCP (orphan DB rows missing their resources).
  await detectOrphanDbRows(ctx, dnsAuths, certs, cmes, domainRows);

  await config.store.setLastRunAt(now);
  ctx.logger.info("drift detection completed");
}

// ---------------------------------------------------------------------------
// GCP → DB direction
// ---------------------------------------------------------------------------

function detectOrphanGcpResources(
  ctx: OperationContext,
  dnsAuths: DnsAuthorizationView[],
  certs: CertificateView[],
  cmes: CertificateMapEntryView[],
  rowsById: Map<string, RegionCustomDomain>,
): void {
  for (const dnsAuth of dnsAuths) {
    const shortName = shortNameFromResourcePath(dnsAuth.name);
    const uuid = extractUuidFromResourceName(shortName);
    if (uuid === null || !rowsById.has(uuid)) {
      ctx.logger.drift({
        domainId: uuid ?? "<unknown>",
        driftKind: "orphan_resource",
        resourceType: "DnsAuthorization",
        resourceName: dnsAuth.name,
        observedSpec: dnsAuth,
        expectedSpec: null,
        recoverableFrom: null,
      });
    }
  }

  for (const cert of certs) {
    const shortName = shortNameFromResourcePath(cert.name);
    const uuid = extractUuidFromResourceName(shortName);
    if (uuid === null || !rowsById.has(uuid)) {
      ctx.logger.drift({
        domainId: uuid ?? "<unknown>",
        driftKind: "orphan_resource",
        resourceType: "Certificate",
        resourceName: cert.name,
        observedSpec: cert,
        expectedSpec: null,
        recoverableFrom: null,
      });
    }
  }

  for (const cme of cmes) {
    const shortName = shortNameFromResourcePath(cme.name);
    const uuid = extractUuidFromResourceName(shortName);
    if (uuid === null || !rowsById.has(uuid)) {
      ctx.logger.drift({
        domainId: uuid ?? "<unknown>",
        driftKind: "orphan_resource",
        resourceType: "CertificateMapEntry",
        resourceName: cme.name,
        observedSpec: cme,
        expectedSpec: null,
        recoverableFrom: null,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// DB → GCP direction
// ---------------------------------------------------------------------------

async function detectOrphanDbRows(
  ctx: OperationContext,
  dnsAuths: DnsAuthorizationView[],
  certs: CertificateView[],
  cmes: CertificateMapEntryView[],
  domainRows: RegionCustomDomain[],
): Promise<void> {
  const dnsAuthIds = new Set(
    dnsAuths
      .map((r) => shortNameFromResourcePath(r.name))
      .filter((s) => s.length > 0),
  );
  const certIds = new Set(
    certs
      .map((r) => shortNameFromResourcePath(r.name))
      .filter((s) => s.length > 0),
  );
  const cmeIds = new Set(
    cmes
      .map((r) => shortNameFromResourcePath(r.name))
      .filter((s) => s.length > 0),
  );

  for (const row of domainRows) {
    const missing = missingResourcesForRow(row, dnsAuthIds, certIds, cmeIds);
    if (missing === null) continue;
    await handleOrphanDbRow(ctx, row, missing);
  }
}

export interface MissingResourceSummary {
  resourceType: "DnsAuthorization" | "Certificate" | "CertificateMapEntry";
  expectedName: string;
}

export function missingResourcesForRow(
  row: RegionCustomDomain,
  dnsAuthIds: Set<string>,
  certIds: Set<string>,
  cmeIds: Set<string>,
): MissingResourceSummary | null {
  const state = row.lifecycleState;

  if (stateExpectsDnsAuth(state)) {
    const expected = deterministicResourceName("DnsAuthorization", row.id);
    if (!dnsAuthIds.has(expected)) {
      return { resourceType: "DnsAuthorization", expectedName: expected };
    }
  }
  if (stateExpectsCert(state)) {
    const expected = deterministicResourceName("Certificate", row.id);
    if (!certIds.has(expected)) {
      return { resourceType: "Certificate", expectedName: expected };
    }
  }
  if (stateExpectsCme(state)) {
    const expected = deterministicResourceName("CertificateMapEntry", row.id);
    if (!cmeIds.has(expected)) {
      return { resourceType: "CertificateMapEntry", expectedName: expected };
    }
  }
  return null;
}

async function handleOrphanDbRow(
  ctx: OperationContext,
  row: RegionCustomDomain,
  missing: MissingResourceSummary,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const driftPayload = {
    drift_kind: "unexpected_state" as const,
    resource_type: missing.resourceType,
    resource_name: missing.expectedName,
    observed_spec: { absent: true },
    expected_spec: { present: true },
    recoverable_from: row.lifecycleState,
    detected_at: nowIso,
    reconciler_run_id: ctx.reconcilerRunId,
    details: `drift detection: ${missing.resourceType} missing for row in ${row.lifecycleState}`,
  };

  const updated = await stateGuardedUpdate(ctx.db, {
    id: row.id,
    expectedState: row.lifecycleState,
    newState: "degraded",
    patch: { reconcilerError: driftPayload },
  });
  if (updated === null) {
    ctx.logger.info(
      "drift detection: state guard failed; row moved concurrently",
      { domain_id: row.id },
    );
    return;
  }
  ctx.logger.drift({
    domainId: row.id,
    driftKind: "unexpected_state",
    resourceType: missing.resourceType,
    resourceName: missing.expectedName,
    observedSpec: { absent: true },
    expectedSpec: { present: true },
    recoverableFrom: row.lifecycleState,
  });
  await appendDomainEvent(ctx.db, {
    domainId: row.id,
    eventType: "reconciler.drift_detection_orphan_db",
    fromState: row.lifecycleState,
    toState: "degraded",
    details: { reconciler_error: driftPayload },
    reconcilerRunId: ctx.reconcilerRunId,
  });
}
