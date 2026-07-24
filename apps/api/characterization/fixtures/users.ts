import type { SeededRoleName } from "@acme/api/testing";
import {
  db,
  getOrCreateF3NationOrg,
  getOrCreateRoles,
  uniqueId,
} from "@acme/api/testing";
import { eq, schema } from "@acme/db";

import { logWarn } from "../../src/lib/logging";

export interface FixtureUser {
  userId: number;
  email: string;
  cleanup: () => Promise<void>;
}

/**
 * A role to link to a DB-backed fixture. `orgId` defaults to the nation org;
 * `roleName` is limited to the two roles getOrCreateRoles() actually seeds.
 */
export interface FixtureRole {
  orgId?: number;
  roleName: SeededRoleName;
}

/**
 * Insert a real user row, optionally with org roles, and hand back a cleanup
 * closure so callers never have to reason about FK ordering.
 */
export async function createFixtureUser(
  opts: { roles?: FixtureRole[] } = {},
): Promise<FixtureUser> {
  await getOrCreateRoles();
  const email = `${uniqueId()}@characterization.test`;

  // Unwind committed rows if a later insert throws, so a failed fixture never
  // leaks into count/list goldens recorded later in the (serialized) run.
  const undo: (() => Promise<void>)[] = [];
  try {
    const [user] = await db
      .insert(schema.users)
      .values({ email, f3Name: "Char User" })
      .returning({ id: schema.users.id });
    if (!user) throw new Error("failed to insert fixture user");
    undo.push(async () => {
      await db.delete(schema.users).where(eq(schema.users.id, user.id));
    });

    // Fetched at most once, and only when a role omits orgId.
    let nationOrgId: number | undefined;
    for (const role of opts.roles ?? []) {
      const orgId =
        role.orgId ?? (nationOrgId ??= (await getOrCreateF3NationOrg()).id);
      const [roleRow] = await db
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .where(eq(schema.roles.name, role.roleName))
        .limit(1);
      if (!roleRow) throw new Error(`role ${role.roleName} is missing`);

      await db
        .insert(schema.rolesXUsersXOrg)
        .values({ roleId: roleRow.id, userId: user.id, orgId });
      undo.push(async () => {
        await db
          .delete(schema.rolesXUsersXOrg)
          .where(eq(schema.rolesXUsersXOrg.userId, user.id));
      });
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
  } catch (err) {
    // Best-effort rollback, but surface a failed compensating delete: a leaked
    // row silently shifts later count/list goldens in the serialized run.
    for (const fn of undo.reverse())
      await fn().catch((err: unknown) =>
        logWarn("characterization.fixture.rollback_failed", { err }),
      );
    throw err;
  }
}
