/**
 * Singleton reconciler lease — R5 Decision 6 "Backend Reconciler with
 * Designed Concurrency".
 *
 * Three operations:
 *   1. acquire() — DELETE stale + INSERT ON CONFLICT DO NOTHING, TTL 4 min
 *   2. heartbeat() — UPDATE WHERE held_by AND expires_at > now()
 *   3. release() — DELETE WHERE lease_key AND held_by
 *
 * The SQL here mirrors the exact statements in R5 Decision 6 to the letter.
 * If you change these, update the plan too — this is the concurrency
 * primitive the entire reconciler depends on.
 *
 * Heartbeat wrapper semantics:
 *   - `withHeartbeat(lease, maxDurationMs, fn)` runs `fn` and extends the
 *     lease every 30 seconds in the background.
 *   - If the heartbeat returns zero rows, the lease is LOST — we set an
 *     `isLost()` flag and `fn` is expected to abort cleanly (R5: "rolls
 *     back any open DB work, does NOT attempt further GCP API calls,
 *     logs the abort"). The wrapper throws `LeaseLostError` after `fn`
 *     returns or when the caller checks.
 *   - If `fn` runs longer than `maxDurationMs` (R5 hard cap: 30 minutes),
 *     we log a stuck-operation CRITICAL and throw `StuckOperationError`.
 *     The caller (index.ts) catches and exits.
 */

import type { Sql } from "postgres";

import type { Logger } from "./logging.js";

export const LEASE_KEY_DOMAIN_RECONCILER = "domain-reconciler";
export const LEASE_TTL_MINUTES = 4;
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_HARD_CAP_MS = 30 * 60 * 1000;

export interface Lease {
  leaseKey: string;
  heldBy: string;
  acquiredAt: string;
  expiresAt: string;
}

/** Subset of the `postgres-js` Sql interface the lease module actually uses. */
export type LeaseSqlExecutor = Pick<Sql, "begin" | "unsafe"> & Sql;

export interface AcquireOptions {
  leaseKey?: string;
  instanceId: string;
  ttlMinutes?: number;
}

export interface HeartbeatResult {
  newExpiresAt: string;
}

export class LeaseLostError extends Error {
  constructor(
    public readonly lease: Lease,
    public readonly operation: string,
  ) {
    super(
      `reconciler lease ${lease.leaseKey} held by ${lease.heldBy} was lost while running operation '${operation}'`,
    );
    this.name = "LeaseLostError";
  }
}

export class StuckOperationError extends Error {
  constructor(
    public readonly lease: Lease,
    public readonly operation: string,
    public readonly durationMs: number,
  ) {
    super(
      `reconciler operation '${operation}' exceeded heartbeat hard cap after ${durationMs}ms (lease ${lease.leaseKey})`,
    );
    this.name = "StuckOperationError";
  }
}

interface RawLeaseRow {
  lease_key: string;
  held_by: string;
  acquired_at: Date | string;
  expires_at: Date | string;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function rowToLease(row: RawLeaseRow): Lease {
  return {
    leaseKey: row.lease_key,
    heldBy: row.held_by,
    acquiredAt: toIsoString(row.acquired_at),
    expiresAt: toIsoString(row.expires_at),
  };
}

/**
 * Attempt to acquire the singleton reconciler lease.
 *
 * Runs the exact SQL from R5 Decision 6: a single transaction containing
 * (1) DELETE stale leases, (2) INSERT ON CONFLICT DO NOTHING RETURNING *.
 * Returns the claimed lease on success, or `null` if another instance
 * already holds it.
 *
 * No GCP API calls happen inside the transaction — this is deliberately
 * a short DB-only op per the plan.
 */
export async function acquireLease(
  sql: LeaseSqlExecutor,
  options: AcquireOptions,
): Promise<Lease | null> {
  const leaseKey = options.leaseKey ?? LEASE_KEY_DOMAIN_RECONCILER;
  const instanceId = options.instanceId;
  const ttlMinutes = options.ttlMinutes ?? LEASE_TTL_MINUTES;
  const ttlInterval = `${ttlMinutes} minutes`;

  const rows = await sql.begin(async (tx) => {
    await tx`
      DELETE FROM reconciler_leases
       WHERE lease_key = ${leaseKey}
         AND expires_at < timezone('utc', now())
    `;
    const inserted = await tx<RawLeaseRow[]>`
      INSERT INTO reconciler_leases (lease_key, held_by, acquired_at, expires_at)
      VALUES (
        ${leaseKey},
        ${instanceId},
        timezone('utc', now()),
        timezone('utc', now()) + ${ttlInterval}::interval
      )
      ON CONFLICT (lease_key) DO NOTHING
      RETURNING lease_key, held_by, acquired_at, expires_at
    `;
    return inserted;
  });

  const row = rows?.[0];
  if (!row) {
    return null;
  }
  return rowToLease(row);
}

/**
 * Extend the lease by the standard TTL. Returns `null` if the lease was
 * lost (expired or stolen by another instance).
 *
 * The WHERE clause is the exact guard from R5 Decision 6:
 *   held_by = $instance AND expires_at > now()
 */
export async function heartbeatLease(
  sql: LeaseSqlExecutor,
  lease: Lease,
  ttlMinutes: number = LEASE_TTL_MINUTES,
): Promise<HeartbeatResult | null> {
  const ttlInterval = `${ttlMinutes} minutes`;
  const rows = await sql<{ expires_at: Date | string }[]>`
    UPDATE reconciler_leases
       SET expires_at = timezone('utc', now()) + ${ttlInterval}::interval
     WHERE lease_key = ${lease.leaseKey}
       AND held_by = ${lease.heldBy}
       AND expires_at > timezone('utc', now())
    RETURNING expires_at
  `;
  const row = rows?.[0];
  if (!row) {
    return null;
  }
  return { newExpiresAt: toIsoString(row.expires_at) };
}

/**
 * Release the lease. Idempotent: returns cleanly even if the row is
 * already gone (another instance took over after TTL expiry).
 */
export async function releaseLease(
  sql: LeaseSqlExecutor,
  lease: Lease,
): Promise<void> {
  await sql`
    DELETE FROM reconciler_leases
     WHERE lease_key = ${lease.leaseKey}
       AND held_by = ${lease.heldBy}
  `;
}

// ---------------------------------------------------------------------------
// Heartbeat runner
// ---------------------------------------------------------------------------

export interface WithHeartbeatOptions {
  sql: LeaseSqlExecutor;
  lease: Lease;
  logger: Logger;
  /** Hard cap on a single operation; R5 says 30 minutes. */
  maxDurationMs?: number;
  /** Heartbeat interval; R5 says 30 seconds. */
  intervalMs?: number;
  /** Label used in logs when the heartbeat runner aborts. */
  operationName?: string;
  /** Test seam: replace the heartbeat implementation. */
  heartbeatFn?: typeof heartbeatLease;
  /** Test seam: replace timers. */
  timers?: HeartbeatTimers;
}

export interface HeartbeatTimers {
  setInterval(callback: () => void, ms: number): NodeJS.Timeout;
  clearInterval(handle: NodeJS.Timeout): void;
  now(): number;
}

const realTimers: HeartbeatTimers = {
  setInterval: (cb, ms) => setInterval(cb, ms),
  clearInterval: (h) => clearInterval(h),
  now: () => Date.now(),
};

/**
 * Run `fn` while periodically extending the lease in the background.
 *
 * Lifecycle:
 *   - Start: schedule a heartbeat every `intervalMs`.
 *   - On heartbeat failure: set `leaseLost = true`, capture a
 *     `LeaseLostError`, stop the timer. `fn` should notice either via
 *     `status.isLost()` or when its own DB calls fail.
 *   - On hard cap: emit `log.stuckOperation`, set a pending
 *     `StuckOperationError`, stop the timer.
 *   - When `fn` settles: stop the timer. If a pending error exists,
 *     throw it. Otherwise return `fn`'s value.
 */
export interface HeartbeatStatus {
  isLost(): boolean;
}

export async function withHeartbeat<T>(
  options: WithHeartbeatOptions,
  fn: (status: HeartbeatStatus) => Promise<T>,
): Promise<T> {
  const {
    sql,
    lease,
    logger,
    maxDurationMs = HEARTBEAT_HARD_CAP_MS,
    intervalMs = HEARTBEAT_INTERVAL_MS,
    operationName = "reconciler_cycle",
    heartbeatFn = heartbeatLease,
    timers = realTimers,
  } = options;

  let leaseLost = false;
  let pendingError: Error | null = null;
  let lastExtendedAt = new Date(timers.now()).toISOString();
  const startedAt = timers.now();

  const status: HeartbeatStatus = {
    isLost: () => leaseLost,
  };

  const handle = timers.setInterval(() => {
    if (leaseLost || pendingError !== null) {
      return;
    }
    const now = timers.now();
    if (now - startedAt >= maxDurationMs) {
      logger.stuckOperation({
        operationName,
        lastLeaseExtendedAt: lastExtendedAt,
      });
      pendingError = new StuckOperationError(
        lease,
        operationName,
        now - startedAt,
      );
      return;
    }
    // Fire and forget; if the heartbeat fails we capture it via the closure.
    // Tests inject a fake interval/heartbeat so this is deterministic.
    void (async () => {
      try {
        const result = await heartbeatFn(sql, lease);
        if (result === null) {
          leaseLost = true;
          logger.error("reconciler lease lost during heartbeat", {
            operation: operationName,
            lease_key: lease.leaseKey,
          });
          pendingError = new LeaseLostError(lease, operationName);
        } else {
          lastExtendedAt = result.newExpiresAt;
        }
      } catch (err) {
        logger.error("reconciler heartbeat SQL error", {
          operation: operationName,
          error: String(err),
        });
      }
    })();
  }, intervalMs);

  try {
    const value = await fn(status);
    if (pendingError !== null) {
      throw pendingError;
    }
    return value;
  } finally {
    timers.clearInterval(handle);
  }
}
