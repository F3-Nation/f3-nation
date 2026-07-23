import {
  db,
  getOrCreateF3NationOrg,
  getOrCreateRoles,
  uniqueId,
} from "@acme/api/testing";
import { eq, schema } from "@acme/db";

import type { FixtureRole } from "./users";
import { createFixtureUser } from "./users";

export interface FixtureApiKey {
  key: string;
  apiKeyId: number;
  ownerId: number;
  orgId: number;
  cleanup: () => Promise<void>;
}

export interface CreateApiKeyOptions {
  roles?: FixtureRole[];
  revoked?: boolean;
  /** Timestamp columns are `mode: "string"` — pass an ISO string, not a Date. */
  expiresAt?: string | null;
}

/**
 * Insert a real api_keys row (plus any roles_x_api_keys_x_org rows) and return
 * the created ids so golden scrubbing can substitute them by exact value.
 */
export async function createApiKey(
  opts: CreateApiKeyOptions = {},
): Promise<FixtureApiKey> {
  await getOrCreateRoles();
  const nationOrg = await getOrCreateF3NationOrg();
  const key = `char-key-${uniqueId()}`;

  // Unwind the owner, the key, and any role links if a later insert throws, so a
  // failed fixture never leaks rows into count/list goldens recorded later in
  // the (serialized) run.
  const undo: (() => Promise<void>)[] = [];
  try {
    const owner = await createFixtureUser();
    undo.push(() => owner.cleanup());

    const [apiKey] = await db
      .insert(schema.apiKeys)
      .values({
        key,
        name: `characterization ${key}`,
        ownerId: owner.userId,
        revokedAt: opts.revoked ? new Date().toISOString() : null,
        expiresAt: opts.expiresAt ?? null,
      })
      .returning({ id: schema.apiKeys.id });
    if (!apiKey) throw new Error("failed to insert fixture api key");
    undo.push(async () => {
      await db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, apiKey.id));
    });

    for (const role of opts.roles ?? []) {
      const orgId = role.orgId ?? nationOrg.id;
      const [roleRow] = await db
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .where(eq(schema.roles.name, role.roleName))
        .limit(1);
      if (!roleRow) throw new Error(`role ${role.roleName} is missing`);

      await db
        .insert(schema.rolesXApiKeysXOrg)
        .values({ roleId: roleRow.id, apiKeyId: apiKey.id, orgId });
      undo.push(async () => {
        await db
          .delete(schema.rolesXApiKeysXOrg)
          .where(eq(schema.rolesXApiKeysXOrg.apiKeyId, apiKey.id));
      });
    }

    return {
      key,
      apiKeyId: apiKey.id,
      ownerId: owner.userId,
      orgId: nationOrg.id,
      cleanup: async () => {
        await db
          .delete(schema.rolesXApiKeysXOrg)
          .where(eq(schema.rolesXApiKeysXOrg.apiKeyId, apiKey.id));
        await db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, apiKey.id));
        await owner.cleanup();
      },
    };
  } catch (err) {
    for (const fn of undo.reverse()) await fn().catch(() => undefined);
    throw err;
  }
}
