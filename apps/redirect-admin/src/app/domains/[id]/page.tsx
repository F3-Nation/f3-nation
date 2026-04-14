/**
 * Domain detail page (F3R5_013 Part 2).
 *
 * Renders the full row plus, when `lifecycle_state = 'degraded'`, the
 * reconciler diagnostic panel defined by Decision 6's recovery flow:
 *
 *   - formatted `reconciler_error` with observed/expected side-by-side
 *   - runbook link chosen from `drift_kind`
 *   - detected_at + reconciler_run_id + copy-to-clipboard button
 *   - Retry reconciliation button, disabled until a super-admin has
 *     written a `drift_acknowledged` event
 */

import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";

import {
  regionCustomDomainEvents,
  regionCustomDomains,
} from "@acme/redirect-platform-db";
import type { RegionCustomDomain } from "@acme/redirect-platform-db";

import { getSessionUser } from "@/lib/auth/server";
import { getRedirectAdminDb } from "@/lib/db-client";
import { getSupabaseDb } from "@/lib/supabase-client";
import { checkUserRoleOnOrg } from "@/lib/services/user-orgs";
import {
  normalizeRecoverableFrom,
  presentLifecycleState,
} from "@/lib/state-presenter";
import type { LifecycleState, ReconcilerError } from "@/lib/state-presenter";
import { isSuperAdmin } from "@/lib/services/super-admin";

import { DegradedRecoveryPanel } from "./DegradedRecoveryPanel";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export default async function DomainDetailPage({ params }: PageProps) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) {
    return (
      <ErrorPanel
        title="Sign in required"
        body="You need to sign in to view this page."
      />
    );
  }

  const { db } = getRedirectAdminDb();
  const { db: supabase } = getSupabaseDb();

  const rows = await db
    .select()
    .from(regionCustomDomains)
    .where(eq(regionCustomDomains.id, id));
  const row = rows[0] as RegionCustomDomain | undefined;
  if (!row) {
    return <ErrorPanel title="Not found" body={`domain id=${id}`} />;
  }

  const authorized = await checkUserRoleOnOrg(supabase, {
    userId: user.userId,
    orgId: row.orgId,
  });
  if (!authorized) {
    return <ErrorPanel title="Forbidden" body="You don't own this domain." />;
  }

  const presented = presentLifecycleState(
    row.lifecycleState as LifecycleState,
    row.reconcilerError as ReconcilerError | null,
  );

  // Degraded rows: look for an ack event to decide whether the retry
  // button is enabled.
  let degradedInfo: {
    driftAcknowledged: boolean;
    targetState: ReturnType<typeof normalizeRecoverableFrom>;
  } | null = null;

  if (row.lifecycleState === "degraded") {
    const ackRows = await db
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
    degradedInfo = {
      driftAcknowledged: ackRows.length > 0,
      targetState: normalizeRecoverableFrom(
        row.reconcilerError as ReconcilerError | null,
      ),
    };
  }

  const isSuper = isSuperAdmin(user.userId);

  return (
    <div className="space-y-6">
      <header className="rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{row.hostname}</h2>
            <p className="text-xs text-muted-foreground">
              id {row.id} · org #{row.orgId} · role {row.hostnameRole}
            </p>
          </div>
          <StateBadge variant={presented.variant}>{presented.label}</StateBadge>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {presented.description}
        </p>
      </header>

      {row.lifecycleState === "degraded" && degradedInfo ? (
        <DegradedRecoveryPanel
          domainId={row.id}
          reconcilerError={
            (row.reconcilerError as ReconcilerError | null) ?? null
          }
          driftAcknowledged={degradedInfo.driftAcknowledged}
          targetState={degradedInfo.targetState}
          isSuperAdmin={isSuper}
        />
      ) : null}

      <div className="rounded-lg border bg-card p-5">
        <h3 className="text-base font-semibold">Details</h3>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <DetailRow label="Region slug" value={row.regionSlug} />
          <DetailRow label="Region id" value={row.regionId} />
          <DetailRow
            label="DNS challenge"
            value={row.dnsChallengeRecordName ?? "—"}
          />
          <DetailRow
            label="Last reconciled"
            value={row.lastReconciledAt ?? "—"}
          />
          <DetailRow label="Created" value={row.createdAt} />
          <DetailRow label="Tombstoned" value={row.tombstonedAt ?? "—"} />
        </dl>
      </div>

      <Link href="/" className="text-sm text-primary hover:underline">
        ← Back to landing
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function StateBadge({
  variant,
  children,
}: {
  variant: "info" | "warning" | "error" | "success";
  children: React.ReactNode;
}) {
  const cls =
    variant === "error"
      ? "bg-red-100 text-red-900"
      : variant === "warning"
        ? "bg-yellow-100 text-yellow-900"
        : variant === "success"
          ? "bg-emerald-100 text-emerald-900"
          : "bg-muted";
  return <span className={`rounded px-3 py-1 text-xs ${cls}`}>{children}</span>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs">{value}</dd>
    </>
  );
}

function ErrorPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-6">
      <h2 className="text-lg font-semibold text-red-900">{title}</h2>
      <p className="mt-2 text-sm text-red-900">{body}</p>
    </div>
  );
}
