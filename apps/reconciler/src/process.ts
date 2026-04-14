/**
 * Reconciler cycle dispatcher — F3R5_010 (operations 1–4).
 *
 * Invoked once per Cloud Run job execution under a singleton lease with
 * the heartbeat runner. This function is the top-level fan-out into the
 * four transient-state operations defined in R5 Decision 6. Operations
 * 5–8 will be added by F3R5_011.
 *
 * Each operation is idempotent and short-transaction: GCP API calls
 * happen OUTSIDE any DB transaction, every state transition is a
 * state-guarded UPDATE, and the reconciler never holds a DB connection
 * open across a remote call.
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
  loadPostCutoverConfig,
  loadSniProbeConfig,
  runCertProvisioning,
  runDnsChallengeValidation,
  runPostCutoverVerification,
  runSniProbeOperation,
} from "./operations/index.js";
import type {
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
}

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

  // TODO(F3R5_011): op 5 — Active health re-probe
  // TODO(F3R5_011): op 6 — Tombstone cleanup
  // TODO(F3R5_011): op 7 — Quarantine expiry with drift check
  // TODO(F3R5_011): op 8 — Periodic drift detection

  logger.info("reconciler cycle completed");
}
