import { eq } from "..";
import { authSchema, schema } from "..";
import type { AppDb } from "../client";
import { DEV_USERS, LOCAL_API_KEYS, LOCAL_OAUTH_CLIENTS } from "./data";

interface RoleIds {
  adminId: number;
  editorId: number;
}

interface SeedUsersResult {
  adminUserId: number;
  roleIds: RoleIds;
}

export async function seedDevUsers(
  db: AppDb,
  nationId: number,
): Promise<SeedUsersResult> {
  // 7. Roles — the system only uses editor/admin. Read-only access is the
  // absence of a role (defacto "user"), so "user" is intentionally not seeded.
  const SEED_ROLES = ["editor", "admin"] as const;
  const existingRoles = await db.select().from(schema.roles);
  const rolesToInsert = SEED_ROLES.filter(
    (r) => !existingRoles.some((e) => e.name === r),
  );
  if (rolesToInsert.length > 0) {
    await db
      .insert(schema.roles)
      .values(rolesToInsert.map((r) => ({ name: r })))
      .onConflictDoNothing();
    console.log(`  + Inserted roles: ${rolesToInsert.join(", ")}`);
  }
  const allRoles = await db.select().from(schema.roles);
  const adminRole = allRoles.find((r) => r.name === "admin");
  const editorRole = allRoles.find((r) => r.name === "editor");
  if (!adminRole || !editorRole) throw new Error("Roles missing after insert");

  // 8. Dev users
  let adminUserId: number | undefined;
  for (const devUser of DEV_USERS) {
    const { role, ...userData } = devUser;
    await db.insert(schema.users).values(userData).onConflictDoNothing();

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, devUser.email));
    if (!user) continue;

    if (role === "admin") adminUserId = user.id;

    const roleId =
      role === "admin"
        ? adminRole.id
        : role === "editor"
          ? editorRole.id
          : null;
    if (roleId !== null) {
      await db
        .insert(schema.rolesXUsersXOrg)
        .values({ userId: user.id, roleId, orgId: nationId })
        .onConflictDoNothing();
    }
    console.log(`  ✓ Dev user: ${devUser.email} (${role ?? "no role"})`);
  }

  if (!adminUserId) throw new Error("Admin dev user missing after insert");
  return {
    adminUserId,
    roleIds: {
      adminId: adminRole.id,
      editorId: editorRole.id,
    },
  };
}

export async function seedApiKeys(
  db: AppDb,
  adminUserId: number,
  nationId: number,
  roleIds: RoleIds,
): Promise<void> {
  // 9. API keys
  for (const apiKey of LOCAL_API_KEYS) {
    const [inserted] = await db
      .insert(schema.apiKeys)
      .values({ ...apiKey, ownerId: adminUserId })
      .onConflictDoNothing()
      .returning({ id: schema.apiKeys.id });

    const keyId =
      inserted?.id ??
      (
        await db
          .select({ id: schema.apiKeys.id })
          .from(schema.apiKeys)
          .where(eq(schema.apiKeys.key, apiKey.key))
          .limit(1)
      )[0]?.id;

    if (keyId) {
      // Read-only keys (role: null) get no association — absence of a role is
      // the system's read-only access level.
      const roleId = apiKey.role === "editor" ? roleIds.editorId : null;
      if (roleId !== null) {
        await db
          .insert(schema.rolesXApiKeysXOrg)
          .values({ apiKeyId: keyId, roleId, orgId: nationId })
          .onConflictDoNothing();
      }
    }
    console.log(`  ✓ API key: ${apiKey.key}`);
  }
}

export async function seedOAuthClients(db: AppDb): Promise<void> {
  // 10. OAuth clients
  for (const client of LOCAL_OAUTH_CLIENTS) {
    await db
      .insert(authSchema.oauthClients)
      .values(client)
      .onConflictDoNothing();
    console.log(`  ✓ OAuth client: ${client.id}`);
  }
}
