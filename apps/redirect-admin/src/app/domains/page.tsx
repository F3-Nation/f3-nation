import Link from "next/link";
import { inArray } from "drizzle-orm";

import { regionCustomDomains } from "@acme/redirect-platform-db";
import type { RegionCustomDomain } from "@acme/redirect-platform-db";

import { requireAuth } from "@/lib/auth/server";
import { getRedirectAdminDb } from "@/lib/db-client";
import { getSupabaseDb } from "@/lib/supabase-client";
import { listUserAdminOrgs } from "@/lib/services/user-orgs";
import { presentLifecycleState } from "@/lib/state-presenter";
import type { LifecycleState, ReconcilerError } from "@/lib/state-presenter";

export const dynamic = "force-dynamic";

export default async function DomainsPage() {
  const user = await requireAuth();

  const { db: supabase } = getSupabaseDb();
  const { db: redirectAdminDb } = getRedirectAdminDb();

  const orgs = await listUserAdminOrgs(supabase, user.userId);
  if (orgs.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8">
        <h2 className="text-xl font-semibold">No domains</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You don&apos;t have admin rights on any orgs, so there are no domains
          to show.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block text-sm text-primary hover:underline"
        >
          ← Back
        </Link>
      </div>
    );
  }

  const orgIds = orgs.map((o) => o.orgId);
  const rows: RegionCustomDomain[] = await redirectAdminDb
    .select()
    .from(regionCustomDomains)
    .where(inArray(regionCustomDomains.orgId, orgIds));

  const orgNameById = new Map<number, string>(
    orgs.map((o) => [o.orgId, o.orgName]),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">All domains</h2>
          <p className="text-sm text-muted-foreground">
            Every `region_custom_domains` row across the orgs you admin.
          </p>
        </div>
        <Link
          href="/domains/new"
          className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
        >
          Register new
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          No domains registered yet.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {rows
            .sort((a, b) => a.hostname.localeCompare(b.hostname))
            .map((row) => {
              const presented = presentLifecycleState(
                row.lifecycleState as LifecycleState,
                row.reconcilerError as ReconcilerError | null,
              );
              return (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-4 p-4"
                >
                  <div>
                    <div className="font-medium">{row.hostname}</div>
                    <div className="text-xs text-muted-foreground">
                      {orgNameById.get(row.orgId) ?? `org #${row.orgId}`} ·{" "}
                      {row.hostnameRole} · last reconciled{" "}
                      {row.lastReconciledAt ?? "never"}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-right">
                    <span
                      className={`rounded px-3 py-1 text-xs ${variantClass(
                        presented.variant,
                      )}`}
                    >
                      {presented.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {presented.description.slice(0, 80)}
                      {presented.description.length > 80 ? "…" : ""}
                    </span>
                  </div>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}

function variantClass(variant: "info" | "warning" | "error" | "success") {
  switch (variant) {
    case "info":
      return "bg-blue-100 text-blue-900";
    case "warning":
      return "bg-yellow-100 text-yellow-900";
    case "error":
      return "bg-red-100 text-red-900";
    case "success":
      return "bg-emerald-100 text-emerald-900";
  }
}
