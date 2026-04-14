/**
 * Per-org domain quota enforcement (R5 Decision 7 / 8).
 *
 * - Looks up `org_domain_quota.max_domains`; default 10 if no row.
 * - Counts non-released `region_custom_domains` rows for the org.
 * - Returns a verdict the route handler can gate on.
 *
 * The `db` parameter is typed as the loose `QuotaDbRunner` — a purely
 * structural interface that the real `RedirectAdminDb` satisfies
 * (checked at the route handler layer) and that unit tests can
 * trivially fake. We keep the type loose here so tests don't need to
 * materialize the full Drizzle relational type surface.
 */

import { and, eq, ne, sql } from "drizzle-orm";

import {
  orgDomainQuota,
  regionCustomDomains,
} from "@acme/redirect-platform-db";

export const DEFAULT_MAX_DOMAINS_PER_ORG = 10;

export interface QuotaCheckResult {
  allowed: boolean;
  current: number;
  max: number;
  /** Whether the max came from an explicit row or the default fallback. */
  source: "explicit" | "default";
}

/**
 * Minimal Drizzle surface — `select/from/where` returning an awaitable
 * that yields rows. Typed as `unknown` tails so the real Drizzle type
 * is assignable to this interface by structural widening.
 */
export interface QuotaDbRunner {
  select(projection?: unknown): {
    from(table: unknown): {
      where(predicate: unknown): Promise<unknown[]>;
    };
  };
}

export async function checkQuota(
  db: QuotaDbRunner,
  orgId: number,
): Promise<QuotaCheckResult> {
  // 1. Resolve max
  const quotaRowsRaw = await db
    .select({ value: orgDomainQuota.maxDomains })
    .from(orgDomainQuota)
    .where(eq(orgDomainQuota.orgId, orgId));
  const quotaRows = quotaRowsRaw as { value: number }[];

  const explicit = quotaRows[0]?.value;
  const max = explicit ?? DEFAULT_MAX_DOMAINS_PER_ORG;
  const source: "explicit" | "default" =
    explicit !== undefined ? "explicit" : "default";

  // 2. Count non-released domains
  const countRowsRaw = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(regionCustomDomains)
    .where(
      and(
        eq(regionCustomDomains.orgId, orgId),
        ne(regionCustomDomains.lifecycleState, "released"),
      ),
    );
  const countRows = countRowsRaw as { value: number | string }[];

  const current = Number(countRows[0]?.value ?? 0);

  return {
    allowed: current < max,
    current,
    max,
    source,
  };
}
