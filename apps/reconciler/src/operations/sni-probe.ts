/**
 * Operation 3 — SNI probe before cutover (R5 Decision 4).
 *
 * Trigger: rows where lifecycle_state = 'awaiting_probe'.
 *
 * For each row:
 *
 *   1. Resolve the LB static IPv4 from env (`REDIRECT_LB_IPV4`). No DNS.
 *   2. Run `runSniProbe` from the probe module. The probe dials the IP
 *      directly with SNI = tenant hostname and verifies the TLS handshake,
 *      `/health` → 200, `x-redirect-platform: ok` header.
 *   3. Update per-region `probe_region_<this_region>_last_success` and the
 *      `probe_last_result_detail` JSONB blob. On success in BOTH regions
 *      (fresh within 3 minutes), increment `probe_consecutive_successes`.
 *      On failure, reset to 0.
 *   4. If the row has `probe_consecutive_successes >= 3` AND both regions'
 *      last success is within 3 minutes, transition to `awaiting_cutover`
 *      via state-guarded UPDATE.
 *   5. If the row has been in `awaiting_probe` > 2 hours, transition to
 *      `degraded` with `recoverable_from = 'awaiting_probe'`.
 *
 * **CRITICAL INVARIANT:** this operation does not resolve public DNS for
 * the tenant hostname anywhere in the probe path. The probe socket dials
 * `targetIp` (a numeric IPv4 from config), and `servername` drives TLS
 * cert validation. Violating this re-certifies the old stack.
 */

import {
  regionCustomDomainEvents,
  regionCustomDomains,
} from "@acme/redirect-platform-db";
import type { RegionCustomDomain } from "@acme/redirect-platform-db";
import { desc, eq } from "drizzle-orm";

import { isSniProbeSuccess, runSniProbe } from "../probe/index.js";
import type { SniProbeInput, SniProbeResult } from "../probe/index.js";
import {
  appendDomainEvent,
  stateGuardedUpdate,
  touchReconciledAt,
} from "./shared.js";
import type { OperationContext } from "./shared.js";

const MAX_ROWS_PER_CYCLE = 20;
const FRESHNESS_WINDOW_MS = 3 * 60 * 1000; // 3 minutes
const REQUIRED_CONSECUTIVE_SUCCESSES = 3;
const HARD_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

export interface SniProbeOpConfig {
  /** LB static IPv4 — read from REDIRECT_LB_IPV4 env var at cycle start. */
  lbIpv4: string;
  /** Optional LB static IPv6. */
  lbIpv6?: string;
  /** Injectable probe runner (test seam). */
  probeFn?: (input: SniProbeInput) => Promise<SniProbeResult>;
  /** Injectable clock (test seam). */
  now?: () => Date;
}

export class MissingLbIpError extends Error {
  constructor() {
    super(
      "REDIRECT_LB_IPV4 is not set; SNI probe requires the LB static IP (Terraform output lb_ipv4_address). Refusing to run op 3.",
    );
    this.name = "MissingLbIpError";
  }
}

export function loadSniProbeConfig(
  env: NodeJS.ProcessEnv = process.env,
): SniProbeOpConfig {
  const lbIpv4 = env.REDIRECT_LB_IPV4;
  if (!lbIpv4) {
    throw new MissingLbIpError();
  }
  return {
    lbIpv4,
    ...(env.REDIRECT_LB_IPV6 ? { lbIpv6: env.REDIRECT_LB_IPV6 } : {}),
  };
}

// ---------------------------------------------------------------------------
// Per-region probe detail tracking (JSONB blob shape)
// ---------------------------------------------------------------------------

interface PerRegionDetail {
  last_attempted_at: string;
  handshake_ok: boolean;
  http_status: number | null;
  cert_serial: string | null;
  cert_expiry: string | null;
  latency_ms: number;
  error: string | null;
}

interface ProbeDetailBlob {
  /** Most recent probe (either region). */
  handshake_ok: boolean;
  http_status: number | null;
  cert_serial: string | null;
  cert_expiry: string | null;
  latency_ms: number;
  per_region: {
    us_central1?: PerRegionDetail;
    europe_west1?: PerRegionDetail;
  };
}

function probeResultToPerRegion(
  result: SniProbeResult,
  now: Date,
): PerRegionDetail {
  return {
    last_attempted_at: now.toISOString(),
    handshake_ok: result.handshake_ok,
    http_status: result.http_status,
    cert_serial: result.cert?.serialNumber ?? null,
    cert_expiry: result.cert?.validTo ?? null,
    latency_ms: result.latency_ms,
    error: result.error,
  };
}

function isExistingBlob(value: unknown): value is ProbeDetailBlob {
  return (
    typeof value === "object" &&
    value !== null &&
    "per_region" in (value as Record<string, unknown>)
  );
}

function mergeProbeDetail(
  existing: unknown,
  region: string,
  perRegion: PerRegionDetail,
  result: SniProbeResult,
): ProbeDetailBlob {
  const base: ProbeDetailBlob = isExistingBlob(existing)
    ? existing
    : {
        handshake_ok: false,
        http_status: null,
        cert_serial: null,
        cert_expiry: null,
        latency_ms: 0,
        per_region: {},
      };
  const per_region: ProbeDetailBlob["per_region"] = { ...base.per_region };
  if (region === "us-central1") {
    per_region.us_central1 = perRegion;
  } else if (region === "europe-west1") {
    per_region.europe_west1 = perRegion;
  }
  return {
    handshake_ok: result.handshake_ok,
    http_status: result.http_status,
    cert_serial: result.cert?.serialNumber ?? null,
    cert_expiry: result.cert?.validTo ?? null,
    latency_ms: result.latency_ms,
    per_region,
  };
}

// ---------------------------------------------------------------------------
// Freshness + advance criteria
// ---------------------------------------------------------------------------

function isFresh(timestamp: string | null | undefined, now: Date): boolean {
  if (!timestamp) return false;
  const t = new Date(timestamp).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t <= FRESHNESS_WINDOW_MS;
}

export interface BothRegionsFreshInput {
  probeRegionUsCentral1LastSuccess: string | null;
  probeRegionEuropeWest1LastSuccess: string | null;
  now: Date;
}

export function bothRegionsFresh(input: BothRegionsFreshInput): boolean {
  return (
    isFresh(input.probeRegionUsCentral1LastSuccess, input.now) &&
    isFresh(input.probeRegionEuropeWest1LastSuccess, input.now)
  );
}

/**
 * Find when the row entered `awaiting_probe`. Used to enforce the 2-hour
 * hard timeout. Returns null if we can't find the transition event, in
 * which case the caller falls back to `created_at`.
 */
export async function findAwaitingProbeEnteredAt(
  ctx: OperationContext,
  domainId: string,
): Promise<Date | null> {
  const rows = await ctx.db
    .select()
    .from(regionCustomDomainEvents)
    .where(eq(regionCustomDomainEvents.domainId, domainId))
    .orderBy(desc(regionCustomDomainEvents.createdAt))
    .limit(50);
  // Find the most recent event whose to_state is 'awaiting_probe'.
  for (const event of rows) {
    if (event.toState === "awaiting_probe") {
      return new Date(event.createdAt);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Operation entry point
// ---------------------------------------------------------------------------

export async function runSniProbeOperation(
  ctx: OperationContext,
  config: SniProbeOpConfig,
): Promise<void> {
  const now = config.now?.() ?? new Date();
  const probeFn = config.probeFn ?? runSniProbe;

  const rows = await ctx.db
    .select()
    .from(regionCustomDomains)
    .where(eq(regionCustomDomains.lifecycleState, "awaiting_probe"))
    .limit(MAX_ROWS_PER_CYCLE);

  for (const row of rows) {
    await reconcileOneSniProbe(ctx, config, row, {
      now,
      probeFn,
    });
  }
}

interface ReconcileOneDeps {
  now: Date;
  probeFn: (input: SniProbeInput) => Promise<SniProbeResult>;
}

export async function reconcileOneSniProbe(
  ctx: OperationContext,
  config: SniProbeOpConfig,
  row: RegionCustomDomain,
  deps: ReconcileOneDeps,
): Promise<void> {
  const logFields = {
    domain_id: row.id,
    hostname: row.hostname,
    region: ctx.region,
  };

  const result = await deps.probeFn({
    targetIp: config.lbIpv4,
    hostname: row.hostname,
  });
  const success = isSniProbeSuccess(result);
  const perRegion = probeResultToPerRegion(result, deps.now);
  const mergedBlob = mergeProbeDetail(
    row.probeLastResultDetail,
    ctx.region,
    perRegion,
    result,
  );

  ctx.logger.info(success ? "sni probe succeeded" : "sni probe failed", {
    ...logFields,
    handshake_ok: result.handshake_ok,
    http_status: result.http_status,
    cert_serial: result.cert?.serialNumber ?? null,
    latency_ms: result.latency_ms,
    ...(result.error !== null ? { error: result.error } : {}),
  });

  const nowIso = deps.now.toISOString();
  const patch: Partial<RegionCustomDomain> = {
    probeLastAttemptedAt: nowIso,
    probeLastResultDetail: mergedBlob,
  };

  if (success) {
    if (ctx.region === "us-central1") {
      patch.probeRegionUsCentral1LastSuccess = nowIso;
    } else if (ctx.region === "europe-west1") {
      patch.probeRegionEuropeWest1LastSuccess = nowIso;
    }
    const otherRegionFresh =
      ctx.region === "us-central1"
        ? isFresh(row.probeRegionEuropeWest1LastSuccess, deps.now)
        : isFresh(row.probeRegionUsCentral1LastSuccess, deps.now);
    if (otherRegionFresh) {
      // Both regions have fresh green results — increment the counter.
      patch.probeConsecutiveSuccesses =
        (row.probeConsecutiveSuccesses ?? 0) + 1;
    }
  } else {
    patch.probeConsecutiveSuccesses = 0;
  }

  // Short DB op to persist probe tracking.
  await ctx.db
    .update(regionCustomDomains)
    .set(patch)
    .where(eq(regionCustomDomains.id, row.id));

  // Re-read relevant fields to decide the state transition.
  const projectedUs =
    ctx.region === "us-central1" && success
      ? nowIso
      : row.probeRegionUsCentral1LastSuccess;
  const projectedEu =
    ctx.region === "europe-west1" && success
      ? nowIso
      : row.probeRegionEuropeWest1LastSuccess;
  const projectedConsecutive = patch.probeConsecutiveSuccesses ?? 0;

  // Advance criteria: >=3 consecutive successes AND both regions fresh.
  if (
    projectedConsecutive >= REQUIRED_CONSECUTIVE_SUCCESSES &&
    bothRegionsFresh({
      probeRegionUsCentral1LastSuccess: projectedUs,
      probeRegionEuropeWest1LastSuccess: projectedEu,
      now: deps.now,
    })
  ) {
    const updated = await stateGuardedUpdate(ctx.db, {
      id: row.id,
      expectedState: "awaiting_probe",
      newState: "awaiting_cutover",
    });
    if (updated !== null) {
      await appendDomainEvent(ctx.db, {
        domainId: row.id,
        eventType: "reconciler.probe_advanced",
        fromState: "awaiting_probe",
        toState: "awaiting_cutover",
        details: { probe_result: mergedBlob },
        reconcilerRunId: ctx.reconcilerRunId,
      });
      ctx.logger.info("advanced awaiting_probe → awaiting_cutover", logFields);
    }
    return;
  }

  // 2-hour hard timeout.
  const enteredAt =
    (await findAwaitingProbeEnteredAt(ctx, row.id)) ?? new Date(row.createdAt);
  if (deps.now.getTime() - enteredAt.getTime() > HARD_TIMEOUT_MS) {
    await transitionToDegradedOnTimeout(ctx, row, mergedBlob);
    return;
  }

  // Otherwise nothing to do beyond the patch already persisted.
  await touchReconciledAt(ctx.db, row.id);
}

async function transitionToDegradedOnTimeout(
  ctx: OperationContext,
  row: RegionCustomDomain,
  mergedBlob: ProbeDetailBlob,
): Promise<void> {
  const payload = {
    drift_kind: "unexpected_state" as const,
    resource_type: "Certificate" as const,
    resource_name: `cert-${row.id}`,
    observed_spec: mergedBlob,
    expected_spec: {
      probe_consecutive_successes_required: REQUIRED_CONSECUTIVE_SUCCESSES,
      freshness_window_ms: FRESHNESS_WINDOW_MS,
    },
    recoverable_from: "awaiting_probe" as const,
    detected_at: new Date().toISOString(),
    reconciler_run_id: ctx.reconcilerRunId,
    details: "awaiting_probe hard timeout exceeded (2 hours)",
  };
  const updated = await stateGuardedUpdate(ctx.db, {
    id: row.id,
    expectedState: "awaiting_probe",
    newState: "degraded",
    patch: { reconcilerError: payload },
  });
  if (updated === null) return;
  ctx.logger.drift({
    domainId: row.id,
    driftKind: "unexpected_state",
    resourceType: "Certificate",
    resourceName: `cert-${row.id}`,
    observedSpec: mergedBlob,
    expectedSpec: payload.expected_spec,
    recoverableFrom: "awaiting_probe",
  });
  await appendDomainEvent(ctx.db, {
    domainId: row.id,
    eventType: "reconciler.probe_hard_timeout",
    fromState: "awaiting_probe",
    toState: "degraded",
    details: { reconciler_error: payload },
    reconcilerRunId: ctx.reconcilerRunId,
  });
}
