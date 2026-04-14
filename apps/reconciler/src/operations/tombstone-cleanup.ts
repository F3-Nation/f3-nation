/**
 * Operation 6 — Tombstone cleanup (R5 Decision 6, op 6; Decision 8 deletion).
 *
 * Trigger: rows where `lifecycle_state = 'tombstoned'`.
 *
 * Deletes GCP Cert Manager resources in reverse dependency order and
 * advances the row to `quarantined` with `released_at = now() + 30 days`.
 *
 * Reverse order (dependency chain):
 *
 *   CertificateMapEntry → Certificate → DnsAuthorization
 *
 * Each DELETE is verified by a follow-up GET that MUST return 404 before
 * we proceed to the next resource. The deletes themselves are idempotent:
 * `cert-manager-client` maps NOT_FOUND to success.
 *
 * Error handling:
 *
 *   - NOT_FOUND on DELETE (resource already gone) → treated as success,
 *     continue to the next resource.
 *   - `FAILED_PRECONDITION` on CertificateMapEntry DELETE (the plan names
 *     this explicitly as "unexpected_state" drift — it means the map
 *     entry still has a dependency we don't understand) → halt-on-drift
 *     with `drift_kind = 'unexpected_state'`.
 *   - `PERMISSION_DENIED` → halt-on-drift with `drift_kind = 'unexpected_state'`
 *     on whichever resource we were touching.
 *
 * Crash-recovery idempotence:
 *   The operation is re-entrant. If we crashed after DELETEing the CME
 *   but before DELETEing the Certificate, the next cycle will GET the
 *   CME (404 → already gone), skip the DELETE, GET the Certificate,
 *   DELETE, and continue.
 */

import { regionCustomDomains } from "@acme/redirect-platform-db";
import type { RegionCustomDomain } from "@acme/redirect-platform-db";
import { eq } from "drizzle-orm";

import { NotFoundError, PermissionDeniedError } from "../gcp/index.js";
import {
  appendDomainEvent,
  deterministicResourceName,
  haltOnDrift,
  stateGuardedUpdate,
  touchReconciledAt,
} from "./shared.js";
import type { OperationContext } from "./shared.js";

const MAX_ROWS_PER_CYCLE = 20;
export const QUARANTINE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * FAILED_PRECONDITION maps to gRPC status 9. The cert-manager-client
 * only translates NOT_FOUND / ALREADY_EXISTS / PERMISSION_DENIED to
 * typed errors today — FAILED_PRECONDITION passes through as the raw
 * gax error, so we detect it here via shape-narrowing.
 */
const GRPC_STATUS_FAILED_PRECONDITION = 9;

interface GaxLikeError {
  code?: number;
  message?: string;
}

function isFailedPrecondition(err: unknown): err is GaxLikeError {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as GaxLikeError).code;
  return code === GRPC_STATUS_FAILED_PRECONDITION;
}

// ---------------------------------------------------------------------------
// Operation entry point
// ---------------------------------------------------------------------------

export async function runTombstoneCleanup(
  ctx: OperationContext,
): Promise<void> {
  const rows = await ctx.db
    .select()
    .from(regionCustomDomains)
    .where(eq(regionCustomDomains.lifecycleState, "tombstoned"))
    .limit(MAX_ROWS_PER_CYCLE);

  for (const row of rows) {
    await reconcileOneTombstoneCleanup(ctx, row);
  }
}

export async function reconcileOneTombstoneCleanup(
  ctx: OperationContext,
  row: RegionCustomDomain,
): Promise<void> {
  const logFields = { domain_id: row.id, hostname: row.hostname };
  const cmeId = deterministicResourceName("CertificateMapEntry", row.id);
  const certId = deterministicResourceName("Certificate", row.id);
  const dnsAuthId = deterministicResourceName("DnsAuthorization", row.id);

  // 1. CertificateMapEntry
  if (!(await deleteAndConfirmCme(ctx, row, cmeId))) return;

  // 2. Certificate
  if (!(await deleteAndConfirmCertificate(ctx, row, certId))) return;

  // 3. DnsAuthorization
  if (!(await deleteAndConfirmDnsAuthorization(ctx, row, dnsAuthId))) return;

  // All three gone — advance tombstoned → quarantined, released_at now + 30d
  const releasedAt = new Date(Date.now() + QUARANTINE_PERIOD_MS).toISOString();
  const updated = await stateGuardedUpdate(ctx.db, {
    id: row.id,
    expectedState: "tombstoned",
    newState: "quarantined",
    patch: {
      releasedAt,
      // Clear any prior reconciler_error — the row is clean from here.
      reconcilerError: null,
    },
  });
  if (updated === null) {
    ctx.logger.info(
      "state guard failed on tombstoned → quarantined; another worker advanced",
      logFields,
    );
    return;
  }
  await appendDomainEvent(ctx.db, {
    domainId: row.id,
    eventType: "reconciler.tombstone_cleanup",
    fromState: "tombstoned",
    toState: "quarantined",
    details: {
      deleted_cme_id: cmeId,
      deleted_certificate_id: certId,
      deleted_dns_authorization_id: dnsAuthId,
      released_at: releasedAt,
    },
    reconcilerRunId: ctx.reconcilerRunId,
  });
  ctx.logger.info("advanced tombstoned → quarantined", {
    ...logFields,
    released_at: releasedAt,
  });
}

// ---------------------------------------------------------------------------
// DELETE + confirm helpers — return true if we should continue to the next
// resource; false if we halted (halt-on-drift) or hit a state-guard abort.
// ---------------------------------------------------------------------------

async function deleteAndConfirmCme(
  ctx: OperationContext,
  row: RegionCustomDomain,
  cmeId: string,
): Promise<boolean> {
  try {
    await ctx.certManager.deleteCertificateMapEntry(cmeId);
  } catch (err) {
    if (isFailedPrecondition(err)) {
      await haltOnDrift({
        db: ctx.db,
        logger: ctx.logger,
        rowId: row.id,
        currentState: "tombstoned",
        driftKind: "unexpected_state",
        resourceType: "CertificateMapEntry",
        resourceName: cmeId,
        observedSpec: { error: err.message ?? "FAILED_PRECONDITION" },
        expectedSpec: { can_delete: true },
        recoverableFrom: "tombstoned",
        reconcilerRunId: ctx.reconcilerRunId,
      });
      return false;
    }
    if (err instanceof PermissionDeniedError) {
      await haltOnDrift({
        db: ctx.db,
        logger: ctx.logger,
        rowId: row.id,
        currentState: "tombstoned",
        driftKind: "unexpected_state",
        resourceType: "CertificateMapEntry",
        resourceName: cmeId,
        observedSpec: { error: "PERMISSION_DENIED" },
        expectedSpec: { can_delete: true },
        recoverableFrom: "tombstoned",
        reconcilerRunId: ctx.reconcilerRunId,
      });
      return false;
    }
    throw err;
  }

  // Follow-up GET MUST return 404.
  const stillThere = await ctx.certManager.getCertificateMapEntry(cmeId);
  if (stillThere !== null) {
    await touchReconciledAt(ctx.db, row.id);
    ctx.logger.warn(
      "tombstone cleanup: CME DELETE settled but follow-up GET returned non-404; will retry next cycle",
      { domain_id: row.id, cme_id: cmeId },
    );
    return false;
  }
  return true;
}

async function deleteAndConfirmCertificate(
  ctx: OperationContext,
  row: RegionCustomDomain,
  certId: string,
): Promise<boolean> {
  try {
    await ctx.certManager.deleteCertificate(certId);
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      await haltOnDrift({
        db: ctx.db,
        logger: ctx.logger,
        rowId: row.id,
        currentState: "tombstoned",
        driftKind: "unexpected_state",
        resourceType: "Certificate",
        resourceName: certId,
        observedSpec: { error: "PERMISSION_DENIED" },
        expectedSpec: { can_delete: true },
        recoverableFrom: "tombstoned",
        reconcilerRunId: ctx.reconcilerRunId,
      });
      return false;
    }
    throw err;
  }

  const stillThere = await ctx.certManager.getCertificateView(certId);
  if (stillThere !== null) {
    await touchReconciledAt(ctx.db, row.id);
    ctx.logger.warn(
      "tombstone cleanup: Certificate DELETE settled but follow-up GET returned non-404; will retry next cycle",
      { domain_id: row.id, cert_id: certId },
    );
    return false;
  }
  return true;
}

async function deleteAndConfirmDnsAuthorization(
  ctx: OperationContext,
  row: RegionCustomDomain,
  dnsAuthId: string,
): Promise<boolean> {
  try {
    await ctx.certManager.deleteDnsAuthorization(dnsAuthId);
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      await haltOnDrift({
        db: ctx.db,
        logger: ctx.logger,
        rowId: row.id,
        currentState: "tombstoned",
        driftKind: "unexpected_state",
        resourceType: "DnsAuthorization",
        resourceName: dnsAuthId,
        observedSpec: { error: "PERMISSION_DENIED" },
        expectedSpec: { can_delete: true },
        recoverableFrom: "tombstoned",
        reconcilerRunId: ctx.reconcilerRunId,
      });
      return false;
    }
    throw err;
  }

  const stillThere = await ctx.certManager.getDnsAuthorization(dnsAuthId);
  if (stillThere !== null) {
    await touchReconciledAt(ctx.db, row.id);
    ctx.logger.warn(
      "tombstone cleanup: DnsAuthorization DELETE settled but follow-up GET returned non-404; will retry next cycle",
      { domain_id: row.id, dns_auth_id: dnsAuthId },
    );
    return false;
  }
  return true;
}

// NotFoundError is re-exported upstream by the cert-manager-client module.
// We don't catch it explicitly in this file because `delete*` methods map
// NOT_FOUND to success internally — the DELETE calls return void without
// throwing. We keep the import path here in case future refactors want to
// surface NotFoundError to callers again.
export { NotFoundError };
