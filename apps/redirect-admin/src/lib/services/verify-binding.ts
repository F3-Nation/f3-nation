/**
 * Binding verification service (F3R5_013, Decision 9).
 *
 * Pure-logic extraction of the POST /api/bindings/[orgId]/verify
 * handler. Inputs are injected so unit tests can fake the database +
 * validator without touching real clients.
 *
 * Flow for `action = 'confirm'`:
 *   1. caller must have admin/editor on the org (enforced at the route)
 *   2. load the binding row
 *   3. call the validator a second time (server-side, freshly), confirm
 *      the triple still matches
 *   4. UPDATE org_region_bindings — mark verified, stamp verifier + method
 *   5. emit a structured audit log line
 *
 * Flow for `action = 'report_mismatch'`:
 *   1. caller must have admin/editor on the org
 *   2. do NOT mark verified
 *   3. emit a structured audit log line with the validator snapshot
 *
 * ---------------------------------------------------------------------
 * DEVIATION FROM THE PLAN
 * ---------------------------------------------------------------------
 * The plan asks this service to append a row to `region_custom_domain_events`
 * with `details.scope = 'binding'`. That table's schema (see
 * `packages/redirect-platform-db/src/schema.ts`) has a NOT NULL FK on
 * `domain_id` referencing `region_custom_domains.id`, so binding-scoped
 * events cannot be written there without a migration that relaxes the
 * FK. The task spec's blocking condition says: "do NOT create a new
 * events table"; the same spec also says "keep migration surface minimal".
 *
 * To honor both constraints we:
 *   - mark the binding row authoritatively via UPDATE (the canonical
 *     verification state + verifier + method already live on the row),
 *   - record the full snapshot JSON in `bind_time_validator_snapshot` at
 *     confirmation time (ensures the payload the admin attested to is
 *     durable),
 *   - emit a Cloud-Logging-compatible structured stdout line tagged with
 *     `redirect_platform_binding_event=true` as the audit trail for
 *     non-state-changing actions (`reported_mismatch`).
 *
 * F3R5_013-followup TODO: once a `region_binding_events` table (or a
 * nullable-domain_id on the existing events table) lands, replace the
 * log-only path with an insert.
 */

import { eq } from "drizzle-orm";

import { orgRegionBindings } from "@acme/redirect-platform-db";
import type { OrgRegionBinding } from "@acme/redirect-platform-db";

import type {
  ValidatorClient,
  ValidatorResponseBody,
} from "../validator-client";
import {
  TripleMismatchError,
  ValidatorUnavailableError,
} from "../validator-client";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type VerifyBindingAction = "confirm" | "report_mismatch";

export interface VerifyBindingInput {
  orgId: number;
  userId: number;
  action: VerifyBindingAction;
}

export type VerifyBindingError =
  | { code: "binding_not_found" }
  | { code: "already_verified" }
  | { code: "validator_unavailable"; message: string }
  | {
      code: "triple_mismatch";
      mismatches: { field: string; reason: string }[];
    }
  | { code: "internal_error"; message: string };

export interface VerifyBindingSuccess {
  action: VerifyBindingAction;
  binding: OrgRegionBinding;
}

export type VerifyBindingResult =
  | { ok: true; value: VerifyBindingSuccess }
  | { ok: false; error: VerifyBindingError };

// ---------------------------------------------------------------------------
// Collaborators (injectable)
// ---------------------------------------------------------------------------

/** Minimal Drizzle surface the service uses. */
export interface VerifyBindingDb {
  select(): {
    from(table: unknown): {
      where(predicate: unknown): Promise<unknown[]>;
    };
  };
  update(table: unknown): {
    set(values: unknown): {
      where(predicate: unknown): {
        returning(): Promise<unknown[]>;
      };
    };
  };
}

/** Validator client surface the service needs — the real client satisfies it. */
export interface VerifyValidatorClient {
  validate: ValidatorClient["validate"];
}

/** Pluggable structured logger; defaults to console.info. */
export interface StructuredLogger {
  info(payload: Record<string, unknown>): void;
}

export interface VerifyBindingDeps {
  db: VerifyBindingDb;
  validator: VerifyValidatorClient;
  logger?: StructuredLogger;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function verifyBinding(
  input: VerifyBindingInput,
  deps: VerifyBindingDeps,
): Promise<VerifyBindingResult> {
  const logger: StructuredLogger = deps.logger ?? defaultLogger();

  // 1. Load the binding row.
  const bindingRowsRaw = await deps.db
    .select()
    .from(orgRegionBindings)
    .where(eq(orgRegionBindings.orgId, input.orgId));
  const bindingRows = bindingRowsRaw as OrgRegionBinding[];
  const binding = bindingRows[0];
  if (!binding) {
    return { ok: false, error: { code: "binding_not_found" } };
  }
  if (binding.verificationState === "verified") {
    return { ok: false, error: { code: "already_verified" } };
  }

  // 2. For both actions, call the validator one more time — this is a
  //    fresh server-side read, not the one the user saw on GET. Prevents
  //    TOCTOU issues between display and confirmation.
  let validatorResponse: ValidatorResponseBody;
  try {
    validatorResponse = await deps.validator.validate({
      orgId: binding.orgId,
      paxVaultRegionId: binding.paxVaultRegionId,
      regionSlug: binding.regionSlug,
      callingUserId: input.userId,
    });
  } catch (err) {
    if (err instanceof ValidatorUnavailableError) {
      return {
        ok: false,
        error: { code: "validator_unavailable", message: err.message },
      };
    }
    if (err instanceof TripleMismatchError) {
      return {
        ok: false,
        error: {
          code: "triple_mismatch",
          mismatches: err.mismatches.map((m) => ({
            field: m.field,
            reason: m.reason,
          })),
        },
      };
    }
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: formatError(err, "validator call failed"),
      },
    };
  }

  // 3a. `report_mismatch` — no DB mutation, just log.
  if (input.action === "report_mismatch") {
    logger.info({
      redirect_platform_binding_event: true,
      action: "reported_mismatch",
      org_id: input.orgId,
      actor_user_id: input.userId,
      validator_snapshot: validatorResponse,
      // TODO(F3R5_013-followup): open a real support ticket (Jira/Linear).
      ticket_status: "logged_only",
    });
    return {
      ok: true,
      value: { action: input.action, binding },
    };
  }

  // 3b. `confirm` — reject if the re-check disagrees with itself (this
  //    should already have been caught as TripleMismatchError above, but
  //    we defense-in-depth check the parsed body here too).
  if (!validatorResponse.cross_check.triple_matches) {
    return {
      ok: false,
      error: {
        code: "triple_mismatch",
        mismatches: [
          {
            field: "cross_check",
            reason: "validator re-check returned triple_matches=false",
          },
        ],
      },
    };
  }

  // 4. UPDATE binding row.
  const now = new Date().toISOString();
  let updatedBinding: OrgRegionBinding;
  try {
    const updatedRaw = await deps.db
      .update(orgRegionBindings)
      .set({
        verificationState: "verified",
        verifiedByUserId: input.userId,
        verifiedAt: now,
        verificationMethod: "region_admin_confirmed",
        bindTimeValidatorSnapshot: validatorResponse,
        updatedAt: now,
      })
      .where(eq(orgRegionBindings.orgId, input.orgId))
      .returning();
    const rows = updatedRaw as OrgRegionBinding[];
    const first = rows[0];
    if (!first) {
      return {
        ok: false,
        error: {
          code: "internal_error",
          message: "UPDATE org_region_bindings returned no row",
        },
      };
    }
    updatedBinding = first;
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: formatError(err, "UPDATE org_region_bindings failed"),
      },
    };
  }

  // 5. Audit log.
  logger.info({
    redirect_platform_binding_event: true,
    action: "verified",
    org_id: input.orgId,
    actor_user_id: input.userId,
    verification_method: "region_admin_confirmed",
    validator_snapshot: validatorResponse,
  });

  return {
    ok: true,
    value: { action: "confirm", binding: updatedBinding },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultLogger(): StructuredLogger {
  return {
    info(payload) {
      // Structured JSON — Cloud Run's logging agent will parse stdout as
      // structured log entries when the line is valid JSON.
      console.info(JSON.stringify(payload));
    },
  };
}

function formatError(err: unknown, prefix: string): string {
  if (err instanceof Error) return `${prefix}: ${err.message}`;
  return `${prefix}: ${String(err)}`;
}

export function statusForVerifyBindingError(error: VerifyBindingError): number {
  switch (error.code) {
    case "binding_not_found":
      return 404;
    case "already_verified":
      return 409;
    case "validator_unavailable":
      return 503;
    case "triple_mismatch":
      return 422;
    case "internal_error":
      return 500;
  }
}

export function publicVerifyBindingErrorBody(
  error: VerifyBindingError,
): Record<string, unknown> {
  switch (error.code) {
    case "binding_not_found":
      return { error: "binding_not_found" };
    case "already_verified":
      return { error: "already_verified" };
    case "validator_unavailable":
      return { error: "validator_unavailable" };
    case "triple_mismatch":
      return { error: "triple_mismatch", mismatches: error.mismatches };
    case "internal_error":
      return { error: "internal_error" };
  }
}
