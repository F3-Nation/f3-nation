/**
 * Domain registration service — the extracted business logic behind
 * `POST /api/domains/register`. Route handler is a thin wrapper that
 * reads the session + request body and delegates here.
 *
 * Flow (R5 plan Phase 1):
 *   1. hostname validation + blocklist check
 *   2. per-org quota check
 *   3. binding verification state check (application layer — the DB
 *      trigger is the authority, this is UX)
 *   4. transactional INSERT into region_custom_domains + an event row
 *   5. Certificate Manager DnsAuthorization.Create
 *   6. UPDATE row with DNS challenge + advance lifecycle_state
 *
 * All external collaborators (db, validator, cert-manager) are injected
 * so unit tests can exercise the branches without real clients.
 */

import { eq } from "drizzle-orm";

import {
  domainBlocklist,
  orgRegionBindings,
  regionCustomDomainEvents,
  regionCustomDomains,
} from "@acme/redirect-platform-db";
import type {
  OrgRegionBinding,
  RegionCustomDomain,
} from "@acme/redirect-platform-db";

import { validateHostname } from "../hostname-validation";
import type { HostnameValidationError } from "../hostname-validation";
import { checkQuota } from "../quota-check";
import type { QuotaCheckResult, QuotaDbRunner } from "../quota-check";
import {
  buildDnsAuthorizationId,
  createOrReuseDnsAuthorization,
} from "../cert-manager-client";
import type {
  CertManagerClientFactory,
  DnsChallengeRecord,
} from "../cert-manager-client";

// ---------------------------------------------------------------------------
// Public input / output types
// ---------------------------------------------------------------------------

export interface RegisterDomainInput {
  orgId: number;
  hostname: string;
  hostnameRole: "apex" | "stats";
  userId: number;
}

export type RegisterDomainError =
  | {
      code: "hostname_invalid";
      detail: HostnameValidationError;
    }
  | { code: "hostname_blocked"; reason: string }
  | { code: "binding_missing" }
  | { code: "binding_unverified"; verificationState: string }
  | { code: "quota_exceeded"; quota: QuotaCheckResult }
  | { code: "user_not_authorized" }
  | { code: "internal_error"; message: string };

export interface RegisterDomainSuccess {
  domain: RegionCustomDomain;
  dnsChallenge: DnsChallengeRecord;
  /** True if the GCP DnsAuthorization existed from a prior attempt. */
  reusedExistingAuthorization: boolean;
}

export type RegisterDomainResult =
  | { ok: true; value: RegisterDomainSuccess }
  | { ok: false; error: RegisterDomainError };

// ---------------------------------------------------------------------------
// Collaborators (injectable)
// ---------------------------------------------------------------------------

/**
 * Minimal Drizzle surface the service needs. Deliberately loose so:
 *   (a) unit tests can fake it without materializing the full schema
 *   (b) the real `RedirectAdminDb` from `@acme/redirect-platform-db`
 *       is structurally assignable at the route handler layer
 */
export interface RegistrationDbRunner extends QuotaDbRunner {
  insert(table: unknown): {
    values(row: unknown): {
      returning(): Promise<unknown[]>;
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

/** Role-check callback — returns true if the user is admin/editor on org. */
export type UserOrgRoleChecker = (params: {
  userId: number;
  orgId: number;
}) => Promise<boolean>;

export interface RegisterDomainDeps {
  db: RegistrationDbRunner;
  certManagerFactory: CertManagerClientFactory;
  checkUserRole: UserOrgRoleChecker;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function registerDomain(
  input: RegisterDomainInput,
  deps: RegisterDomainDeps,
): Promise<RegisterDomainResult> {
  // --- 1. Hostname validation ---
  const hostnameResult = validateHostname(input.hostname);
  if (!hostnameResult.valid) {
    return {
      ok: false,
      error: { code: "hostname_invalid", detail: hostnameResult.reason },
    };
  }
  const hostname = hostnameResult.normalized;

  // --- 2. Role check ---
  const isAuthorized = await deps.checkUserRole({
    userId: input.userId,
    orgId: input.orgId,
  });
  if (!isAuthorized) {
    return { ok: false, error: { code: "user_not_authorized" } };
  }

  // --- 3. Blocklist check ---
  const blocklistRowsRaw = await deps.db
    .select()
    .from(domainBlocklist)
    .where(eq(domainBlocklist.hostname, hostname));
  const blocklistRows = blocklistRowsRaw as {
    hostname: string;
    reason: string;
  }[];
  if (blocklistRows.length > 0) {
    const first = blocklistRows[0];
    return {
      ok: false,
      error: {
        code: "hostname_blocked",
        reason: first?.reason ?? "blocked",
      },
    };
  }

  // --- 4. Quota check ---
  const quota = await checkQuota(deps.db, input.orgId);
  if (!quota.allowed) {
    return { ok: false, error: { code: "quota_exceeded", quota } };
  }

  // --- 5. Binding verification (app-layer UX check; trigger is the DB authority) ---
  const bindingRowsRaw = await deps.db
    .select()
    .from(orgRegionBindings)
    .where(eq(orgRegionBindings.orgId, input.orgId));
  const bindingRows = bindingRowsRaw as OrgRegionBinding[];
  const binding = bindingRows[0];
  if (!binding) {
    return { ok: false, error: { code: "binding_missing" } };
  }
  if (binding.verificationState !== "verified") {
    return {
      ok: false,
      error: {
        code: "binding_unverified",
        verificationState: binding.verificationState,
      },
    };
  }

  // --- 6. INSERT region_custom_domains + event row ---
  // NOTE: we do NOT wrap these in a SQL transaction object here because
  // the injected `db` surface is deliberately minimal. Route handlers
  // that want a real transaction can swap the injected runner for a
  // `db.transaction(tx => ...)` callback. For F3R5_012 (scaffold) the
  // two-statement sequence is tolerable: if the event-insert fails, the
  // row still exists and the reconciler will pick it up from the
  // `pending` state on the next tick. The verified-binding trigger
  // fires on the first INSERT so we cannot create an orphaned row in
  // an unverified-binding state.
  let createdDomain: RegionCustomDomain;
  try {
    const insertedRowsRaw = await deps.db
      .insert(regionCustomDomains)
      .values({
        orgId: input.orgId,
        regionSlug: binding.regionSlug,
        regionId: binding.paxVaultRegionId,
        regionName: binding.regionName,
        hostname,
        hostnameRole: input.hostnameRole,
        lifecycleState: "pending",
        createdBy: input.userId,
      })
      .returning();
    const insertedRows = insertedRowsRaw as RegionCustomDomain[];
    const first = insertedRows[0];
    if (!first) {
      return {
        ok: false,
        error: {
          code: "internal_error",
          message: "INSERT region_custom_domains returned no row",
        },
      };
    }
    createdDomain = first;
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: formatError(err, "failed to insert region_custom_domains"),
      },
    };
  }

  // Append a domain-event row. If this fails we log + continue — the
  // reconciler's audit-event machinery backfills on next tick.
  await appendEventSafely(deps.db, {
    domainId: createdDomain.id,
    eventType: "registered",
    fromState: null,
    toState: "pending",
    actorUserId: input.userId,
    details: {
      hostname,
      hostname_role: input.hostnameRole,
      source: "redirect-admin-ui",
    },
  });

  // --- 7. Certificate Manager DnsAuthorization.Create ---
  const authorizationId = buildDnsAuthorizationId(createdDomain.id);
  let dnsChallenge: DnsChallengeRecord;
  let reusedExistingAuthorization = false;
  try {
    const authResult = await createOrReuseDnsAuthorization(
      deps.certManagerFactory,
      { authorizationId, hostname },
    );
    dnsChallenge = authResult.challenge;
    reusedExistingAuthorization = authResult.reused;

    // --- 8. UPDATE row with challenge record + advance lifecycle state ---
    const updatedRowsRaw = await deps.db
      .update(regionCustomDomains)
      .set({
        lifecycleState: "awaiting_dns_challenge",
        gcpDnsAuthorizationId: authResult.resourceName,
        dnsChallengeRecordName: dnsChallenge.name,
        dnsChallengeRecordValue: dnsChallenge.data,
      })
      .where(eq(regionCustomDomains.id, createdDomain.id))
      .returning();
    const updatedRows = updatedRowsRaw as RegionCustomDomain[];
    if (updatedRows[0]) {
      createdDomain = updatedRows[0];
    }

    await appendEventSafely(deps.db, {
      domainId: createdDomain.id,
      eventType: "dns_authorization_created",
      fromState: "pending",
      toState: "awaiting_dns_challenge",
      actorUserId: input.userId,
      details: {
        gcp_dns_authorization_id: authResult.resourceName,
        reused_existing: reusedExistingAuthorization,
      },
    });
  } catch (err) {
    // Leave the row in `pending` — the reconciler will retry Cert Manager.
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: formatError(err, "DnsAuthorization.Create failed"),
      },
    };
  }

  return {
    ok: true,
    value: {
      domain: createdDomain,
      dnsChallenge,
      reusedExistingAuthorization,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface EventRowInput {
  domainId: string;
  eventType: string;
  fromState: string | null;
  toState: string | null;
  actorUserId: number;
  details: Record<string, unknown>;
}

async function appendEventSafely(
  db: RegistrationDbRunner,
  row: EventRowInput,
): Promise<void> {
  try {
    // We always call .returning() — Drizzle's insert().values() returns
    // a "PgInsertBase" that is thenable, but calling `.returning()` is
    // the simplest way to force the SQL to execute and return a typed
    // Promise that tests can mirror.
    await db
      .insert(regionCustomDomainEvents)
      .values({
        domainId: row.domainId,
        eventType: row.eventType,
        fromState: row.fromState,
        toState: row.toState,
        actorUserId: row.actorUserId,
        details: row.details,
      })
      .returning();
  } catch (err) {
    // Events are best-effort during registration. Don't break the user
    // flow for an audit-log insert. The reconciler has its own event
    // emission path (Decision 7) which will backfill.
    console.warn(
      "appendEventSafely: failed to insert audit event",
      row.eventType,
      err,
    );
  }
}

function formatError(err: unknown, prefix: string): string {
  if (err instanceof Error) {
    // Check for Postgres check_violation from the verified-binding trigger.
    const code = (err as unknown as { code?: string }).code;
    if (code === "23514") {
      return `${prefix}: verified-binding trigger rejected insert (23514) — binding is not verified`;
    }
    return `${prefix}: ${err.message}`;
  }
  return `${prefix}: ${String(err)}`;
}

/**
 * Stable structured-error → HTTP status mapping for route handlers.
 */
export function statusForRegisterError(error: RegisterDomainError): number {
  switch (error.code) {
    case "hostname_invalid":
      return 400;
    case "hostname_blocked":
      return 409;
    case "user_not_authorized":
      return 403;
    case "binding_missing":
    case "binding_unverified":
      return 412;
    case "quota_exceeded":
      return 429;
    case "internal_error":
      return 500;
  }
}

/**
 * Map a typed service error to the public JSON body shape. Never leaks
 * internal messages — `internal_error` collapses to a generic code.
 */
export function publicErrorBody(
  error: RegisterDomainError,
): Record<string, unknown> {
  switch (error.code) {
    case "hostname_invalid":
      return { error: "hostname_invalid", detail: error.detail };
    case "hostname_blocked":
      return { error: "hostname_blocked", reason: error.reason };
    case "user_not_authorized":
      return { error: "user_not_authorized" };
    case "binding_missing":
      return { error: "binding_missing" };
    case "binding_unverified":
      return {
        error: "binding_unverified",
        verification_state: error.verificationState,
      };
    case "quota_exceeded":
      return {
        error: "quota_exceeded",
        quota: {
          current: error.quota.current,
          max: error.quota.max,
        },
      };
    case "internal_error":
      return { error: "internal_error" };
  }
}
