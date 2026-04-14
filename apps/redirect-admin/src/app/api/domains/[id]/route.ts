/**
 * GET  /api/domains/:id — status poll, returns row + presented state
 * DELETE /api/domains/:id — tombstone the domain (reconciler handles teardown)
 *
 * Both route handlers check SSO and ensure the caller has admin/editor
 * role on the owning org before reading/writing.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import {
  regionCustomDomainEvents,
  regionCustomDomains,
} from "@acme/redirect-platform-db";
import type { RegionCustomDomain } from "@acme/redirect-platform-db";

import { getSessionUser } from "@/lib/auth/server";
import { getRedirectAdminDb } from "@/lib/db-client";
import { getSupabaseDb } from "@/lib/supabase-client";
import { checkUserRoleOnOrg } from "@/lib/services/user-orgs";
import { presentLifecycleState } from "@/lib/state-presenter";
import type { LifecycleState, ReconcilerError } from "@/lib/state-presenter";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const { db } = getRedirectAdminDb();
  const { db: supabase } = getSupabaseDb();

  const rows = await db
    .select()
    .from(regionCustomDomains)
    .where(eq(regionCustomDomains.id, id));
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const authorized = await checkUserRoleOnOrg(supabase, {
    userId: user.userId,
    orgId: row.orgId,
  });
  if (!authorized) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    domain: serializeDomain(row),
    presented: presentLifecycleState(
      row.lifecycleState as LifecycleState,
      row.reconcilerError as ReconcilerError | null,
    ),
  });
}

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const { db } = getRedirectAdminDb();
  const { db: supabase } = getSupabaseDb();

  const existing = await db
    .select()
    .from(regionCustomDomains)
    .where(eq(regionCustomDomains.id, id));
  const existingRow = existing[0];
  if (!existingRow) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const authorized = await checkUserRoleOnOrg(supabase, {
    userId: user.userId,
    orgId: existingRow.orgId,
  });
  if (!authorized) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // State-guarded update: tombstoning an already-tombstoned / released
  // row is a no-op. We intentionally do NOT transition from `active` to
  // `released` directly — the reconciler owns teardown + release.
  if (
    existingRow.lifecycleState === "tombstoned" ||
    existingRow.lifecycleState === "released"
  ) {
    return NextResponse.json({ ok: true, already: existingRow.lifecycleState });
  }

  const tombstonedAt = new Date().toISOString();
  const updated = await db
    .update(regionCustomDomains)
    .set({
      lifecycleState: "tombstoned",
      tombstonedAt,
    })
    .where(eq(regionCustomDomains.id, id))
    .returning();
  const updatedRow = updated[0];
  if (!updatedRow) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Best-effort audit event.
  try {
    await db.insert(regionCustomDomainEvents).values({
      domainId: updatedRow.id,
      eventType: "user_tombstoned",
      fromState: existingRow.lifecycleState,
      toState: "tombstoned",
      actorUserId: user.userId,
      details: {
        source: "redirect-admin-ui",
        reason: "user_initiated_delete",
      },
    });
  } catch (err) {
    console.warn("DELETE /api/domains/:id: event insert failed", err);
  }

  return NextResponse.json({ ok: true, domain: serializeDomain(updatedRow) });
}

function serializeDomain(row: RegionCustomDomain) {
  return {
    id: row.id,
    org_id: row.orgId,
    hostname: row.hostname,
    hostname_role: row.hostnameRole,
    lifecycle_state: row.lifecycleState,
    region_slug: row.regionSlug,
    region_name: row.regionName,
    dns_challenge_record_name: row.dnsChallengeRecordName,
    dns_challenge_record_value: row.dnsChallengeRecordValue,
    last_reconciled_at: row.lastReconciledAt,
    reconciler_error: row.reconcilerError,
    created_at: row.createdAt,
    tombstoned_at: row.tombstonedAt,
  };
}
