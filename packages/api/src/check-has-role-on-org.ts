import type { Session } from "@acme/auth";
import type { UserRole } from "@acme/shared/app/enums";
import { schema, sql } from "@acme/db";
import type { Context } from "./shared";

import { logDebug, logError } from "./logger";
import { ORG_TREE_MAX_DEPTH } from "./org-tree";

export interface RoleCheckOutcome {
  success: boolean;
  orgId: number | null;
  roleName: UserRole | null;
  mode: "direct-permission" | "org-admin" | "no-permission";
}

export interface RoleCheckRequest {
  orgId: number;
  roleName: UserRole;
}

const roleGrants = (roleName: UserRole) => (r: { roleName: UserRole }) =>
  r.roleName === "admin" || r.roleName === roleName;

/** Max org ids per hierarchy query (each is a bind parameter; Postgres caps one statement at 65535). */
const ROLE_CHECK_ORG_CHUNK_SIZE = 10_000;

/**
 * Resolves many role checks with one hierarchy query (one more per
 * ROLE_CHECK_ORG_CHUNK_SIZE distinct orgs beyond the first chunk, which keeps a
 * huge client-supplied list under Postgres' bind-parameter limit). The result array lines up with
 * `checks` by index, and each entry is exactly what `checkHasRoleOnOrg` returns
 * for that check on its own -- `checkHasRoleOnOrg` is implemented on top of
 * this, so the two cannot drift.
 *
 * Checks the session satisfies directly (a role on the org itself) need no
 * query at all; only the remaining orgs are resolved, together, with a single
 * recursive CTE that walks each org's ancestors.
 */
export const checkHasRolesOnOrgs = async ({
  session,
  checks,
  db,
}: {
  session: Session | null;
  checks: RoleCheckRequest[];
  db: Context["db"];
}): Promise<RoleCheckOutcome[]> => {
  if (!session) {
    return checks.map(() => ({
      success: false,
      orgId: null,
      roleName: null,
      mode: "no-permission" as const,
    }));
  }

  const outcomes: (RoleCheckOutcome | undefined)[] = checks.map(
    ({ orgId, roleName }) => {
      logDebug("api.role_check.checking", {
        userId: session.id,
        orgId,
        roleName,
        roles: session.roles,
      });
      const hasDirectAccessForThisOrg = session.roles?.some(
        (r) => roleGrants(roleName)(r) && r.orgId === orgId,
      );
      return hasDirectAccessForThisOrg
        ? {
            success: true,
            orgId,
            roleName,
            mode: "direct-permission" as const,
          }
        : undefined;
    },
  );

  const unresolvedOrgIds = [
    ...new Set(checks.flatMap(({ orgId }, i) => (outcomes[i] ? [] : [orgId]))),
  ];

  // org id -> ids of the org itself and every ancestor within the depth guard
  const ancestorIdsByOrg = new Map<number, Set<number>>();
  const rootsAtDepthLimit = new Set<number>();
  // Each org id is one bind parameter, and Postgres rejects a statement with
  // more than 65535 of them, so a very long list is walked in chunks. Roots
  // are independent in the CTE, so chunking cannot change any decision.
  for (let i = 0; i < unresolvedOrgIds.length; i += ROLE_CHECK_ORG_CHUNK_SIZE) {
    const chunk = unresolvedOrgIds.slice(i, i + ROLE_CHECK_ORG_CHUNK_SIZE);
    const ancestors = await db.execute<{
      root_id: number;
      id: number;
      min_depth: number;
    }>(sql`
      WITH RECURSIVE ancestors(root_id, id, parent_id, depth, path) AS (
        SELECT
          ${schema.orgs.id},
          ${schema.orgs.id},
          ${schema.orgs.parentId},
          0,
          ARRAY[${schema.orgs.id}]
        FROM ${schema.orgs}
        WHERE ${schema.orgs.id} IN (${sql.join(
          chunk.map((orgId) => sql`${orgId}`),
          sql`, `,
        )})

        UNION ALL

        SELECT
          ancestors.root_id,
          parent.${sql.identifier(schema.orgs.id.name)},
          parent.${sql.identifier(schema.orgs.parentId.name)},
          ancestors.depth + 1,
          ancestors.path || parent.${sql.identifier(schema.orgs.id.name)}
        FROM ${schema.orgs} AS parent
        INNER JOIN ancestors
          ON parent.${sql.identifier(schema.orgs.id.name)} = ancestors.parent_id
        WHERE ancestors.depth <= ${ORG_TREE_MAX_DEPTH}
          AND NOT parent.${sql.identifier(schema.orgs.id.name)} = ANY(ancestors.path)
      )
      SELECT
        root_id,
        id,
        min(depth)::integer AS min_depth
      FROM ancestors
      GROUP BY root_id, id
    `);

    for (const { root_id, id, min_depth } of ancestors) {
      if (min_depth > ORG_TREE_MAX_DEPTH) {
        // One log per org that hit the guard, as a lone checkHasRoleOnOrg would.
        if (!rootsAtDepthLimit.has(root_id)) {
          rootsAtDepthLimit.add(root_id);
          logError("api.org_tree.depth_limit_reached", {
            direction: "ancestors",
            maxDepth: ORG_TREE_MAX_DEPTH,
            rootCount: 1,
            source: "role_check",
          });
        }
        continue;
      }
      const ids = ancestorIdsByOrg.get(root_id) ?? new Set<number>();
      ids.add(id);
      ancestorIdsByOrg.set(root_id, ids);
    }
  }

  return checks.map(({ orgId, roleName }, i) => {
    const resolved = outcomes[i];
    if (resolved) return resolved;

    const allAncestorOrgIds = ancestorIdsByOrg.get(orgId);
    const matchingPermission = allAncestorOrgIds
      ? session.roles?.find(
          (r) => roleGrants(roleName)(r) && allAncestorOrgIds.has(r.orgId),
        )
      : undefined;

    if (matchingPermission) {
      return {
        success: true,
        orgId: matchingPermission.orgId,
        roleName: matchingPermission.roleName,
        mode: "org-admin" as const,
      };
    }

    return { success: false, orgId, roleName, mode: "no-permission" as const };
  });
};

export const checkHasRoleOnOrg = async ({
  session,
  orgId,
  db,
  roleName,
}: {
  session: Session | null;
  roleName: UserRole;
  orgId: number;
  db: Context["db"];
}): Promise<RoleCheckOutcome> => {
  const [outcome] = await checkHasRolesOnOrgs({
    session,
    checks: [{ orgId, roleName }],
    db,
  });
  // checks has exactly one entry, so the result has exactly one entry.
  return outcome!;
};

/** True when the caller holds `roleName` (or admin) on at least one of `orgIds`. */
export const checkHasRoleOnAnyOrg = async ({
  session,
  orgIds,
  db,
  roleName,
}: {
  session: Session | null;
  orgIds: number[];
  db: Context["db"];
  roleName: UserRole;
}): Promise<boolean> => {
  // A direct role on any requested org already answers yes, with no query.
  const requested = new Set(orgIds);
  if (
    session?.roles?.some(
      (r) => roleGrants(roleName)(r) && requested.has(r.orgId),
    )
  ) {
    return true;
  }
  const outcomes = await checkHasRolesOnOrgs({
    session,
    checks: [...requested].map((orgId) => ({ orgId, roleName })),
    db,
  });
  return outcomes.some((outcome) => outcome.success);
};

/**
 * True when the caller holds `roleName` (or admin) on every one of `orgIds`
 * (vacuously true for an empty list).
 */
export const checkHasRoleOnAllOrgs = async ({
  session,
  orgIds,
  db,
  roleName,
}: {
  session: Session | null;
  orgIds: number[];
  db: Context["db"];
  roleName: UserRole;
}): Promise<boolean> => {
  const outcomes = await checkHasRolesOnOrgs({
    session,
    checks: [...new Set(orgIds)].map((orgId) => ({ orgId, roleName })),
    db,
  });
  return outcomes.every((outcome) => outcome.success);
};
