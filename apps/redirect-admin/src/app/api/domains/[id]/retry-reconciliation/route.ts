/**
 * POST /api/domains/:id/retry-reconciliation — F3R5_013, Decision 6.
 *
 * Requires an SSO session + admin/editor on the domain's owning org.
 * Delegates all business logic (state guard, drift-ack gate, UPDATE)
 * to `retryReconciliation`.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { regionCustomDomains } from "@acme/redirect-platform-db";
import type { RegionCustomDomain } from "@acme/redirect-platform-db";

import { getSessionUser } from "@/lib/auth/server";
import { getRedirectAdminDb } from "@/lib/db-client";
import { getSupabaseDb } from "@/lib/supabase-client";
import { checkUserRoleOnOrg } from "@/lib/services/user-orgs";
import {
  retryReconciliation,
  statusForRetryReconciliationError,
} from "@/lib/services/retry-reconciliation";
import type { RetryReconciliationDb } from "@/lib/services/retry-reconciliation";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { id } = await ctx.params;

  const { db } = getRedirectAdminDb();
  const { db: supabase } = getSupabaseDb();

  // Role check: we resolve the owning orgId first so we can reuse the
  // same direct-query pattern the DELETE handler uses.
  const domainRows = await db
    .select()
    .from(regionCustomDomains)
    .where(eq(regionCustomDomains.id, id));
  const domain = domainRows[0] as RegionCustomDomain | undefined;
  if (!domain) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const authorized = await checkUserRoleOnOrg(supabase, {
    userId: user.userId,
    orgId: domain.orgId,
  });
  if (!authorized) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const result = await retryReconciliation(
    { domainId: id, userId: user.userId },
    { db: db as unknown as RetryReconciliationDb },
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error.code, ...serializeErrorDetail(result.error) },
      { status: statusForRetryReconciliationError(result.error) },
    );
  }

  return NextResponse.json({
    ok: true,
    target_state: result.value.targetState,
  });
}

function serializeErrorDetail(error: {
  code: string;
  actualState?: string;
}): Record<string, unknown> {
  if (error.code === "domain_not_degraded" && "actualState" in error) {
    return { actual_state: error.actualState };
  }
  return {};
}
