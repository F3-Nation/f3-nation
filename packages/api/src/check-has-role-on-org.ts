import type { Session } from "@acme/auth";
import type { UserRole } from "@acme/shared/app/enums";
import type { Permission } from "@acme/shared/app/permissions";
import { schema, sql } from "@acme/db";
import { roleHasPermission } from "@acme/shared/app/permissions";
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

const satisfiesRole = (roleName: UserRole) => (r: { roleName: UserRole }) =>
  r.roleName === "admin" || r.roleName === roleName;

/** Max org ids per hierarchy query (each is a bind parameter; Postgres caps one statement at 65535). */
const ROLE_CHECK_ORG_CHUNK_SIZE = 10_000;

type SessionRole = NonNullable<Session["roles"]>[number];

interface RoleMatcher {
  orgId: number;
  matches: (role: SessionRole) => boolean;
}

/**
 * The session role that answers one check: `direct` when it is on the org
 * itself, otherwise the first matching role on an ancestor.
 */
interface RoleMatch {
  role: SessionRole;
  direct: boolean;
}

/**
 * For each check, finds a session role on the org itself or on any ancestor
 * within the depth guard (no is_active filter) for which `matches` is true;
 * the result array lines up with `checks` by index.
 *
 * Checks the session satisfies directly need no query at all; only the
 * remaining orgs are resolved, together, with one recursive CTE per
 * ROLE_CHECK_ORG_CHUNK_SIZE distinct orgs, which keeps a huge client-supplied
 * list under Postgres' bind-parameter limit.
 */
const findMatchingRoles = async ({
  session,
  checks,
  db,
}: {
  session: Session;
  checks: RoleMatcher[];
  db: Context["db"];
}): Promise<(RoleMatch | undefined)[]> => {
  const directMatches: (RoleMatch | undefined)[] = checks.map(
    ({ orgId, matches }) => {
      const role = session.roles?.find((r) => matches(r) && r.orgId === orgId);
      return role ? { role, direct: true } : undefined;
    },
  );

  const unresolvedOrgIds = [
    ...new Set(
      checks.flatMap(({ orgId }, i) => (directMatches[i] ? [] : [orgId])),
    ),
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

  return checks.map(({ orgId, matches }, i) => {
    const direct = directMatches[i];
    if (direct) return direct;

    const allAncestorOrgIds = ancestorIdsByOrg.get(orgId);
    const role = allAncestorOrgIds
      ? session.roles?.find((r) => matches(r) && allAncestorOrgIds.has(r.orgId))
      : undefined;
    return role ? { role, direct: false } : undefined;
  });
};

/**
 * Resolves many role checks with one hierarchy query (one more per
 * ROLE_CHECK_ORG_CHUNK_SIZE distinct orgs beyond the first chunk). The result
 * array lines up with `checks` by index, and each entry is exactly what
 * `checkHasRoleOnOrg` returns for that check on its own -- `checkHasRoleOnOrg`
 * is implemented on top of this, so the two cannot drift.
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

  for (const { orgId, roleName } of checks) {
    logDebug("api.role_check.checking", {
      userId: session.id,
      orgId,
      roleName,
      roles: session.roles,
    });
  }

  const matches = await findMatchingRoles({
    session,
    checks: checks.map(({ orgId, roleName }) => ({
      orgId,
      matches: satisfiesRole(roleName),
    })),
    db,
  });

  return checks.map(({ orgId, roleName }, i): RoleCheckOutcome => {
    const match = matches[i];
    if (!match) {
      return { success: false, orgId, roleName, mode: "no-permission" };
    }
    return match.direct
      ? { success: true, orgId, roleName, mode: "direct-permission" }
      : {
          success: true,
          orgId: match.role.orgId,
          roleName: match.role.roleName,
          mode: "org-admin",
        };
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
      (r) => satisfiesRole(roleName)(r) && requested.has(r.orgId),
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

/**
 * True when the caller (a person or an API key) has every one of
 * `permissions` on `orgId`: for each permission, a role on the org or on any
 * of its ancestors that includes it. Different roles may supply different
 * permissions. All permissions are resolved together through
 * `findMatchingRoles`, the hierarchy walk the role checks use.
 */
export const checkHasPermissionsOnOrg = async ({
  session,
  orgId,
  db,
  permissions,
}: {
  session: Session | null;
  permissions: readonly [Permission, ...Permission[]];
  orgId: number;
  db: Context["db"];
}): Promise<boolean> => {
  if (!session) return false;
  // An empty list would otherwise pass for any signed-in caller.
  if ((permissions as readonly Permission[]).length === 0) return false;

  logDebug("api.permission_check.checking", {
    userId: session.id,
    orgId,
    permissions: permissions.map(({ name }) => name),
    roles: session.roles,
  });

  const matches = await findMatchingRoles({
    session,
    checks: permissions.map((permission) => ({
      orgId,
      matches: (r: SessionRole) => roleHasPermission(r.roleName, permission),
    })),
    db,
  });
  return matches.every((match) => match !== undefined);
};
