/**
 * Landing-page data loader. Given a logged-in user, assembles:
 *
 *   - their admin/editor orgs (via Supabase)
 *   - for each org, the matching `org_region_bindings` row (may be
 *     absent, may be unverified, may be verified)
 *   - for each verified binding, a count of non-released
 *     `region_custom_domains` rows
 *
 * Returns a typed view model the landing page can render with zero
 * further business logic.
 */

import "server-only";

import { and, count, inArray, ne } from "drizzle-orm";

import {
  orgRegionBindings,
  regionCustomDomains,
} from "@acme/redirect-platform-db";
import type { OrgRegionBinding } from "@acme/redirect-platform-db";

import type { RedirectAdminDb } from "../db-client";
import type { SupabaseDb } from "../supabase-client";
import { listUserAdminOrgs } from "./user-orgs";
import type { BindingRole } from "./user-orgs";

export type OrgBindingStatus =
  | { kind: "no_binding" }
  | { kind: "unverified"; binding: OrgRegionBinding }
  | {
      kind: "verified";
      binding: OrgRegionBinding;
      domainCount: number;
    };

export interface LandingOrgRow {
  orgId: number;
  orgName: string;
  roleNames: BindingRole[];
  status: OrgBindingStatus;
}

export interface LandingData {
  rows: LandingOrgRow[];
}

export async function loadLandingData(
  supabase: SupabaseDb,
  redirectAdminDb: RedirectAdminDb,
  userId: number,
): Promise<LandingData> {
  const orgs = await listUserAdminOrgs(supabase, userId);
  if (orgs.length === 0) return { rows: [] };

  const orgIds = orgs.map((o) => o.orgId);

  const bindings = await redirectAdminDb
    .select()
    .from(orgRegionBindings)
    .where(inArray(orgRegionBindings.orgId, orgIds));
  const bindingsByOrgId = new Map<number, OrgRegionBinding>(
    bindings.map((b) => [b.orgId, b]),
  );

  // Count non-released domains per verified-binding org in one query.
  const verifiedOrgIds = bindings
    .filter((b) => b.verificationState === "verified")
    .map((b) => b.orgId);

  const countByOrgId = new Map<number, number>();
  if (verifiedOrgIds.length > 0) {
    const countRows = await redirectAdminDb
      .select({
        orgId: regionCustomDomains.orgId,
        value: count(regionCustomDomains.id),
      })
      .from(regionCustomDomains)
      .where(
        and(
          inArray(regionCustomDomains.orgId, verifiedOrgIds),
          ne(regionCustomDomains.lifecycleState, "released"),
        ),
      )
      .groupBy(regionCustomDomains.orgId);
    for (const r of countRows) {
      countByOrgId.set(r.orgId, Number(r.value));
    }
  }

  const rows: LandingOrgRow[] = orgs.map((org) => {
    const binding = bindingsByOrgId.get(org.orgId);
    let status: OrgBindingStatus;
    if (!binding) {
      status = { kind: "no_binding" };
    } else if (binding.verificationState === "verified") {
      status = {
        kind: "verified",
        binding,
        domainCount: countByOrgId.get(org.orgId) ?? 0,
      };
    } else {
      status = { kind: "unverified", binding };
    }
    return {
      orgId: org.orgId,
      orgName: org.orgName,
      roleNames: org.roleNames,
      status,
    };
  });

  return { rows };
}
