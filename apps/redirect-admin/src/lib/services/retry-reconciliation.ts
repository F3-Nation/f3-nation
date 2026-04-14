/**
 * Retry-reconciliation service (F3R5_013, Decision 6 recovery flow).
 *
 * POST /api/domains/[id]/retry-reconciliation calls this to transition
 * a `degraded` domain back to the `recoverable_from` target recorded in
 * its `reconciler_error` payload. The button is **disabled** in the UI
 * until a platform super-admin has written a `drift_acknowledged` event
 * via `drift-acknowledge` — this service double-checks the event exists
 * server-side so a crafted POST cannot bypass the gate.
 *
 * Inputs are injected so unit tests can fake the database without real
 * Drizzle queries.
 */

import { and, desc, eq, sql } from "drizzle-orm";

import {
  regionCustomDomainEvents,
  regionCustomDomains,
} from "@acme/redirect-platform-db";
import type { RegionCustomDomain } from "@acme/redirect-platform-db";

import { normalizeRecoverableFrom } from "../state-presenter";
import type {
  ReconcilerError,
  RecoverableTargetState,
} from "../state-presenter";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RetryReconciliationInput {
  domainId: string;
  userId: number;
}

export type RetryReconciliationError =
  | { code: "domain_not_found" }
  | { code: "domain_not_degraded"; actualState: string }
  | { code: "no_recoverable_target" }
  | { code: "drift_not_acknowledged" }
  | { code: "internal_error"; message: string };

export interface RetryReconciliationSuccess {
  domain: RegionCustomDomain;
  targetState: RecoverableTargetState;
}

export type RetryReconciliationResult =
  | { ok: true; value: RetryReconciliationSuccess }
  | { ok: false; error: RetryReconciliationError };

// ---------------------------------------------------------------------------
// Collaborators
// ---------------------------------------------------------------------------

/** Minimal Drizzle surface. */
export interface RetryReconciliationDb {
  select(projection?: unknown): {
    from(table: unknown): {
      where(predicate: unknown): Promise<unknown[]> & {
        orderBy(order: unknown): {
          limit(n: number): Promise<unknown[]>;
        };
      };
    };
  };
  update(table: unknown): {
    set(values: unknown): {
      where(predicate: unknown): {
        returning(): Promise<unknown[]>;
      };
    };
  };
  insert(table: unknown): {
    values(row: unknown): Promise<unknown>;
  };
}

export interface RetryReconciliationDeps {
  db: RetryReconciliationDb;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function retryReconciliation(
  input: RetryReconciliationInput,
  deps: RetryReconciliationDeps,
): Promise<RetryReconciliationResult> {
  // 1. Load the domain row.
  const rowsRaw = await deps.db
    .select()
    .from(regionCustomDomains)
    .where(eq(regionCustomDomains.id, input.domainId));
  const rows = rowsRaw as RegionCustomDomain[];
  const row = rows[0];
  if (!row) {
    return { ok: false, error: { code: "domain_not_found" } };
  }

  if (row.lifecycleState !== "degraded") {
    return {
      ok: false,
      error: {
        code: "domain_not_degraded",
        actualState: row.lifecycleState,
      },
    };
  }

  // 2. Pick the recovery target from reconciler_error.
  const error = (row.reconcilerError ?? null) as ReconcilerError | null;
  const target = normalizeRecoverableFrom(error);
  if (!target) {
    return { ok: false, error: { code: "no_recoverable_target" } };
  }

  // 3. Verify a drift acknowledgment event exists for this domain.
  const ackRowsRaw = await deps.db
    .select()
    .from(regionCustomDomainEvents)
    .where(
      and(
        eq(regionCustomDomainEvents.domainId, row.id),
        eq(regionCustomDomainEvents.eventType, "drift_acknowledged"),
      ),
    )
    .orderBy(desc(regionCustomDomainEvents.createdAt))
    .limit(1);
  const ackRows = ackRowsRaw;
  if (ackRows.length === 0) {
    return { ok: false, error: { code: "drift_not_acknowledged" } };
  }

  // 4. State-guarded UPDATE: only transition if still `degraded`.
  let updatedRow: RegionCustomDomain;
  try {
    const updatedRaw = await deps.db
      .update(regionCustomDomains)
      .set({
        lifecycleState: target,
        reconcilerError: null,
        updatedAt: sql`timezone('utc', now())`,
      })
      .where(
        and(
          eq(regionCustomDomains.id, row.id),
          eq(regionCustomDomains.lifecycleState, "degraded"),
        ),
      )
      .returning();
    const updatedRows = updatedRaw as RegionCustomDomain[];
    const first = updatedRows[0];
    if (!first) {
      // Someone raced us out of `degraded` between the read and the UPDATE.
      return {
        ok: false,
        error: {
          code: "internal_error",
          message: "state-guarded UPDATE matched zero rows",
        },
      };
    }
    updatedRow = first;
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: formatError(err, "UPDATE region_custom_domains failed"),
      },
    };
  }

  // 5. Audit event.
  try {
    await deps.db.insert(regionCustomDomainEvents).values({
      domainId: row.id,
      eventType: "manual_retry_reconciliation",
      fromState: "degraded",
      toState: target,
      actorUserId: input.userId,
      details: {
        source: "redirect-admin-ui",
        reconciler_run_id: error?.reconciler_run_id,
        drift_kind: error?.drift_kind,
      },
    });
  } catch (err) {
    console.warn(
      "retryReconciliation: audit event insert failed (state already advanced)",
      err,
    );
  }

  return {
    ok: true,
    value: { domain: updatedRow, targetState: target },
  };
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

export function statusForRetryReconciliationError(
  error: RetryReconciliationError,
): number {
  switch (error.code) {
    case "domain_not_found":
      return 404;
    case "domain_not_degraded":
      return 409;
    case "no_recoverable_target":
      return 422;
    case "drift_not_acknowledged":
      return 412;
    case "internal_error":
      return 500;
  }
}

function formatError(err: unknown, prefix: string): string {
  if (err instanceof Error) return `${prefix}: ${err.message}`;
  return `${prefix}: ${String(err)}`;
}
