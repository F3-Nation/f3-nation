/**
 * Shared primitives for reconciler operations 1–8 (R5 Decision 6).
 *
 * This module concentrates the three concurrency-critical patterns the
 * plan calls out:
 *
 *   1. State-guarded UPDATE — `UPDATE ... WHERE id = $id AND lifecycle_state
 *      = $expected RETURNING *`. If zero rows, another worker got there
 *      first; the caller aborts gracefully.
 *   2. Deterministic resource names — `dns-auth-<uuid>`, `cert-<uuid>`,
 *      `cme-<uuid>`. Derived from the row's UUID so every reconciler run
 *      converges on the same GCP resource id.
 *   3. `ALREADY_EXISTS` as success path + halt-on-spec-mismatch.
 *
 * Also provides `haltOnDrift` which writes the Decision 6 JSON payload to
 * `reconciler_error`, transitions the row to `degraded`, emits the
 * structured Cloud Logging drift entry, and appends an append-only event
 * for the audit trail.
 */

import {
  regionCustomDomains,
  regionCustomDomainEvents,
} from "@acme/redirect-platform-db";
import type { RegionCustomDomain } from "@acme/redirect-platform-db";
import { and, eq } from "drizzle-orm";

import type { ReconcilerDb } from "../db/client.js";
import type { CertManagerClient } from "../gcp/index.js";
import { AlreadyExistsError, NotFoundError } from "../gcp/index.js";
import type { Logger } from "../logging.js";

// ---------------------------------------------------------------------------
// Deterministic resource names
// ---------------------------------------------------------------------------

export type ResourceKind =
  | "DnsAuthorization"
  | "Certificate"
  | "CertificateMapEntry";

/**
 * Build a deterministic GCP resource id for a domain row. The prefix comes
 * from R5 Decision 6: `dns-auth-<uuid>`, `cert-<uuid>`, `cme-<uuid>`.
 */
export function deterministicResourceName(
  kind: ResourceKind,
  rowId: string,
): string {
  switch (kind) {
    case "DnsAuthorization":
      return `dns-auth-${rowId}`;
    case "Certificate":
      return `cert-${rowId}`;
    case "CertificateMapEntry":
      return `cme-${rowId}`;
  }
}

// ---------------------------------------------------------------------------
// State-guarded UPDATE
// ---------------------------------------------------------------------------

export interface StateGuardedUpdateInput {
  id: string;
  expectedState: RegionCustomDomain["lifecycleState"];
  newState: RegionCustomDomain["lifecycleState"];
  /** Extra column patches applied in the same UPDATE. */
  patch?: Partial<
    Omit<
      RegionCustomDomain,
      "id" | "lifecycleState" | "createdAt" | "createdBy"
    >
  >;
}

/**
 * Runs the exact state-guarded UPDATE pattern from R5 Decision 6:
 *
 *   UPDATE region_custom_domains
 *      SET lifecycle_state = $new_state,
 *          last_reconciled_at = now(),
 *          updated_at = now(),
 *          ... patch ...
 *    WHERE id = $id AND lifecycle_state = $expected_state
 *   RETURNING *;
 *
 * Returns the updated row on success or `null` if the state guard failed
 * (another worker moved the row first, or the state changed out-of-band).
 * The caller must treat `null` as an abort-this-cycle signal, not an error.
 */
export async function stateGuardedUpdate(
  db: ReconcilerDb,
  input: StateGuardedUpdateInput,
): Promise<RegionCustomDomain | null> {
  const nowIso = new Date().toISOString();
  const values: Record<string, unknown> = {
    lifecycleState: input.newState,
    lastReconciledAt: nowIso,
    updatedAt: nowIso,
    ...(input.patch ?? {}),
  };
  const rows = await db
    .update(regionCustomDomains)
    .set(values)
    .where(
      and(
        eq(regionCustomDomains.id, input.id),
        eq(regionCustomDomains.lifecycleState, input.expectedState),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/**
 * Update `last_reconciled_at` without moving state. Used on every cycle
 * touch, success or no-op, so the crash-recovery scan can tell the row
 * is actively reconciled.
 */
export async function touchReconciledAt(
  db: ReconcilerDb,
  id: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  await db
    .update(regionCustomDomains)
    .set({ lastReconciledAt: nowIso, updatedAt: nowIso })
    .where(eq(regionCustomDomains.id, id));
}

// ---------------------------------------------------------------------------
// Append-only event emission
// ---------------------------------------------------------------------------

export interface AppendEventInput {
  domainId: string;
  eventType: string;
  fromState: RegionCustomDomain["lifecycleState"] | null;
  toState: RegionCustomDomain["lifecycleState"] | null;
  details?: Record<string, unknown>;
  /**
   * The reconciler run id — included in details so every event can be
   * correlated back to the Cloud Run job execution that wrote it.
   */
  reconcilerRunId: string;
}

export async function appendDomainEvent(
  db: ReconcilerDb,
  input: AppendEventInput,
): Promise<void> {
  await db.insert(regionCustomDomainEvents).values({
    domainId: input.domainId,
    eventType: input.eventType,
    fromState: input.fromState,
    toState: input.toState,
    // Reconciler-initiated events never have an actor_user_id (Decision 8).
    actorUserId: null,
    details: {
      ...(input.details ?? {}),
      reconciler_run_id: input.reconcilerRunId,
    },
  });
}

// ---------------------------------------------------------------------------
// Spec mismatch + drift payload
// ---------------------------------------------------------------------------

export class SpecMismatchError extends Error {
  constructor(
    public readonly resourceKind: ResourceKind,
    public readonly resourceName: string,
    public readonly observedSpec: unknown,
    public readonly expectedSpec: unknown,
  ) {
    super(
      `reconciler spec mismatch on ${resourceKind} ${resourceName}: halt-on-drift`,
    );
    this.name = "SpecMismatchError";
  }
}

export interface ReconcilerErrorPayload {
  drift_kind: "spec_mismatch" | "orphan_resource" | "unexpected_state";
  resource_type: ResourceKind | "Certificate.managed";
  resource_name: string;
  observed_spec: unknown;
  expected_spec: unknown;
  recoverable_from: RegionCustomDomain["lifecycleState"] | null;
  detected_at: string;
  reconciler_run_id: string;
  /** Free-form extra details — used by op 2's FAILED cert path for attempt info. */
  details?: string;
}

export interface HaltOnDriftInput {
  db: ReconcilerDb;
  logger: Logger;
  rowId: string;
  currentState: RegionCustomDomain["lifecycleState"];
  driftKind: ReconcilerErrorPayload["drift_kind"];
  resourceType: ReconcilerErrorPayload["resource_type"];
  resourceName: string;
  observedSpec: unknown;
  expectedSpec: unknown;
  recoverableFrom: RegionCustomDomain["lifecycleState"] | null;
  reconcilerRunId: string;
  details?: string;
}

/**
 * Halt reconciliation of a single row: write the structured drift payload
 * to `reconciler_error`, transition to `degraded` via state-guarded UPDATE,
 * and emit the `log.drift(...)` entry.
 *
 * If the state guard fails (the row has moved out of its expected state
 * since we read it), we log a WARNING and return — the next cycle will
 * pick the row up in its new state.
 */
export async function haltOnDrift(
  input: HaltOnDriftInput,
): Promise<RegionCustomDomain | null> {
  const payload: ReconcilerErrorPayload = {
    drift_kind: input.driftKind,
    resource_type: input.resourceType,
    resource_name: input.resourceName,
    observed_spec: input.observedSpec,
    expected_spec: input.expectedSpec,
    recoverable_from: input.recoverableFrom,
    detected_at: new Date().toISOString(),
    reconciler_run_id: input.reconcilerRunId,
    ...(input.details !== undefined ? { details: input.details } : {}),
  };

  const updated = await stateGuardedUpdate(input.db, {
    id: input.rowId,
    expectedState: input.currentState,
    newState: "degraded",
    patch: { reconcilerError: payload },
  });

  if (updated === null) {
    input.logger.warn(
      "haltOnDrift: state guard failed (row moved concurrently)",
      {
        domain_id: input.rowId,
        expected_state: input.currentState,
      },
    );
    return null;
  }

  // NOTE: drift log uses the resource_type in the label contract. We map
  // Certificate.managed → Certificate for the label since the alert policy
  // is keyed on the resource kind string.
  input.logger.drift({
    domainId: input.rowId,
    driftKind: input.driftKind,
    resourceType: input.resourceType,
    resourceName: input.resourceName,
    observedSpec: input.observedSpec,
    expectedSpec: input.expectedSpec,
    recoverableFrom: input.recoverableFrom,
  });

  await appendDomainEvent(input.db, {
    domainId: input.rowId,
    eventType: "reconciler.halt_on_drift",
    fromState: input.currentState,
    toState: "degraded",
    details: { drift: payload },
    reconcilerRunId: input.reconcilerRunId,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// ALREADY_EXISTS handler for CREATE calls
// ---------------------------------------------------------------------------

export interface HandleAlreadyExistsInput<TExisting, TSpec> {
  resourceKind: ResourceKind;
  rowId: string;
  resourceName: string;
  plannedSpec: TSpec;
  /** Re-GET the resource by its deterministic name. */
  getFn: () => Promise<TExisting | null>;
  /** Returns true if the existing resource matches what we planned to create. */
  specMatches: (existing: TExisting, planned: TSpec) => boolean;
}

export interface HandleAlreadyExistsResult<TExisting> {
  existing: TExisting;
}

/**
 * Resolve an `AlreadyExistsError` from a CREATE call into a success-path
 * outcome (R5 Decision 6):
 *
 *   1. Re-GET at the deterministic name.
 *   2. If the GET returns null (transient race), throw NotFoundError — the
 *      next cycle will retry from GET.
 *   3. If the GET returns an object whose spec matches `plannedSpec`,
 *      return the existing resource as the success value.
 *   4. If the GET returns an object whose spec does NOT match, throw
 *      `SpecMismatchError`. The caller is responsible for routing this
 *      through `haltOnDrift`.
 */
export async function handleAlreadyExists<TExisting, TSpec>(
  input: HandleAlreadyExistsInput<TExisting, TSpec>,
): Promise<HandleAlreadyExistsResult<TExisting>> {
  const existing = await input.getFn();
  if (existing === null) {
    throw new NotFoundError(input.resourceKind, input.resourceName);
  }
  if (!input.specMatches(existing, input.plannedSpec)) {
    throw new SpecMismatchError(
      input.resourceKind,
      input.resourceName,
      existing,
      input.plannedSpec,
    );
  }
  return { existing };
}

// ---------------------------------------------------------------------------
// OperationContext — passed into every operation function
// ---------------------------------------------------------------------------

export interface OperationContext {
  db: ReconcilerDb;
  logger: Logger;
  reconcilerRunId: string;
  /**
   * GCP region this reconciler instance runs in. Expected values are
   * `us-central1` and `europe-west1` per Decision 4; we type as `string`
   * so tests can inject synthetic regions without a cast.
   */
  region: string;
  /** GCP Certificate Manager client wrapper. */
  certManager: CertManagerClient;
}

// ---------------------------------------------------------------------------
// Re-exports for call sites
// ---------------------------------------------------------------------------

export { AlreadyExistsError, NotFoundError };
