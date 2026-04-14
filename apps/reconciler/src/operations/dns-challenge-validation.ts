/**
 * Operation 1 — DNS challenge validation
 *
 * Trigger: rows where lifecycle_state = 'awaiting_dns_challenge'.
 *
 * Flow (R5 Decision 6, op 1):
 *
 *   1. Select the row batch.
 *   2. GET DnsAuthorization at `dns-auth-<uuid>`.
 *      - state != 'ACTIVE' → no-op, bump last_reconciled_at, next cycle.
 *      - state === 'ACTIVE' → proceed.
 *   3. GET Certificate at `cert-<uuid>`.
 *      - 404 → CREATE. `ALREADY_EXISTS` → re-GET + verify spec. Mismatch → halt-on-drift.
 *      - 200 → verify spec. Mismatch → halt-on-drift.
 *   4. Advance `awaiting_dns_challenge → provisioning_cert` via state-guarded UPDATE.
 */

import { regionCustomDomains } from "@acme/redirect-platform-db";
import type { RegionCustomDomain } from "@acme/redirect-platform-db";
import { eq } from "drizzle-orm";

import { AlreadyExistsError, NotFoundError } from "../gcp/index.js";
import type { CertificateView, DnsAuthorizationView } from "../gcp/index.js";
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

interface PlannedCertSpec {
  domain: string;
  dnsAuthorizationName: string;
}

/**
 * Does the Certificate returned by GCP match the spec we planned to create?
 * A match requires:
 *   - managed.domains contains the planned domain
 *   - managed.dnsAuthorizations contains the planned auth resource path
 */
export function certSpecMatches(
  existing: CertificateView,
  planned: PlannedCertSpec,
): boolean {
  if (!existing.managed) return false;
  const domainsOk = existing.managed.domains.includes(planned.domain);
  const authsOk = existing.managed.dnsAuthorizations.includes(
    planned.dnsAuthorizationName,
  );
  return domainsOk && authsOk;
}

export async function runDnsChallengeValidation(
  ctx: OperationContext,
): Promise<void> {
  const rows = await ctx.db
    .select()
    .from(regionCustomDomains)
    .where(eq(regionCustomDomains.lifecycleState, "awaiting_dns_challenge"))
    .limit(MAX_ROWS_PER_CYCLE);

  for (const row of rows) {
    await reconcileOneDnsChallenge(ctx, row);
  }
}

interface EnsureCertificateInput {
  rowId: string;
  certId: string;
  certResourceName: string;
  plannedSpec: PlannedCertSpec;
  dnsAuth: DnsAuthorizationView;
  hostname: string;
}

type EnsureOutcome = "created" | "existed_matching" | "halted";

async function ensureCertificateExists(
  ctx: OperationContext,
  input: EnsureCertificateInput,
): Promise<EnsureOutcome> {
  // First attempt: GET. If the cert exists already, verify its spec
  // directly — this is the crash-recovery path where a prior run created
  // the cert but died before advancing the DB row.
  try {
    const existing = await ctx.certManager.getCertificate(input.certId);
    if (certSpecMatches(existing, input.plannedSpec)) {
      return "existed_matching";
    }
    await haltOnDrift({
      db: ctx.db,
      logger: ctx.logger,
      rowId: input.rowId,
      currentState: "awaiting_dns_challenge",
      driftKind: "spec_mismatch",
      resourceType: "Certificate",
      resourceName: input.certResourceName,
      observedSpec: existing,
      expectedSpec: input.plannedSpec,
      recoverableFrom: "awaiting_dns_challenge",
      reconcilerRunId: ctx.reconcilerRunId,
    });
    return "halted";
  } catch (err) {
    if (!(err instanceof NotFoundError)) {
      throw err;
    }
  }

  // GET returned 404 → attempt CREATE.
  try {
    await ctx.certManager.createCertificate({
      certificateId: input.certId,
      domain: input.hostname,
      dnsAuthorizationName: input.dnsAuth.name,
    });
    return "created";
  } catch (createErr) {
    if (!(createErr instanceof AlreadyExistsError)) {
      throw createErr;
    }
  }

  // CREATE returned ALREADY_EXISTS → re-GET and verify spec (R5 Decision 6).
  try {
    await handleAlreadyExists<CertificateView, PlannedCertSpec>({
      resourceKind: "Certificate",
      rowId: input.rowId,
      resourceName: input.certResourceName,
      plannedSpec: input.plannedSpec,
      getFn: async () => ctx.certManager.getCertificate(input.certId),
      specMatches: certSpecMatches,
    });
    return "existed_matching";
  } catch (resolveErr) {
    if (resolveErr instanceof SpecMismatchError) {
      await haltOnDrift({
        db: ctx.db,
        logger: ctx.logger,
        rowId: input.rowId,
        currentState: "awaiting_dns_challenge",
        driftKind: "spec_mismatch",
        resourceType: "Certificate",
        resourceName: input.certResourceName,
        observedSpec: resolveErr.observedSpec,
        expectedSpec: resolveErr.expectedSpec,
        recoverableFrom: "awaiting_dns_challenge",
        reconcilerRunId: ctx.reconcilerRunId,
      });
      return "halted";
    }
    throw resolveErr;
  }
}

export async function reconcileOneDnsChallenge(
  ctx: OperationContext,
  row: RegionCustomDomain,
): Promise<void> {
  const logFields = { domain_id: row.id, hostname: row.hostname };

  const dnsAuthId = deterministicResourceName("DnsAuthorization", row.id);
  const dnsAuth = await ctx.certManager.getDnsAuthorization(dnsAuthId);

  if (dnsAuth === null) {
    // The reconciler does not create the DnsAuthorization — registration
    // does. If it's missing, we halt on orphan row.
    await haltOnDrift({
      db: ctx.db,
      logger: ctx.logger,
      rowId: row.id,
      currentState: "awaiting_dns_challenge",
      driftKind: "orphan_resource",
      resourceType: "DnsAuthorization",
      resourceName: dnsAuthId,
      observedSpec: null,
      expectedSpec: { domain: row.hostname },
      recoverableFrom: "awaiting_dns_challenge",
      reconcilerRunId: ctx.reconcilerRunId,
    });
    return;
  }

  if (dnsAuth.state !== "ACTIVE") {
    ctx.logger.info("dns authorization not yet active; waiting", {
      ...logFields,
      dns_authorization_state: dnsAuth.state,
    });
    await touchReconciledAt(ctx.db, row.id);
    return;
  }

  const certId = deterministicResourceName("Certificate", row.id);
  const certResourceName = ctx.certManager.certificateResourcePath(certId);
  const plannedSpec: PlannedCertSpec = {
    domain: row.hostname,
    dnsAuthorizationName: dnsAuth.name,
  };

  const ensured = await ensureCertificateExists(ctx, {
    rowId: row.id,
    certId,
    certResourceName,
    plannedSpec,
    dnsAuth,
    hostname: row.hostname,
  });
  if (ensured === "halted") {
    return;
  }

  // Whether we just created it or it already existed, we advance the state.
  // The row now has a Certificate resource associated with it; the provisioning
  // state machine (op 2) will observe managed.state transitions.
  const updated = await stateGuardedUpdate(ctx.db, {
    id: row.id,
    expectedState: "awaiting_dns_challenge",
    newState: "provisioning_cert",
    patch: {
      gcpDnsAuthorizationId: dnsAuthId,
      gcpCertificateId: certId,
    },
  });
  if (updated === null) {
    ctx.logger.info(
      "state guard failed on awaiting_dns_challenge → provisioning_cert",
      logFields,
    );
    return;
  }
  await appendDomainEvent(ctx.db, {
    domainId: row.id,
    eventType: "reconciler.dns_challenge_validated",
    fromState: "awaiting_dns_challenge",
    toState: "provisioning_cert",
    reconcilerRunId: ctx.reconcilerRunId,
  });
  ctx.logger.info(
    "advanced awaiting_dns_challenge → provisioning_cert",
    logFields,
  );
}
