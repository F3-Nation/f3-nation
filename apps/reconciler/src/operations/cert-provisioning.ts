/**
 * Operation 2 — Cert provisioning
 *
 * Trigger: rows where lifecycle_state = 'provisioning_cert'.
 *
 * Flow (R5 Decision 6, op 2):
 *
 *   1. GET Certificate at `cert-<uuid>`.
 *   2. Inspect managed.state:
 *       - PROVISIONING → no-op, bump last_reconciled_at.
 *       - ACTIVE → GET CertificateMapEntry at `cme-<uuid>`. 404 → CREATE.
 *         ALREADY_EXISTS → re-GET + verify spec. Mismatch → halt-on-drift.
 *         On attach success, advance to `awaiting_probe`.
 *       - FAILED → extract authorizationAttemptInfo[0].details, write to
 *         reconciler_error.details, transition to `degraded` with
 *         recoverable_from = 'awaiting_dns_challenge'.
 */

import { regionCustomDomains } from "@acme/redirect-platform-db";
import type { RegionCustomDomain } from "@acme/redirect-platform-db";
import { eq } from "drizzle-orm";

import { AlreadyExistsError, NotFoundError } from "../gcp/index.js";
import type { CertificateMapEntryView } from "../gcp/index.js";
import {
  SpecMismatchError,
  appendDomainEvent,
  deterministicResourceName,
  haltOnDrift,
  handleAlreadyExists,
  stateGuardedUpdate,
  touchReconciledAt,
} from "./shared.js";
import type { OperationContext } from "./shared.js";

const MAX_ROWS_PER_CYCLE = 20;

interface PlannedCmeSpec {
  hostname: string;
  certificateName: string;
}

export function cmeSpecMatches(
  existing: CertificateMapEntryView,
  planned: PlannedCmeSpec,
): boolean {
  if (existing.hostname !== planned.hostname) return false;
  return existing.certificates.includes(planned.certificateName);
}

export async function runCertProvisioning(
  ctx: OperationContext,
): Promise<void> {
  const rows = await ctx.db
    .select()
    .from(regionCustomDomains)
    .where(eq(regionCustomDomains.lifecycleState, "provisioning_cert"))
    .limit(MAX_ROWS_PER_CYCLE);

  for (const row of rows) {
    await reconcileOneCertProvisioning(ctx, row);
  }
}

export async function reconcileOneCertProvisioning(
  ctx: OperationContext,
  row: RegionCustomDomain,
): Promise<void> {
  const certId = deterministicResourceName("Certificate", row.id);
  const certResourcePath = ctx.certManager.certificateResourcePath(certId);
  const logFields = { domain_id: row.id, hostname: row.hostname };

  const cert = await ctx.certManager.getCertificate(certId);

  if (!cert.managed) {
    await haltOnDrift({
      db: ctx.db,
      logger: ctx.logger,
      rowId: row.id,
      currentState: "provisioning_cert",
      driftKind: "unexpected_state",
      resourceType: "Certificate.managed",
      resourceName: certResourcePath,
      observedSpec: cert,
      expectedSpec: { managed: "required" },
      recoverableFrom: "awaiting_dns_challenge",
      reconcilerRunId: ctx.reconcilerRunId,
    });
    return;
  }

  switch (cert.managed.state) {
    case "PROVISIONING":
    case "AUTHORIZING":
    case "PENDING": {
      ctx.logger.info("certificate still provisioning", {
        ...logFields,
        managed_state: cert.managed.state,
      });
      await touchReconciledAt(ctx.db, row.id);
      return;
    }
    case "ACTIVE": {
      await attachCertificateMapEntry(ctx, row, certResourcePath);
      return;
    }
    case "FAILED": {
      await handleFailedCertificate(ctx, row, cert.managed.failureDetails);
      return;
    }
    default: {
      ctx.logger.warn("certificate in unknown managed.state; waiting", {
        ...logFields,
        managed_state: cert.managed.state,
      });
      await touchReconciledAt(ctx.db, row.id);
      return;
    }
  }
}

async function attachCertificateMapEntry(
  ctx: OperationContext,
  row: RegionCustomDomain,
  certResourcePath: string,
): Promise<void> {
  const entryId = deterministicResourceName("CertificateMapEntry", row.id);
  const plannedSpec: PlannedCmeSpec = {
    hostname: row.hostname,
    certificateName: certResourcePath,
  };

  const existing = await ctx.certManager.getCertificateMapEntry(entryId);
  if (existing !== null) {
    if (!cmeSpecMatches(existing, plannedSpec)) {
      await haltOnDrift({
        db: ctx.db,
        logger: ctx.logger,
        rowId: row.id,
        currentState: "provisioning_cert",
        driftKind: "spec_mismatch",
        resourceType: "CertificateMapEntry",
        resourceName: existing.name,
        observedSpec: existing,
        expectedSpec: plannedSpec,
        recoverableFrom: "provisioning_cert",
        reconcilerRunId: ctx.reconcilerRunId,
      });
      return;
    }
    await advanceToAwaitingProbe(ctx, row, entryId);
    return;
  }

  // 404 → CREATE with ALREADY_EXISTS fall-through.
  try {
    await ctx.certManager.createCertificateMapEntry({
      entryId,
      hostname: row.hostname,
      certificateName: certResourcePath,
    });
  } catch (err) {
    if (err instanceof AlreadyExistsError) {
      try {
        await handleAlreadyExists<CertificateMapEntryView, PlannedCmeSpec>({
          resourceKind: "CertificateMapEntry",
          rowId: row.id,
          resourceName: entryId,
          plannedSpec,
          getFn: async () => ctx.certManager.getCertificateMapEntry(entryId),
          specMatches: cmeSpecMatches,
        });
      } catch (resolveErr) {
        if (resolveErr instanceof SpecMismatchError) {
          await haltOnDrift({
            db: ctx.db,
            logger: ctx.logger,
            rowId: row.id,
            currentState: "provisioning_cert",
            driftKind: "spec_mismatch",
            resourceType: "CertificateMapEntry",
            resourceName: entryId,
            observedSpec: resolveErr.observedSpec,
            expectedSpec: resolveErr.expectedSpec,
            recoverableFrom: "provisioning_cert",
            reconcilerRunId: ctx.reconcilerRunId,
          });
          return;
        }
        if (resolveErr instanceof NotFoundError) {
          ctx.logger.warn(
            "ALREADY_EXISTS fallback re-GET returned 404; will retry next cycle",
            { domain_id: row.id },
          );
          await touchReconciledAt(ctx.db, row.id);
          return;
        }
        throw resolveErr;
      }
    } else {
      throw err;
    }
  }

  await advanceToAwaitingProbe(ctx, row, entryId);
}

async function advanceToAwaitingProbe(
  ctx: OperationContext,
  row: RegionCustomDomain,
  entryId: string,
): Promise<void> {
  const updated = await stateGuardedUpdate(ctx.db, {
    id: row.id,
    expectedState: "provisioning_cert",
    newState: "awaiting_probe",
    patch: {
      gcpCertMapEntryId: entryId,
      probeConsecutiveSuccesses: 0,
    },
  });
  if (updated === null) {
    ctx.logger.info(
      "state guard failed on provisioning_cert → awaiting_probe",
      { domain_id: row.id },
    );
    return;
  }
  await appendDomainEvent(ctx.db, {
    domainId: row.id,
    eventType: "reconciler.cert_active_attached",
    fromState: "provisioning_cert",
    toState: "awaiting_probe",
    details: { cert_map_entry_id: entryId },
    reconcilerRunId: ctx.reconcilerRunId,
  });
  ctx.logger.info("advanced provisioning_cert → awaiting_probe", {
    domain_id: row.id,
    hostname: row.hostname,
  });
}

async function handleFailedCertificate(
  ctx: OperationContext,
  row: RegionCustomDomain,
  failureDetails: string | null,
): Promise<void> {
  const certId = deterministicResourceName("Certificate", row.id);
  const certResourcePath = ctx.certManager.certificateResourcePath(certId);

  await haltOnDrift({
    db: ctx.db,
    logger: ctx.logger,
    rowId: row.id,
    currentState: "provisioning_cert",
    driftKind: "unexpected_state",
    resourceType: "Certificate",
    resourceName: certResourcePath,
    observedSpec: { managed: { state: "FAILED", failureDetails } },
    expectedSpec: { managed: { state: "ACTIVE" } },
    recoverableFrom: "awaiting_dns_challenge",
    reconcilerRunId: ctx.reconcilerRunId,
    details: failureDetails ?? undefined,
  });
}
