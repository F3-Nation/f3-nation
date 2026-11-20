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

/**
 * A dev user whose `regionName` isn't in `regionIds` (a loaded snapshot
 * without that region) is still inserted, but gets no role.
 */
export async function seedDevUsers(
  db: AppDb,
  nationId: number,
  regionIds: Record<string, number> = {},
): Promise<SeedUsersResult> {
  // 7. Roles — seed access-grant roles only; a signed-in user needs no role
  // for member-tier access.
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
    const { role, regionName, ...userData } = devUser;
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
    const orgId = regionName ? regionIds[regionName] : nationId;
    if (roleId !== null && orgId !== undefined) {
      await db
        .insert(schema.rolesXUsersXOrg)
        .values({ userId: user.id, roleId, orgId })
        .onConflictDoNothing();
    }
    const scope =
      roleId === null
        ? "no role"
        : orgId === undefined
          ? `no role: region ${regionName} not found`
          : `${role}${regionName ? ` of ${regionName}` : ""}`;
    console.log(`  ✓ Dev user: ${devUser.email} (${scope})`);
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

export interface SeedApiKeysOptions {
  /**
   * Skip a region-scoped key whose region isn't in `regionIds` (a loaded
   * snapshot doesn't have the fake regions) instead of throwing. Returns the
   * skipped keys.
   */
  skipMissingRegions?: boolean;
}

export async function seedApiKeys(
  db: AppDb,
  adminUserId: number,
  nationId: number,
  roleIds: RoleIds,
  regionIds: Record<string, number>,
  { skipMissingRegions = false }: SeedApiKeysOptions = {},
): Promise<string[]> {
  const skipped: string[] = [];
  // 9. API keys
  for (const apiKey of LOCAL_API_KEYS) {
    // Roles attach to the nation by default; keys with a regionName are
    // region-scoped (e.g. local-boone-editor-key) so e2e tests can
    // exercise cross-region RBAC denials. Resolved before inserting so a
    // skipped key leaves no role-less key behind.
    const orgId = apiKey.regionName ? regionIds[apiKey.regionName] : nationId;
    if (orgId === undefined) {
      if (skipMissingRegions) {
        skipped.push(apiKey.key);
        continue;
      }
      throw new Error(
        `API key ${apiKey.key} references unknown region "${apiKey.regionName}"`,
      );
    }

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
      // Role-less keys (role: null) get no association; the API treats such a
      // key as no credential, so it grants nothing beyond an anonymous request.
      const roleId =
        apiKey.role === "admin"
          ? roleIds.adminId
          : apiKey.role === "editor"
            ? roleIds.editorId
            : null;
      if (roleId !== null) {
        await db
          .insert(schema.rolesXApiKeysXOrg)
          .values({ apiKeyId: keyId, roleId, orgId })
          .onConflictDoNothing();
      }
    }
    console.log(`  ✓ API key: ${apiKey.key}`);
  }
  return skipped;
}

export async function seedOAuthClients(db: AppDb): Promise<void> {
  // 10. OAuth clients
  for (const client of LOCAL_OAUTH_CLIENTS) {
    await db
      .insert(authSchema.oauthClients)
      .values(client)
      .onConflictDoUpdate({
        target: authSchema.oauthClients.id,
        set: {
          redirectUris: client.redirectUris,
          allowedOrigin: client.allowedOrigin,
        },
      });
    console.log(`  ✓ OAuth client: ${client.id}`);
  }
}
