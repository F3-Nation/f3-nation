/**
 * Drift-acknowledgment service (F3R5_013, Decision 6 recovery flow).
 *
 * POST /api/admins/drift-acknowledge calls this to record a super-admin
 * sign-off on a `degraded` row. The event row it writes is the gate
 * that `retry-reconciliation` reads before permitting a transition.
 *
 * Super-admin enforcement: the route handler checks `isSuperAdmin(userId)`
 * before calling this service. The check reads from an env-driven
 * allowlist (`REDIRECT_ADMIN_SUPER_ADMIN_USER_IDS`) because the Supabase
 * role registry has no global super-admin role concept yet. See
 * `services/super-admin.ts` for the lookup.
 */

import { eq } from "drizzle-orm";

import {
  regionCustomDomainEvents,
  regionCustomDomains,
} from "@acme/redirect-platform-db";
import type { RegionCustomDomain } from "@acme/redirect-platform-db";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DriftAcknowledgeInput {
  domainId: string;
  userId: number;
  justification: string;
}

export type DriftAcknowledgeError =
  | { code: "justification_required" }
  | { code: "domain_not_found" }
  | { code: "domain_not_degraded"; actualState: string }
  | { code: "internal_error"; message: string };

export interface DriftAcknowledgeSuccess {
  domainId: string;
  acknowledgedAt: string;
}

export type DriftAcknowledgeResult =
  | { ok: true; value: DriftAcknowledgeSuccess }
  | { ok: false; error: DriftAcknowledgeError };

// ---------------------------------------------------------------------------
// Collaborators
// ---------------------------------------------------------------------------

export interface DriftAcknowledgeDb {
  select(): {
    from(table: unknown): {
      where(predicate: unknown): Promise<unknown[]>;
    };
  };
  insert(table: unknown): {
    values(row: unknown): Promise<unknown>;
  };
}

export interface DriftAcknowledgeDeps {
  db: DriftAcknowledgeDb;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function driftAcknowledge(
  input: DriftAcknowledgeInput,
  deps: DriftAcknowledgeDeps,
): Promise<DriftAcknowledgeResult> {
  // 1. Input validation: justification must be a non-trivial string.
  const justification = (input.justification ?? "").trim();
  if (justification.length < 10) {
    return { ok: false, error: { code: "justification_required" } };
  }

  // 2. Load the domain to confirm it's actually degraded.
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

  // 3. Write the ack event.
  const acknowledgedAt = new Date().toISOString();
  try {
    await deps.db.insert(regionCustomDomainEvents).values({
      domainId: row.id,
      eventType: "drift_acknowledged",
      fromState: "degraded",
      toState: "degraded",
      actorUserId: input.userId,
      details: {
        action: "drift_acknowledged",
        justification,
        source: "redirect-admin-ui",
        acknowledged_at: acknowledgedAt,
      },
    });
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: formatError(err, "event insert failed"),
      },
    };
  }

  return {
    ok: true,
    value: { domainId: row.id, acknowledgedAt },
  };
}

export function statusForDriftAcknowledgeError(
  error: DriftAcknowledgeError,
): number {
  switch (error.code) {
    case "justification_required":
      return 400;
    case "domain_not_found":
      return 404;
    case "domain_not_degraded":
      return 409;
    case "internal_error":
      return 500;
  }
}

function formatError(err: unknown, prefix: string): string {
  if (err instanceof Error) return `${prefix}: ${err.message}`;
  return `${prefix}: ${String(err)}`;
}
