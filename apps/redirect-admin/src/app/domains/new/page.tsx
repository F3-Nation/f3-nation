import Link from "next/link";
import { inArray } from "drizzle-orm";

import { orgRegionBindings } from "@acme/redirect-platform-db";

import { requireAuth } from "@/lib/auth/server";
import { getRedirectAdminDb } from "@/lib/db-client";
import { getSupabaseDb } from "@/lib/supabase-client";
import { listUserAdminOrgs } from "@/lib/services/user-orgs";
import { RegisterDomainForm } from "@/components/register-domain-form";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ org_id?: string }>;
}

export default async function NewDomainPage({ searchParams }: PageProps) {
  const user = await requireAuth();
  const params = await searchParams;

  const { db: supabase } = getSupabaseDb();
  const { db: redirectAdminDb } = getRedirectAdminDb();

  const orgs = await listUserAdminOrgs(supabase, user.userId);
  if (orgs.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8">
        <h2 className="text-xl font-semibold">No eligible orgs</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You need admin or editor permissions on at least one org to register a
          domain.
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

  // Only verified-binding orgs may appear in the org picker.
  const bindings = await redirectAdminDb
    .select()
    .from(orgRegionBindings)
    .where(
      inArray(
        orgRegionBindings.orgId,
        orgs.map((o) => o.orgId),
      ),
    );
  const verifiedOrgIds = new Set(
    bindings
      .filter((b) => b.verificationState === "verified")
      .map((b) => b.orgId),
  );

  const eligibleOrgs = orgs.filter((o) => verifiedOrgIds.has(o.orgId));

  if (eligibleOrgs.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8">
        <h2 className="text-xl font-semibold">No verified bindings yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          None of your orgs have a verified region binding. Bind + verify via
          F3R5_013 (coming soon) before registering custom domains.
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

  const defaultOrgId = params.org_id ? Number(params.org_id) : undefined;
  const initialOrgId =
    defaultOrgId && eligibleOrgs.some((o) => o.orgId === defaultOrgId)
      ? defaultOrgId
      : eligibleOrgs[0]?.orgId;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Register a custom domain</h2>
        <p className="text-sm text-muted-foreground">
          Pick the org, enter the hostname, and choose whether this is the apex
          (e.g. your region home page) or a stats subdomain.
        </p>
      </div>
      <RegisterDomainForm
        orgs={eligibleOrgs.map((o) => ({ id: o.orgId, name: o.orgName }))}
        initialOrgId={initialOrgId}
      />
    </div>
  );
}
