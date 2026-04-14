/**
 * Reconciler cycle entry point — scaffold stub.
 *
 * F3R5_009 is the scaffold only. The actual reconciler operations land
 * in F3R5_010 (ops 1-4: DNS challenge validation, cert provisioning,
 * SNI probe, post-cutover DNS verification) and F3R5_011 (ops 5-8:
 * active health re-probe, tombstone cleanup, quarantine drift check,
 * periodic drift detection).
 *
 * See R5 Decision 6 "Operations performed per cycle" for the
 * authoritative spec of each operation.
 */

import type { ReconcilerDb } from "./db/client.js";
import type { Lease, HeartbeatStatus } from "./lease.js";
import type { Logger } from "./logging.js";

export interface ProcessTransientStatesInput {
  db: ReconcilerDb;
  lease: Lease;
  logger: Logger;
  heartbeat: HeartbeatStatus;
}

// F3R5_010 / F3R5_011 will add real awaited DB work here; until then the
// scaffold function is async to match its final shape — hence the lint
// suppression. Remove both this comment and the disable once the first
// real operation lands.
// eslint-disable-next-line @typescript-eslint/require-await
export async function processTransientStates(
  input: ProcessTransientStatesInput,
): Promise<void> {
  const { logger, lease, heartbeat } = input;

  logger.info(
    "reconciler cycle started (scaffold stub — no operations implemented)",
    {
      lease_key: lease.leaseKey,
      held_by: lease.heldBy,
    },
  );

  // Crash recovery scan (R5 Decision 6): re-queue rows in transient states
  // with `last_reconciled_at` older than 10 minutes. The real query will
  // live here in F3R5_010.
  // TODO(F3R5_010): SELECT id FROM region_custom_domains
  //   WHERE lifecycle_state IN (...transient states...)
  //     AND (last_reconciled_at IS NULL OR last_reconciled_at < now() - interval '10 minutes');

  // TODO(F3R5_010): op 1 — DNS challenge validation
  //   awaiting_dns_challenge -> provisioning_cert
  // TODO(F3R5_010): op 2 — Cert provisioning
  //   provisioning_cert -> awaiting_probe | degraded
  // TODO(F3R5_010): op 3 — Multi-vantage SNI probe (Decision 4)
  //   awaiting_probe -> awaiting_cutover | degraded
  // TODO(F3R5_010): op 4 — Post-cutover DNS verification
  //   awaiting_cutover -> active

  // TODO(F3R5_011): op 5 — Active health re-probe
  //   active -> degraded on ≥2 consecutive SNI probe failures
  // TODO(F3R5_011): op 6 — Tombstone cleanup
  //   tombstoned -> quarantined
  // TODO(F3R5_011): op 7 — Quarantine expiry with drift check
  //   quarantined -> released (or degraded on orphan_resource)
  // TODO(F3R5_011): op 8 — Periodic drift detection across GCP resources

  if (heartbeat.isLost()) {
    logger.warn(
      "reconciler lease lost before any work; scaffold stub returning",
    );
    return;
  }

  logger.info("reconciler cycle completed (scaffold stub)");
}
