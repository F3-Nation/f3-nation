import type { Session } from "@acme/auth";
import { and, eq, schema, sql } from "@acme/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  cleanup,
  createAdminSession,
  createTestClient,
  db,
  mockAuthWithSession,
  uniqueId,
} from "./test-utils";

describe("user audit attribution", () => {
  const userIds: number[] = [];
  const keyIds: number[] = [];
  let nationId: number;
  let createdNation = false;
  let session: Session;

  beforeAll(async () => {
    let [nation] = await db
      .select()
      .from(schema.orgs)
      .where(
        and(
          eq(schema.orgs.name, "F3 Nation"),
          eq(schema.orgs.orgType, "nation"),
        ),
      );
    if (!nation) {
      [nation] = await db
        .insert(schema.orgs)
        .values({ name: "F3 Nation", orgType: "nation", isActive: true })
        .returning();
      createdNation = true;
    }
    if (!nation) throw new Error("Missing synthetic nation");
    nationId = nation.id;
    const roles = [
      { orgId: nationId, orgName: "F3 Nation", roleName: "admin" as const },
    ];
    session = { ...(await createAdminSession()), roles };
    if (!session.user) throw new Error("Missing synthetic session user");
    session.user.roles = roles;
  });

  beforeEach(async () => mockAuthWithSession(session));

  afterAll(async () => {
    for (const id of keyIds) await cleanup.apiKey(id);
    for (const id of userIds) await cleanup.user(id);
    if (createdNation) await cleanup.org(nationId);
  });

  const createTarget = async () => {
    const result = await createTestClient().user.crupdate({
      email: `audit-user-${uniqueId()}@example.com`,
      f3Name: "Audit target",
      roles: [{ orgId: nationId, roleName: "editor" }],
    });
    userIds.push(result.id);
    return result;
  };

  const history = (id: number) =>
    db.execute(sql`
    SELECT op, changed_by, changed_via FROM public_history.users
    WHERE row_id = ${String(id)} ORDER BY id
  `);
  const roleHistory = (id: number) =>
    db.execute(sql`
    SELECT op, changed_by, changed_via FROM public_history.roles_x_users_x_org
    WHERE coalesce(new_row, old_row)->>'user_id' = ${String(id)} ORDER BY id
  `);

  it("attributes profile and role creation/updates to the administrator, not the edited user", async () => {
    const user = await createTarget();
    expect(user.id).not.toBe(1);
    await createTestClient().user.crupdate({
      id: user.id,
      f3Name: "Updated audit target",
      roles: [{ orgId: nationId, roleName: "admin" }],
    });
    expect(await history(user.id)).toEqual([
      { op: "I", changed_by: 1, changed_via: null },
      { op: "U", changed_by: 1, changed_via: null },
    ]);
    expect(await roleHistory(user.id)).toEqual([
      { op: "I", changed_by: 1, changed_via: null },
      { op: "D", changed_by: 1, changed_via: null },
      { op: "I", changed_by: 1, changed_via: null },
    ]);
  });

  it("attributes permanent deletion and role cleanup to the administrator", async () => {
    const user = await createTarget();
    expect(await createTestClient().user.delete({ id: user.id })).toEqual({
      userId: user.id,
    });
    expect((await history(user.id)).at(-1)).toEqual({
      op: "D",
      changed_by: 1,
      changed_via: null,
    });
    expect((await roleHistory(user.id)).at(-1)).toEqual({
      op: "D",
      changed_by: 1,
      changed_via: null,
    });
    expect(
      await db.select().from(schema.users).where(eq(schema.users.id, user.id)),
    ).toEqual([]);
  });

  it("keeps source roles and their history unchanged when a referenced user cannot be deleted", async () => {
    const user = await createTarget();
    const [key] = await db
      .insert(schema.apiKeys)
      .values({
        key: `local-audit-${uniqueId()}`,
        name: "Synthetic audit fixture",
        ownerId: user.id,
      })
      .returning();
    if (!key) throw new Error("Missing synthetic API key");
    keyIds.push(key.id);
    const beforeUser = await history(user.id);
    const beforeRoles = await roleHistory(user.id);
    await expect(
      createTestClient().user.delete({ id: user.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await history(user.id)).toEqual(beforeUser);
    expect(await roleHistory(user.id)).toEqual(beforeRoles);
    expect(
      await db
        .select()
        .from(schema.rolesXUsersXOrg)
        .where(eq(schema.rolesXUsersXOrg.userId, user.id)),
    ).toHaveLength(1);
  });
});
