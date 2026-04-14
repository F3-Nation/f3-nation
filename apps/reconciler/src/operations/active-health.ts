/**
 * Operation 5 — Active health monitoring (R5 Decision 6, op 5).
 *
 * Trigger: rows where `lifecycle_state = 'active'`. Runs every reconciler
 * cycle as a heartbeat check on live redirects. Two independent checks:
 *
 *   1. SNI probe (same function op 3 uses) at reduced cadence — only rows
 *      whose `last_reconciled_at < now() - 10 minutes` (or NULL) are
 *      touched. On ≥2 consecutive probe failures, transition to `degraded`
 *      with `recoverable_from = 'active'`.
 *   2. Cert renewal escalation ladder — parse `cert.validTo` from the probe
 *      result and run the T-14 / T-7 / T-1 ladder.
 *
 *        T-14 days  → transition `active → degraded` (recoverable_from =
 *                     'active'), emit a WARNING log carrying the cert-renewal
 *                     metadata. No pager.
 *        T-7 days   → same transition, emit `log.certRenewal({ level: 'T-7' })`
 *                     at CRITICAL (fires PagerDuty via the
 *                     `redirect_platform_cert_renewal=true` label). No-op if
 *                     the ladder already recorded T-7 for this row.
 *        T-1 day    → same pattern, escalation_level `'T-1'`, CRITICAL.
 *
 * Escalation state lives in the loose JSONB `reconciler_error` blob under
 * the key `cert_renewal_escalation_level`. Starts undefined; monotonic.
 *
 * Per-region tracking: on every probe (regardless of outcome) we update
 * `probe_last_attempted_at`. On success, the current region's
 * `probe_region_<us_central1|europe_west1>_last_success` is bumped. The
 * plan does NOT require the two-region freshness window for op 5 — this
 * is a heartbeat, not a cutover gate.
 *
 * Consecutive failure tracking lives in the loose JSONB `reconciler_error`
 * blob under `consecutive_probe_failures`. Starts at 0; resets on success.
 */

import { regionCustomDomains } from "@acme/redirect-platform-db";
import type { RegionCustomDomain } from "@acme/redirect-platform-db";
import { eq } from "drizzle-orm";

import { isSniProbeSuccess, runSniProbe } from "../probe/index.js";
import type { SniProbeInput, SniProbeResult } from "../probe/index.js";
import {
  appendDomainEvent,
  deterministicResourceName,
  stateGuardedUpdate,
} from "./shared.js";
import type { OperationContext } from "./shared.js";
import type { SniProbeOpConfig } from "./sni-probe.js";

const MAX_ROWS_PER_CYCLE = 50;
export const ACTIVE_HEALTH_REPROBE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
export const CONSECUTIVE_FAILURE_THRESHOLD = 2;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const T14_MS = 14 * DAY_MS;
export const T7_MS = 7 * DAY_MS;
export const T1_MS = 1 * DAY_MS;

// ---------------------------------------------------------------------------
// JSONB helpers — read/write the loose `reconciler_error` bag
// ---------------------------------------------------------------------------

export type CertRenewalEscalationLevel = "T-14" | "T-7" | "T-1";

export interface ActiveHealthErrorBlob {
  consecutive_probe_failures?: number;
  cert_renewal_escalation_level?: CertRenewalEscalationLevel;
  [key: string]: unknown;
}

export function readActiveHealthBlob(value: unknown): ActiveHealthErrorBlob {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return value as ActiveHealthErrorBlob;
}

// ---------------------------------------------------------------------------
// Pure helpers — exported so unit tests can hit them directly
// ---------------------------------------------------------------------------

export interface ParsedCertExpiry {
  date: Date;
  daysUntilExpiry: number;
}

/**
 * Parse a TLS `notAfter` value into a Date and compute days-until-expiry
 * against `now`. Returns null if the input is unparseable.
 *
 * Node's `tls.TLSSocket.getPeerCertificate().valid_to` is an OpenSSL
 * ASN.1 date string like `"Dec 31 00:00:00 2026 GMT"`. `Date.parse`
 * accepts this format.
 */
export function parseCertExpiry(
  rawValidTo: string | null | undefined,
  now: Date,
): ParsedCertExpiry | null {
  if (!rawValidTo) return null;
  const parsed = Date.parse(rawValidTo);
  if (Number.isNaN(parsed)) return null;
  const date = new Date(parsed);
  const daysUntilExpiry = Math.floor((date.getTime() - now.getTime()) / DAY_MS);
  return { date, daysUntilExpiry };
}

/**
 * Decide the next cert-renewal escalation level given the current
 * days-until-expiry and the previously-recorded level (which may be
 * undefined). Escalation is monotonic — once a row is at T-7 we do not
 * downgrade to T-14 even if the cert is somehow re-issued.
 */
export function computeNextEscalationLevel(
  daysUntilExpiry: number,
  previousLevel: CertRenewalEscalationLevel | undefined,
): CertRenewalEscalationLevel | null {
  // Order matters — evaluate most-urgent first.
  if (daysUntilExpiry < 1 && previousLevel !== "T-1") {
    return "T-1";
  }
  if (
    daysUntilExpiry < 7 &&
    previousLevel !== "T-1" &&
    previousLevel !== "T-7"
  ) {
    return "T-7";
  }
  if (daysUntilExpiry < 14 && previousLevel === undefined) {
    return "T-14";
  }
  return null;
}

/**
 * Is this row due for a re-probe in op 5? Skip rows whose
 * `last_reconciled_at` is within the cadence window.
 */
export function isDueForReprobe(
  lastReconciledAt: string | null,
  now: Date,
): boolean {
  if (lastReconciledAt === null) return true;
  const t = new Date(lastReconciledAt).getTime();
  if (Number.isNaN(t)) return true;
  return now.getTime() - t >= ACTIVE_HEALTH_REPROBE_INTERVAL_MS;
}

// ---------------------------------------------------------------------------
// Operation entry point
// ---------------------------------------------------------------------------

export async function runActiveHealth(
  ctx: OperationContext,
  config: SniProbeOpConfig,
): Promise<void> {
  const now = config.now?.() ?? new Date();
  const probeFn = config.probeFn ?? runSniProbe;

  const rows = await ctx.db
    .select()
    .from(regionCustomDomains)
    .where(eq(regionCustomDomains.lifecycleState, "active"))
    .limit(MAX_ROWS_PER_CYCLE);

  for (const row of rows) {
    if (!isDueForReprobe(row.lastReconciledAt, now)) {
      continue;
    }
    await reconcileOneActiveHealth(ctx, config, row, { now, probeFn });
  }
}

interface ReconcileDeps {
  now: Date;
  probeFn: (input: SniProbeInput) => Promise<SniProbeResult>;
}

export async function reconcileOneActiveHealth(
  ctx: OperationContext,
  config: SniProbeOpConfig,
  row: RegionCustomDomain,
  deps: ReconcileDeps,
): Promise<void> {
  const logFields = {
    domain_id: row.id,
    hostname: row.hostname,
    region: ctx.region,
  };
  const blob = readActiveHealthBlob(row.reconcilerError);

  const result = await deps.probeFn({
    targetIp: config.lbIpv4,
    hostname: row.hostname,
  });
  const success = isSniProbeSuccess(result);

  ctx.logger.info(
    success ? "active-health probe succeeded" : "active-health probe failed",
    {
      ...logFields,
      handshake_ok: result.handshake_ok,
      http_status: result.http_status,
      latency_ms: result.latency_ms,
      ...(result.error !== null ? { error: result.error } : {}),
    },
  );

  if (!success) {
    await handleProbeFailure(ctx, row, blob, result, deps.now);
    return;
  }

  // Success — persist per-region tracking + reset failure counter.
  const nowIso = deps.now.toISOString();
  const patch: Partial<RegionCustomDomain> = {
    probeLastAttemptedAt: nowIso,
    lastReconciledAt: nowIso,
    updatedAt: nowIso,
  };
  if (ctx.region === "us-central1") {
    patch.probeRegionUsCentral1LastSuccess = nowIso;
  } else if (ctx.region === "europe-west1") {
    patch.probeRegionEuropeWest1LastSuccess = nowIso;
  }
  if ((blob.consecutive_probe_failures ?? 0) > 0) {
    const resetBlob: ActiveHealthErrorBlob = {
      ...blob,
      consecutive_probe_failures: 0,
    };
    patch.reconcilerError = resetBlob;
  }
  await ctx.db
    .update(regionCustomDomains)
    .set(patch)
    .where(eq(regionCustomDomains.id, row.id));

  // Cert renewal escalation ladder runs regardless of probe-failure-reset
  // path — a passing probe can still carry a cert that's 3 days from expiry.
  await maybeEscalateCertRenewal(ctx, row, blob, result, deps.now);
}

// ---------------------------------------------------------------------------
// Probe failure path
// ---------------------------------------------------------------------------

async function handleProbeFailure(
  ctx: OperationContext,
  row: RegionCustomDomain,
  blob: ActiveHealthErrorBlob,
  result: SniProbeResult,
  now: Date,
): Promise<void> {
  const previous = blob.consecutive_probe_failures ?? 0;
  const next = previous + 1;
  const nowIso = now.toISOString();

  if (next < CONSECUTIVE_FAILURE_THRESHOLD) {
    // First failure — persist the counter and keep the row in 'active'.
    const updatedBlob: ActiveHealthErrorBlob = {
      ...blob,
      consecutive_probe_failures: next,
    };
    await ctx.db
      .update(regionCustomDomains)
      .set({
        probeLastAttemptedAt: nowIso,
        lastReconciledAt: nowIso,
        updatedAt: nowIso,
        reconcilerError: updatedBlob,
      })
      .where(eq(regionCustomDomains.id, row.id));
    ctx.logger.warn("active-health probe failed (1/2)", {
      domain_id: row.id,
      hostname: row.hostname,
      consecutive_probe_failures: next,
    });
    return;
  }

  // Second consecutive failure — transition to degraded.
  const driftPayload: ActiveHealthErrorBlob & Record<string, unknown> = {
    ...blob,
    consecutive_probe_failures: next,
    drift_kind: "unexpected_state",
    resource_type: "Certificate",
    resource_name: deterministicResourceName("Certificate", row.id),
    observed_spec: {
      handshake_ok: result.handshake_ok,
      http_status: result.http_status,
      error: result.error,
    },
    expected_spec: {
      handshake_ok: true,
      http_status: 200,
      redirect_platform_header_ok: true,
    },
    recoverable_from: "active",
    detected_at: nowIso,
    reconciler_run_id: ctx.reconcilerRunId,
    details: `active-health: ${String(CONSECUTIVE_FAILURE_THRESHOLD)} consecutive probe failures`,
  };
  const updated = await stateGuardedUpdate(ctx.db, {
    id: row.id,
    expectedState: "active",
    newState: "degraded",
    patch: { reconcilerError: driftPayload },
  });
  if (updated === null) {
    ctx.logger.info(
      "state guard failed on active → degraded (consecutive probe failures)",
      { domain_id: row.id },
    );
    return;
  }
  ctx.logger.drift({
    domainId: row.id,
    driftKind: "unexpected_state",
    resourceType: "Certificate",
    resourceName: deterministicResourceName("Certificate", row.id),
    observedSpec: driftPayload.observed_spec,
    expectedSpec: driftPayload.expected_spec,
    recoverableFrom: "active",
  });
  await appendDomainEvent(ctx.db, {
    domainId: row.id,
    eventType: "reconciler.active_health_failed",
    fromState: "active",
    toState: "degraded",
    details: { reconciler_error: driftPayload },
    reconcilerRunId: ctx.reconcilerRunId,
  });
}

// ---------------------------------------------------------------------------
// Cert renewal escalation ladder
// ---------------------------------------------------------------------------

async function maybeEscalateCertRenewal(
  ctx: OperationContext,
  row: RegionCustomDomain,
  blob: ActiveHealthErrorBlob,
  result: SniProbeResult,
  now: Date,
): Promise<void> {
  const parsed = parseCertExpiry(result.cert?.validTo ?? null, now);
  if (parsed === null) return;

  const nextLevel = computeNextEscalationLevel(
    parsed.daysUntilExpiry,
    blob.cert_renewal_escalation_level,
  );
  if (nextLevel === null) return;

  const nowIso = now.toISOString();
  const nextBlob: ActiveHealthErrorBlob & Record<string, unknown> = {
    ...blob,
    cert_renewal_escalation_level: nextLevel,
    drift_kind: "unexpected_state",
    resource_type: "Certificate",
    resource_name: deterministicResourceName("Certificate", row.id),
    observed_spec: {
      cert_expiry: result.cert?.validTo ?? null,
      days_until_expiry: parsed.daysUntilExpiry,
    },
    expected_spec: {
      cert_renewal_threshold_days: 14,
    },
    recoverable_from: "active",
    detected_at: nowIso,
    reconciler_run_id: ctx.reconcilerRunId,
    details: `cert renewal escalation ${nextLevel} (${String(parsed.daysUntilExpiry)} days until expiry)`,
  };

  const updated = await stateGuardedUpdate(ctx.db, {
    id: row.id,
    expectedState: "active",
    newState: "degraded",
    patch: { reconcilerError: nextBlob },
  });
  if (updated === null) {
    ctx.logger.info(
      "state guard failed on active → degraded (cert renewal escalation)",
      { domain_id: row.id, escalation_level: nextLevel },
    );
    return;
  }

  // Emit the structured renewal log. T-14 is WARNING (no page); T-7 and
  // T-1 go through certRenewal → CRITICAL → PagerDuty via the
  // redirect_platform_cert_renewal=true alert policy.
  if (nextLevel === "T-14") {
    ctx.logger.warn(
      `reconciler cert renewal escalation T-14 for ${row.id} (${String(parsed.daysUntilExpiry)} days until expiry)`,
      {
        domain_id: row.id,
        days_until_expiry: parsed.daysUntilExpiry,
        escalation_level: nextLevel,
        cert_expiry: result.cert?.validTo ?? null,
      },
    );
  } else {
    ctx.logger.certRenewal({
      domainId: row.id,
      daysUntilExpiry: parsed.daysUntilExpiry,
      escalationLevel: nextLevel,
    });
  }

  await appendDomainEvent(ctx.db, {
    domainId: row.id,
    eventType: "reconciler.cert_renewal_escalated",
    fromState: "active",
    toState: "degraded",
    details: {
      escalation_level: nextLevel,
      cert_expiry: result.cert?.validTo ?? null,
      days_until_expiry: parsed.daysUntilExpiry,
    },
    reconcilerRunId: ctx.reconcilerRunId,
  });
}
