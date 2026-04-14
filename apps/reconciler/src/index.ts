/**
 * Reconciler Cloud Run job entry point.
 *
 * One-shot process per Cloud Run Jobs semantics: acquire the singleton
 * lease, run one reconciler cycle under a heartbeat, release the lease,
 * close the DB pool, exit. Cloud Scheduler re-invokes us every 5 minutes
 * (R5 Decision 6).
 */

import { randomUUID } from "node:crypto";

import { ConfigError, loadConfig } from "./config.js";
import type { ReconcilerConfig } from "./config.js";
import { createReconcilerDb } from "./db/client.js";
import {
  LEASE_KEY_DOMAIN_RECONCILER,
  LeaseLostError,
  StuckOperationError,
  acquireLease,
  releaseLease,
  withHeartbeat,
} from "./lease.js";
import { createLogger } from "./logging.js";
import { processTransientStates } from "./process.js";

async function main(): Promise<void> {
  let config: ReconcilerConfig;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.log(
        JSON.stringify({
          severity: "CRITICAL",
          message: "reconciler config load failed",
          error: err.message,
        }),
      );
      process.exit(1);
    }
    throw err;
  }

  const logger = createLogger({
    context: {
      instanceId: config.instanceId,
      region: config.region,
      runId: randomUUID(),
    },
  });

  logger.info("reconciler job started", {
    region: config.region,
    instance_id: config.instanceId,
  });

  const handle = createReconcilerDb({ connectionString: config.databaseUrl });

  try {
    const lease = await acquireLease(handle.client, {
      leaseKey: LEASE_KEY_DOMAIN_RECONCILER,
      instanceId: config.instanceId,
    });

    if (lease === null) {
      logger.info(
        "another reconciler instance holds the lease; exiting cleanly",
      );
      return;
    }

    logger.info("lease acquired", {
      lease_key: lease.leaseKey,
      expires_at: lease.expiresAt,
    });

    try {
      await withHeartbeat(
        {
          sql: handle.client,
          lease,
          logger,
          operationName: "processTransientStates",
        },
        async (heartbeat) => {
          await processTransientStates({
            db: handle.db,
            lease,
            logger,
            heartbeat,
            region: config.region,
          });
        },
      );
    } catch (err) {
      if (err instanceof StuckOperationError) {
        logger.error("reconciler cycle aborted: stuck operation hard cap", {
          operation: err.operation,
          duration_ms: err.durationMs,
        });
      } else if (err instanceof LeaseLostError) {
        logger.error("reconciler cycle aborted: lease lost", {
          operation: err.operation,
        });
      } else {
        logger.error("reconciler cycle failed", { error: String(err) });
      }
      throw err;
    } finally {
      await releaseLease(handle.client, lease);
      logger.info("lease released");
    }

    logger.info("reconciler cycle completed");
  } finally {
    await handle.end();
  }
}

main().catch((err) => {
  console.log(
    JSON.stringify({
      severity: "ERROR",
      message: "reconciler fatal error",
      error: String(err),
    }),
  );
  process.exit(1);
});
