/**
 * Reconciler cycle dispatcher — F3R5_010 (ops 1–4) + F3R5_011 (ops 5–8).
 *
 * Invoked once per Cloud Run job execution under a singleton lease with
 * the heartbeat runner. This function is the top-level fan-out into the
 * eight operations defined in R5 Decision 6.
 *
 * Operation routing (by trigger state):
 *
 *   Op 1 — awaiting_dns_challenge
 *   Op 2 — provisioning_cert
 *   Op 3 — awaiting_probe
 *   Op 4 — awaiting_cutover
 *   Op 5 — active            (reduced-cadence heartbeat reprobe + cert renewal)
 *   Op 6 — tombstoned        (GCP cleanup)
 *   Op 7 — quarantined && released_at < now()
 *   Op 8 — periodic           (every ~1h, report-only drift detection)
 *
 * Each operation is idempotent and short-transaction: GCP API calls
 * happen OUTSIDE any DB transaction, every state transition is a
 * state-guarded UPDATE, and the reconciler never holds a DB connection
 * open across a remote call.
 *
 * The lease heartbeat wraps the entire cycle; between each op we check
 * `heartbeat.isLost()` and exit cleanly so a reclaimed lease doesn't
 * cause overlapping work.
 */

import { randomUUID } from "node:crypto";

import type { ReconcilerDb } from "./db/client.js";
import {
  createCertManagerClient,
  loadCertManagerConfig,
} from "./gcp/cert-manager-client.js";
import type { CertManagerClient } from "./gcp/cert-manager-client.js";
import type { HeartbeatStatus, Lease } from "./lease.js";
import type { Logger } from "./logging.js";
import {
  createInMemoryDriftDetectionStore,
  loadPostCutoverConfig,
  loadSniProbeConfig,
  runActiveHealth,
  runCertProvisioning,
  runDnsChallengeValidation,
  runDriftDetection,
  runPostCutoverVerification,
  runQuarantineRelease,
  runSniProbeOperation,
  runTombstoneCleanup,
} from "./operations/index.js";
import type {
  DriftDetectionStore,
  OperationContext,
  PostCutoverConfig,
  SniProbeOpConfig,
} from "./operations/index.js";

export interface ProcessTransientStatesInput {
  db: ReconcilerDb;
  lease: Lease;
  logger: Logger;
  heartbeat: HeartbeatStatus;
  /** GCP region this reconciler instance is running in. */
  region: string;
  /** Test seam — inject custom dependencies instead of loading from env. */
  overrides?: ProcessTransientStatesOverrides;
}

export interface ProcessTransientStatesOverrides {
  certManager?: CertManagerClient;
  sniProbeConfig?: SniProbeOpConfig;
  postCutoverConfig?: PostCutoverConfig;
  reconcilerRunId?: string;
  /**
   * Shared drift-detection throttle store. Persists across cycles within
   * a single reconciler process (default: in-memory singleton). Tests can
   * inject a stub to control op 8 gating.
   */
  driftDetectionStore?: DriftDetectionStore;
}

// Process-local singleton — persists across reconciler cycles for the
// lifetime of the Cloud Run revision. A revision restart causes at most
// one extra op 8 run, which is acceptable (op 8 is report-only).
const defaultDriftDetectionStore: DriftDetectionStore =
  createInMemoryDriftDetectionStore();

export async function processTransientStates(
  input: ProcessTransientStatesInput,
): Promise<void> {
  const { logger, lease, heartbeat, region } = input;
  const overrides = input.overrides ?? {};
  const reconcilerRunId = overrides.reconcilerRunId ?? randomUUID();

  logger.info("reconciler cycle started", {
    lease_key: lease.leaseKey,
    held_by: lease.heldBy,
    reconciler_run_id: reconcilerRunId,
    region,
  });

  const certManager =
    overrides.certManager ?? createCertManagerClient(loadCertManagerConfig());
  const sniProbeConfig = overrides.sniProbeConfig ?? loadSniProbeConfig();
  const postCutoverConfig =
    overrides.postCutoverConfig ?? loadPostCutoverConfig();

  const ctx: OperationContext = {
    db: input.db,
    logger,
    reconcilerRunId,
    region,
    certManager,
  };

  // Before each operation, bail early if the heartbeat runner has lost
  // the lease. Each operation is short-enough that we don't need a
  // mid-operation check, but we gate at the boundaries to honour the R5
  // "abort cleanly on lease loss" contract.

  if (heartbeat.isLost()) {
    logger.warn("reconciler cycle aborted before op 1: lease lost");
    return;
  }
  logger.info("running op 1 — DNS challenge validation");
  await runDnsChallengeValidation(ctx);

  if (heartbeat.isLost()) {
    logger.warn("reconciler cycle aborted before op 2: lease lost");
    return;
  }
  logger.info("running op 2 — cert provisioning");
  await runCertProvisioning(ctx);

  if (heartbeat.isLost()) {
    logger.warn("reconciler cycle aborted before op 3: lease lost");
    return;
  }
  logger.info("running op 3 — SNI probe");
  await runSniProbeOperation(ctx, sniProbeConfig);

  if (heartbeat.isLost()) {
    logger.warn("reconciler cycle aborted before op 4: lease lost");
    return;
  }
  logger.info("running op 4 — post-cutover DNS verification");
  await runPostCutoverVerification(ctx, postCutoverConfig);

  if (heartbeat.isLost()) {
    logger.warn("reconciler cycle aborted before op 5: lease lost");
    return;
  }
  logger.info("running op 5 — active health re-probe");
  await runActiveHealth(ctx, sniProbeConfig);

  if (heartbeat.isLost()) {
    logger.warn("reconciler cycle aborted before op 6: lease lost");
    return;
  }
  logger.info("running op 6 — tombstone cleanup");
  await runTombstoneCleanup(ctx);

  if (heartbeat.isLost()) {
    logger.warn("reconciler cycle aborted before op 7: lease lost");
    return;
  }
  logger.info("running op 7 — quarantine release (with drift check)");
  await runQuarantineRelease(ctx);

  if (heartbeat.isLost()) {
    logger.warn("reconciler cycle aborted before op 8: lease lost");
    return;
  }
  logger.info("running op 8 — periodic drift detection");
  const driftStore =
    overrides.driftDetectionStore ?? defaultDriftDetectionStore;
  await runDriftDetection(ctx, { store: driftStore });

  logger.info("reconciler cycle completed");
}
