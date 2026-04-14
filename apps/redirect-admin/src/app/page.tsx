import Link from "next/link";

import { getSessionUser } from "@/lib/auth/server";
import { getSupabaseDb } from "@/lib/supabase-client";
import { getRedirectAdminDb } from "@/lib/db-client";
import { loadLandingData } from "@/lib/services/landing-data";

interface PageProps {
  searchParams: Promise<{ error?: string; redirect?: string }>;
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
      // F3R5_012 stub. F3R5_013 swaps this for the full Decision 9
      // verification evidence UI that reads
      // `org_region_bindings.bind_time_validator_snapshot`.
      return (
        <span
          className="rounded bg-yellow-100 px-3 py-1 text-xs text-yellow-900"
          title={`verification_state=${row.status.binding.verificationState}`}
        >
          Pending verification (F3R5_013 coming soon)
        </span>
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
