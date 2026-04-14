import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";

import { regionCustomDomains } from "@acme/redirect-platform-db";
import type { RegionCustomDomain } from "@acme/redirect-platform-db";

import { getSessionUser } from "@/lib/auth/server";
import { getSupabaseDb } from "@/lib/supabase-client";
import { getRedirectAdminDb } from "@/lib/db-client";
import { loadLandingData } from "@/lib/services/landing-data";

interface PageProps {
  searchParams: Promise<{
    error?: string;
    redirect?: string;
    flash?: string;
  }>;
}

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await getSessionUser();

  if (!user) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 rounded-lg border bg-card p-8 shadow-sm">
        <h2 className="text-xl font-semibold">Sign in</h2>
        <p className="text-sm text-muted-foreground">
          Self-serve custom domain registration for F3 regions. You must be an
          admin or editor on at least one F3 org to use this tool.
        </p>
        {params.error ? (
          <p className="text-sm text-destructive">
            Error: {prettyError(params.error)}
          </p>
        ) : null}
        <Link
          href={`/api/auth/login${params.redirect ? `?returnTo=${encodeURIComponent(params.redirect)}` : ""}`}
          className="rounded bg-primary px-4 py-2 text-center text-primary-foreground hover:opacity-90"
        >
          Sign in with F3 SSO
        </Link>
      </div>
    );
  }

  const { db: supabase } = getSupabaseDb();
  const { db: redirectAdminDb } = getRedirectAdminDb();
  const data = await loadLandingData(supabase, redirectAdminDb, user.userId);

  // Decision 6 surface: fetch all `degraded` domains the user owns
  // across all their verified orgs. The landing page flags them with a
  // "Needs attention" badge that links to the domain detail page.
  const verifiedOrgIds = data.rows
    .filter((r) => r.status.kind === "verified")
    .map((r) => r.orgId);
  let degradedDomains: RegionCustomDomain[] = [];
  if (verifiedOrgIds.length > 0) {
    degradedDomains = (await redirectAdminDb
      .select()
      .from(regionCustomDomains)
      .where(
        and(
          inArray(regionCustomDomains.orgId, verifiedOrgIds),
          eq(regionCustomDomains.lifecycleState, "degraded"),
        ),
      )) as RegionCustomDomain[];
  }
  const degradedByOrgId = new Map<number, RegionCustomDomain[]>();
  for (const d of degradedDomains) {
    const list = degradedByOrgId.get(d.orgId) ?? [];
    list.push(d);
    degradedByOrgId.set(d.orgId, list);
  }

  if (data.rows.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8">
        <h2 className="text-xl font-semibold">No orgs found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Signed in as {user.email}. You don&apos;t currently have admin or
          editor permissions on any F3 org, so there is nothing to manage here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {params.flash ? <FlashBanner flash={params.flash} /> : null}
      <div>
        <h2 className="text-xl font-semibold">Your orgs</h2>
        <p className="text-sm text-muted-foreground">
          Signed in as {user.email}. Each row below shows the binding state for
          one of your orgs. Verified orgs can register custom domains.
        </p>
      </div>
      <ul className="space-y-3">
        {data.rows.map((row) => (
          <li
            key={row.orgId}
            className="rounded-lg border bg-card p-4 shadow-sm"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">{row.orgName}</div>
                <div className="text-xs text-muted-foreground">
                  org #{row.orgId} · {row.roleNames.join(", ")}
                </div>
              </div>
              <OrgStatus row={row} />
            </div>
            {(degradedByOrgId.get(row.orgId) ?? []).map((d) => (
              <div
                key={d.id}
                className="mt-3 flex items-center justify-between gap-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900"
              >
                <div>
                  <span className="rounded bg-red-900 px-2 py-0.5 text-[10px] uppercase text-white">
                    Needs attention
                  </span>{" "}
                  {d.hostname} is degraded.
                </div>
                <Link
                  href={`/domains/${d.id}`}
                  className="underline hover:no-underline"
                >
                  View recovery →
                </Link>
              </div>
            ))}
          </li>
        ))}
      </ul>
      <div>
        <Link href="/domains" className="text-sm text-primary hover:underline">
          View all registered domains →
        </Link>
      </div>
    </div>
  );
}

function FlashBanner({ flash }: { flash: string }) {
  switch (flash) {
    case "already_verified":
      return (
        <div className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          That binding is already verified — nothing to do.
        </div>
      );
    case "verified":
      return (
        <div className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          Binding verified. You can now register custom domains for this org.
        </div>
      );
    default:
      return null;
  }
}

function OrgStatus({
  row,
}: {
  row: Awaited<ReturnType<typeof loadLandingData>>["rows"][number];
}) {
  switch (row.status.kind) {
    case "no_binding":
      return (
        <span className="rounded bg-muted px-3 py-1 text-xs">
          No binding — contact platform admin
        </span>
      );
    case "unverified":
      return (
        <div className="flex items-center gap-3 text-sm">
          <span
            className="rounded bg-yellow-100 px-3 py-1 text-xs text-yellow-900"
            title={`verification_state=${row.status.binding.verificationState}`}
          >
            Pending verification
          </span>
          <Link
            href={`/bindings/${row.orgId}/verify`}
            className="text-primary hover:underline"
          >
            Verify binding →
          </Link>
        </div>
      );
    case "verified":
      return (
        <div className="flex items-center gap-3 text-sm">
          <span className="rounded bg-emerald-100 px-3 py-1 text-xs text-emerald-900">
            Verified · {row.status.domainCount} domains
          </span>
          <Link
            href={`/domains/new?org_id=${row.orgId}`}
            className="text-primary hover:underline"
          >
            Register domain
          </Link>
        </div>
      );
  }
}

function prettyError(code: string): string {
  switch (code) {
    case "csrf_mismatch":
      return "Session expired during sign-in. Please try again.";
    case "token_exchange_failed":
      return "SSO token exchange failed.";
    case "user_not_found":
      return "Your SSO account is missing an email.";
    default:
      return code;
  }
}
