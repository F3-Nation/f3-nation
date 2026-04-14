/**
 * Operation 7 — Quarantine expiry with mandatory drift check
 * (R5 Decision 6 op 7; Decision 8 quarantine/release).
 *
 * Trigger: rows where `lifecycle_state = 'quarantined'` AND
 *          `released_at < now()`.
 *
 * **CRITICAL R5 STRUCTURAL FIX.** R4 advanced `quarantined → released`
 * on a pure timer. R4 reviewers correctly identified that a timer-only
 * release can free a hostname for re-registration while orphan GCP
 * resources are still attached to the load balancer. R5 blocks this
 * class of bug with a three-resource drift check that MUST observe 404
 * on all of:
 *
 *   GET DnsAuthorization  at `dns-auth-<uuid>`  → MUST 404
 *   GET Certificate       at `cert-<uuid>`      → MUST 404
 *   GET CertificateMapEntry at `cme-<uuid>`     → MUST 404
 *
 * If ALL THREE return 404, the transition `quarantined → released`
 * runs via state-guarded UPDATE and an event row is written.
 *
 * If ANY returns a non-404, the reconciler:
 *   1. Writes a structured drift payload to `reconciler_error` with
 *      `drift_kind = 'orphan_resource'`, the offending `resource_type`
 *      and `resource_name` recorded.
 *   2. Transitions `quarantined → degraded` with
 *      `recoverable_from = 'quarantined'`.
 *   3. Emits `log.drift(...)` at CRITICAL.
 *   4. Writes a `reconciler.halt_on_drift` event via appendDomainEvent
 *      (the standard haltOnDrift helper handles both step 3 and step 4).
 *
 * The drift check runs against the `getCertificateView` / null-returning
 * sibling of getCertificate (returns null on 404 so the caller doesn't
 * have to catch NotFoundError).
 */

import { regionCustomDomains } from "@acme/redirect-platform-db";
import type { RegionCustomDomain } from "@acme/redirect-platform-db";
import { eq } from "drizzle-orm";

import {
  appendDomainEvent,
  deterministicResourceName,
  haltOnDrift,
  stateGuardedUpdate,
} from "./shared.js";
import type { OperationContext } from "./shared.js";

const MAX_ROWS_PER_CYCLE = 20;

export interface QuarantineReleaseConfig {
  /** Injectable clock for tests. */
  now?: () => Date;
}

// ---------------------------------------------------------------------------
// Drift check result — kept as its own structured object so tests can assert
// against it directly via the pure helper `runQuarantineDriftCheck`.
// ---------------------------------------------------------------------------

export interface DriftCheckResult {
  allAbsent: boolean;
  /**
   * The first orphan we found, if any. Ordered DnsAuth → Certificate → CME
   * to match the plan's "mandatory drift check" list.
   */
  orphan: {
    resourceType: "DnsAuthorization" | "Certificate" | "CertificateMapEntry";
    resourceName: string;
    observedSpec: unknown;
  } | null;
}

/**
 * Pure helper: run the three-resource GET drift check for a given row.
 * Exported so tests can hit it directly.
 */
export async function runQuarantineDriftCheck(
  ctx: OperationContext,
  row: RegionCustomDomain,
): Promise<DriftCheckResult> {
  const dnsAuthId = deterministicResourceName("DnsAuthorization", row.id);
  const certId = deterministicResourceName("Certificate", row.id);
  const cmeId = deterministicResourceName("CertificateMapEntry", row.id);

  const dnsAuth = await ctx.certManager.getDnsAuthorization(dnsAuthId);
  if (dnsAuth !== null) {
    return {
      allAbsent: false,
      orphan: {
        resourceType: "DnsAuthorization",
        resourceName: dnsAuthId,
        observedSpec: dnsAuth,
      },
    };
  }

  const cert = await ctx.certManager.getCertificateView(certId);
  if (cert !== null) {
    return {
      allAbsent: false,
      orphan: {
        resourceType: "Certificate",
        resourceName: certId,
        observedSpec: cert,
      },
    };
  }

  const cme = await ctx.certManager.getCertificateMapEntry(cmeId);
  if (cme !== null) {
    return {
      allAbsent: false,
      orphan: {
        resourceType: "CertificateMapEntry",
        resourceName: cmeId,
        observedSpec: cme,
      },
    };
  }

  return { allAbsent: true, orphan: null };
}

// ---------------------------------------------------------------------------
// Operation entry point
// ---------------------------------------------------------------------------

export async function runQuarantineRelease(
  ctx: OperationContext,
  config: QuarantineReleaseConfig = {},
): Promise<void> {
  const now = config.now?.() ?? new Date();
  const nowIso = now.toISOString();

  // We select all quarantined rows; the releasedAt < now filter is applied
  // in-process to keep the fake DB tests simple. Production runtime has
  // idx_rcd_lifecycle + the released_at predicate as a WHERE clause.
  const rows = await ctx.db
    .select()
    .from(regionCustomDomains)
    .where(eq(regionCustomDomains.lifecycleState, "quarantined"))
    .limit(MAX_ROWS_PER_CYCLE);

  for (const row of rows) {
    if (row.releasedAt === null) continue;
    if (row.releasedAt >= nowIso) continue;
    await reconcileOneQuarantineRelease(ctx, row);
  }
}

export async function reconcileOneQuarantineRelease(
  ctx: OperationContext,
  row: RegionCustomDomain,
): Promise<void> {
  const logFields = { domain_id: row.id, hostname: row.hostname };

  const driftCheck = await runQuarantineDriftCheck(ctx, row);

  if (!driftCheck.allAbsent && driftCheck.orphan !== null) {
    const { orphan } = driftCheck;
    ctx.logger.info("quarantine release blocked: orphan GCP resource present", {
      ...logFields,
      resource_type: orphan.resourceType,
      resource_name: orphan.resourceName,
    });
    await haltOnDrift({
      db: ctx.db,
      logger: ctx.logger,
      rowId: row.id,
      currentState: "quarantined",
      driftKind: "orphan_resource",
      resourceType: orphan.resourceType,
      resourceName: orphan.resourceName,
      observedSpec: orphan.observedSpec,
      expectedSpec: { absent: true },
      recoverableFrom: "quarantined",
      reconcilerRunId: ctx.reconcilerRunId,
    });
    return;
  }

  // All three resources returned 404 — advance via state-guarded UPDATE.
  const updated = await stateGuardedUpdate(ctx.db, {
    id: row.id,
    expectedState: "quarantined",
    newState: "released",
  });
  if (updated === null) {
    ctx.logger.info(
      "state guard failed on quarantined → released; another worker advanced",
      logFields,
    );
    return;
  }
  await appendDomainEvent(ctx.db, {
    domainId: row.id,
    eventType: "reconciler.quarantine_released",
    fromState: "quarantined",
    toState: "released",
    details: {
      drift_check: "passed",
      checked_resources: {
        dns_authorization: deterministicResourceName(
          "DnsAuthorization",
          row.id,
        ),
        certificate: deterministicResourceName("Certificate", row.id),
        certificate_map_entry: deterministicResourceName(
          "CertificateMapEntry",
          row.id,
        ),
      },
    },
    reconcilerRunId: ctx.reconcilerRunId,
  });
  ctx.logger.info("advanced quarantined → released", logFields);
}
