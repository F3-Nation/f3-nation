/**
 * User → orgs query layer. Reads from the f3-nation Supabase DB to
 * resolve which orgs a given user has `admin` or `editor` role on.
 *
 * Used by the landing page to populate the "your orgs" list, and by
 * the registration flow (indirectly via `checkUserRoleOnOrg`) to gate
 * POST /api/domains/register.
 *
 * This is intentionally NOT using `packages/api/check-has-role-on-org.ts`
 * — that helper requires a pre-populated `@acme/auth` Session with
 * roles attached, which the apps/me-style HMAC session doesn't carry.
 * Instead we query `rolesXUsersXOrg` + `roles` directly.
 */

import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { supabaseSchema } from "../supabase-client";
import type { SupabaseDb } from "../supabase-client";

const BINDING_ROLES = ["admin", "editor"] as const;
export type BindingRole = (typeof BINDING_ROLES)[number];

export interface UserOrgSummary {
  orgId: number;
  orgName: string;
  roleNames: BindingRole[];
}

/**
 * Find all orgs where the user has admin/editor. Returns an empty array
 * for users with no matching roles (e.g. PAX who aren't region admins).
 */
export async function listUserAdminOrgs(
  db: SupabaseDb,
  userId: number,
): Promise<UserOrgSummary[]> {
  // 1. Fetch the user's roles on every org.
  const roleRows = await db
    .select({
      orgId: supabaseSchema.rolesXUsersXOrg.orgId,
      roleName: supabaseSchema.roles.name,
    })
    .from(supabaseSchema.rolesXUsersXOrg)
    .innerJoin(
      supabaseSchema.roles,
      eq(supabaseSchema.roles.id, supabaseSchema.rolesXUsersXOrg.roleId),
    )
    .where(eq(supabaseSchema.rolesXUsersXOrg.userId, userId));

  // 2. Keep only binding-capable roles, group by orgId.
  const byOrgId = new Map<number, Set<BindingRole>>();
  for (const row of roleRows) {
    if (!isBindingRole(row.roleName)) continue;
    const set = byOrgId.get(row.orgId) ?? new Set<BindingRole>();
    set.add(row.roleName);
    byOrgId.set(row.orgId, set);
  }

  if (byOrgId.size === 0) return [];

  // 3. Hydrate org names in one query.
  const orgRows = await db
    .select({
      id: supabaseSchema.orgs.id,
      name: supabaseSchema.orgs.name,
    })
    .from(supabaseSchema.orgs)
    .where(inArray(supabaseSchema.orgs.id, Array.from(byOrgId.keys())));

  const orgNameById = new Map<number, string>(
    orgRows.map((r) => [r.id, r.name]),
  );

  return Array.from(byOrgId.entries())
    .map(([orgId, roles]) => ({
      orgId,
      orgName: orgNameById.get(orgId) ?? `org #${orgId}`,
      roleNames: Array.from(roles),
    }))
    .sort((a, b) => a.orgName.localeCompare(b.orgName));
}

/**
 * Does `userId` have an admin or editor role on `orgId`? Used by the
 * registration POST handler as the authorization gate.
 */
export async function checkUserRoleOnOrg(
  db: SupabaseDb,
  params: { userId: number; orgId: number },
): Promise<boolean> {
  const rows = await db
    .select({ roleName: supabaseSchema.roles.name })
    .from(supabaseSchema.rolesXUsersXOrg)
    .innerJoin(
      supabaseSchema.roles,
      eq(supabaseSchema.roles.id, supabaseSchema.rolesXUsersXOrg.roleId),
    )
    .where(
      and(
        eq(supabaseSchema.rolesXUsersXOrg.userId, params.userId),
        eq(supabaseSchema.rolesXUsersXOrg.orgId, params.orgId),
      ),
    );
  return rows.some((r) => isBindingRole(r.roleName));
}

function isBindingRole(name: string): name is BindingRole {
  return name === "admin" || name === "editor";
}
