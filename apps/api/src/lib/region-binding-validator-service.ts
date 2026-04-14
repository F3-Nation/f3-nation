/**
 * Orchestration layer for the internal region-binding validator
 * (R5 Decision 11). Pulls facts from three sources (orgs+users in Supabase
 * via @acme/db, pax-vault via its internal API, f3-region-pages via its
 * client), runs the pure triangulator, and shapes the validator response.
 *
 * The data fetchers are injected so tests can mock each source
 * independently — no database or network required for unit tests.
 */

import { and, countDistinct, eq, inArray, schema } from "@acme/db";
import type { AppDb } from "@acme/db/client";
import type { RegionRole } from "@acme/shared/app/enums";

import {
  F3RegionPagesUnavailableError,
  fetchF3RegionPage,
} from "./f3-region-pages-client";
import type { F3RegionPage } from "./f3-region-pages-client";
import {
  PaxVaultUnavailableError,
  fetchPaxVaultRegion,
} from "./pax-vault-client";
import type { PaxVaultRegion } from "./pax-vault-client";
import { triangulate } from "./region-binding-triangulator";
import type { TriangulationMismatchDetail } from "./region-binding-triangulator";

export interface ValidatorQuery {
  orgId: number;
  paxVaultRegionId: string;
  regionSlug: string;
  callingUserId: number;
}

export interface OrgFactsDetailed {
  id: number;
  name: string;
  last_modified: string;
  admin_count: number;
  caller_roles: string[];
}

export interface ValidatorResponseBody {
  org: OrgFactsDetailed;
  pax_vault: PaxVaultRegion;
  f3_region_pages: F3RegionPage;
  cross_check: {
    triple_matches: boolean;
    match_strategy: "exact" | "fuzzy" | "failed";
  };
  validated_at: string;
}

export type ValidatorOutcome =
  | { kind: "ok"; body: ValidatorResponseBody }
  | { kind: "forbidden"; reason: "caller_not_authorized_on_org" }
  | {
      kind: "mismatch";
      detail: { mismatches: TriangulationMismatchDetail[] };
    }
  | {
      kind: "source_unavailable";
      source: "pax_vault" | "f3_region_pages";
      message: string;
    }
  | { kind: "org_not_found" };

/**
 * Role names — must match the `regionRole` pg enum via @acme/db.
 * We use the `admin`/`editor` set here because binding creation requires
 * "a role sufficient to bind domains".
 */
const BINDING_ROLES = [
  "admin",
  "editor",
] as const satisfies readonly RegionRole[];
type BindingRole = (typeof BINDING_ROLES)[number];

const isBindingRole = (name: RegionRole): name is BindingRole =>
  name === "admin" || name === "editor";

export interface LoadOrgFactsInput {
  db: AppDb;
  orgId: number;
  callingUserId: number;
}

export interface LoadOrgFactsResult {
  org: {
    id: number;
    name: string;
    last_modified: string;
  };
  admin_count: number;
  caller_roles: BindingRole[];
}

/**
 * Loads org row, counts admins for that org, and fetches the calling user's
 * roles on that org. Returns `null` if the org doesn't exist.
 */
export const loadOrgFacts = async (
  input: LoadOrgFactsInput,
): Promise<LoadOrgFactsResult | null> => {
  const [org] = await input.db
    .select({
      id: schema.orgs.id,
      name: schema.orgs.name,
      updated: schema.orgs.updated,
    })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, input.orgId))
    .limit(1);

  if (!org) return null;

  // admin_count = distinct users with a binding-capable role on this org.
  const [adminCountRow] = await input.db
    .select({ value: countDistinct(schema.rolesXUsersXOrg.userId) })
    .from(schema.rolesXUsersXOrg)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.rolesXUsersXOrg.roleId))
    .where(
      and(
        eq(schema.rolesXUsersXOrg.orgId, input.orgId),
        inArray(schema.roles.name, [...BINDING_ROLES]),
      ),
    );

  // Caller's roles on THIS specific org.
  const callerRoleRows = await input.db
    .select({ roleName: schema.roles.name })
    .from(schema.rolesXUsersXOrg)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.rolesXUsersXOrg.roleId))
    .where(
      and(
        eq(schema.rolesXUsersXOrg.orgId, input.orgId),
        eq(schema.rolesXUsersXOrg.userId, input.callingUserId),
      ),
    );

  const callerRoles: BindingRole[] = callerRoleRows
    .map((r) => r.roleName)
    .filter(isBindingRole);

  return {
    org: {
      id: org.id,
      name: org.name,
      last_modified: org.updated,
    },
    admin_count: Number(adminCountRow?.value ?? 0),
    caller_roles: callerRoles,
  };
};

export type LoadOrgFactsFn = (
  input: LoadOrgFactsInput,
) => Promise<LoadOrgFactsResult | null>;

export interface ValidatorDependencies {
  db: AppDb;
  loadOrgFacts?: LoadOrgFactsFn;
  fetchPaxVault?: typeof fetchPaxVaultRegion;
  fetchF3RegionPage?: typeof fetchF3RegionPage;
  now?: () => Date;
}

/**
 * Main validator orchestrator. Does not do authentication or rate limiting —
 * those are handled by the route boundary. Does enforce authorization
 * (caller role check against the org) per Decision 11.
 */
export const runRegionBindingValidator = async (
  query: ValidatorQuery,
  deps: ValidatorDependencies,
): Promise<ValidatorOutcome> => {
  const paxVaultClient = deps.fetchPaxVault ?? fetchPaxVaultRegion;
  const f3RegionPagesClient = deps.fetchF3RegionPage ?? fetchF3RegionPage;
  const loadFacts = deps.loadOrgFacts ?? loadOrgFacts;
  const clock = deps.now ?? (() => new Date());

  const orgFacts = await loadFacts({
    db: deps.db,
    orgId: query.orgId,
    callingUserId: query.callingUserId,
  });

  if (!orgFacts) {
    return { kind: "org_not_found" };
  }

  // Authorization: caller must have a binding-capable role on the org.
  if (orgFacts.caller_roles.length === 0) {
    return { kind: "forbidden", reason: "caller_not_authorized_on_org" };
  }

  // Fetch pax-vault and f3-region-pages in parallel. Either can fail
  // independently; we want to report the first failing source cleanly.
  const [paxVaultResult, f3RegionPagesResult] = await Promise.allSettled([
    paxVaultClient({ regionId: query.paxVaultRegionId }),
    f3RegionPagesClient({ slug: query.regionSlug }),
  ]);

  if (paxVaultResult.status === "rejected") {
    const reason = paxVaultResult.reason as unknown;
    const message =
      reason instanceof PaxVaultUnavailableError
        ? reason.message
        : reason instanceof Error
          ? reason.message
          : "pax-vault fetch failed";
    return { kind: "source_unavailable", source: "pax_vault", message };
  }

  if (f3RegionPagesResult.status === "rejected") {
    const reason = f3RegionPagesResult.reason as unknown;
    const message =
      reason instanceof F3RegionPagesUnavailableError
        ? reason.message
        : reason instanceof Error
          ? reason.message
          : "f3-region-pages fetch failed";
    return {
      kind: "source_unavailable",
      source: "f3_region_pages",
      message,
    };
  }

  const paxVault = paxVaultResult.value;
  const f3RegionPages = f3RegionPagesResult.value;

  const triangulation = triangulate({
    org: { id: orgFacts.org.id, name: orgFacts.org.name },
    paxVault: {
      region_id: paxVault.region_id,
      region_name: paxVault.region_name,
    },
    f3RegionPages: { slug: f3RegionPages.slug },
    requestedRegionSlug: query.regionSlug,
    requestedPaxVaultRegionId: query.paxVaultRegionId,
  });

  if (!triangulation.triple_matches) {
    return {
      kind: "mismatch",
      detail: { mismatches: triangulation.mismatches },
    };
  }

  return {
    kind: "ok",
    body: {
      org: {
        id: orgFacts.org.id,
        name: orgFacts.org.name,
        last_modified: new Date(orgFacts.org.last_modified).toISOString(),
        admin_count: orgFacts.admin_count,
        caller_roles: orgFacts.caller_roles,
      },
      pax_vault: paxVault,
      f3_region_pages: f3RegionPages,
      cross_check: {
        triple_matches: true,
        match_strategy: triangulation.match_strategy,
      },
      validated_at: clock().toISOString(),
    },
  };
};
