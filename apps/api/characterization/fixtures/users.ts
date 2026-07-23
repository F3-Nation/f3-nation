import {
  db,
  getOrCreateF3NationOrg,
  getOrCreateRoles,
  uniqueId,
} from "@acme/api/testing";
import { and, eq, schema } from "@acme/db";

export interface FixtureUser {
  userId: number;
  email: string;
  cleanup: () => Promise<void>;
}

/**
 * Insert a real user row, optionally with org roles, and hand back a cleanup
 * closure so callers never have to reason about FK ordering.
 */
export async function createFixtureUser(
  opts: { roles?: { orgId?: number; roleName: "editor" | "admin" }[] } = {},
): Promise<FixtureUser> {
  await getOrCreateRoles();
  const email = `${uniqueId()}@characterization.test`;

  const [user] = await db
    .insert(schema.users)
    .values({ email, f3Name: "Char User" })
    .returning({ id: schema.users.id });
  if (!user) throw new Error("failed to insert fixture user");

  for (const role of opts.roles ?? []) {
    const orgId = role.orgId ?? (await getOrCreateF3NationOrg()).id;
    const [roleRow] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.name, role.roleName))
      .limit(1);
    if (!roleRow) throw new Error(`role ${role.roleName} is missing`);

    await db
      .insert(schema.rolesXUsersXOrg)
      .values({ roleId: roleRow.id, userId: user.id, orgId });
  }

  return {
    userId: user.id,
    email,
    cleanup: async () => {
      await db
        .delete(schema.rolesXUsersXOrg)
        .where(eq(schema.rolesXUsersXOrg.userId, user.id));
      await db.delete(schema.users).where(eq(schema.users.id, user.id));
    },
  };
}

/** Look up an existing role assignment; used by assertions, not setup. */
export async function hasRole(userId: number, orgId: number): Promise<boolean> {
  const rows = await db
    .select({ userId: schema.rolesXUsersXOrg.userId })
    .from(schema.rolesXUsersXOrg)
    .where(
      and(
        eq(schema.rolesXUsersXOrg.userId, userId),
        eq(schema.rolesXUsersXOrg.orgId, orgId),
      ),
    );
  return rows.length > 0;
}
