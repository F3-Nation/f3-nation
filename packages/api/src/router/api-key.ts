import { ORPCError } from "@orpc/server";
import { randomBytes } from "crypto";
import { z } from "zod";

import { and, desc, eq, gt, inArray, isNull, or, schema, sql } from "@acme/db";

import { isNationAdminFromSession } from "@acme/shared/app/role-checks";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { getDescendantOrgIds } from "../get-descendant-org-ids";
import { logError, logWarn } from "../logger";
import type { Context } from "../shared";
import { adminProcedure } from "../shared";

const createApiKeySchema = z.object({
  name: z.string().min(1, { error: "Name is required" }),
  description: z.string().optional(),
  ownerId: z.number().optional(),
  ownerEmail: z.email().optional(),
  roles: z
    .object({
      orgId: z.number(),
      roleName: z.enum(["editor", "admin"]),
    })
    .array()
    .optional(),
  expiresAt: z.iso.datetime().nullable().optional(),
});

const revokeApiKeySchema = z.object({
  id: z.coerce.number(),
  revoke: z.coerce.boolean().optional(),
});

const isUniqueError = (error: unknown) =>
  Boolean(
    typeof error === "object" &&
    error &&
    "code" in error &&
    (error as { code?: string }).code === "23505",
  );

const buildApiKey = () => `f3_${randomBytes(24).toString("hex")}`;

// Everything but the secret. Only `create` may return `key`.
const apiKeyMetadataColumns = {
  id: schema.apiKeys.id,
  name: schema.apiKeys.name,
  description: schema.apiKeys.description,
  ownerId: schema.apiKeys.ownerId,
  revokedAt: schema.apiKeys.revokedAt,
  lastUsedAt: schema.apiKeys.lastUsedAt,
  expiresAt: schema.apiKeys.expiresAt,
  created: schema.apiKeys.created,
  updated: schema.apiKeys.updated,
};

const apiKeyFieldsSchema = z.object({
  id: z.number().describe("API key ID"),
  name: z.string().describe("API key name"),
  description: z.string().nullable().describe("API key description"),
  ownerId: z.number().nullable().describe("Owner user ID"),
  revokedAt: z.string().nullable().describe("Date the API key was revoked"),
  lastUsedAt: z.string().nullable().describe("Date the API key was last used"),
  expiresAt: z.string().nullable().describe("Date the API key expires"),
  created: z.string().describe("Date the API key was created"),
  updated: z.string().describe("Date the API key was last updated"),
});

const apiKeyOutputSchema = apiKeyFieldsSchema.nullable().describe("API key");

interface ManageableKey {
  ownerId: number | null;
  roleOrgIds: number[];
}

/**
 * Decides which API keys the caller may see and manage. Nation admins manage
 * every key. Otherwise a key is manageable when the caller is admin on (or
 * above) every org the key holds a role on, or when it is a read-only key the
 * signed-in user owns.
 *
 * Owners always see their own keys and may revoke them, even when the key
 * holds roles beyond the owner's (after a demotion, or a grant made directly
 * in the database). Restoring or purging such a key still needs full scope:
 * restore would hand the owner back roles they no longer hold.
 *
 * Ownership never counts for API-key sessions: their `session.id` is the key
 * owner, whose rights can be wider than the key's own roles.
 */
const getApiKeyAccess = async (
  ctx: Context,
): Promise<{
  canManage: (key: ManageableKey) => boolean;
  owns: (key: ManageableKey) => boolean;
}> => {
  const session = ctx.session;
  const ownerId = session && !session.apiKey ? session.id : null;
  const owns = (key: ManageableKey) =>
    ownerId != null && key.ownerId === ownerId;

  if (isNationAdminFromSession(session)) {
    return { canManage: () => true, owns };
  }

  const adminRootOrgIds = [
    ...new Set(
      (session?.roles ?? [])
        .filter((r) => r.roleName === "admin")
        .map((r) => r.orgId),
    ),
  ];
  const adminOrgIds = new Set(
    await getDescendantOrgIds(ctx.db, adminRootOrgIds),
  );

  return {
    canManage: (key) =>
      key.roleOrgIds.length > 0
        ? key.roleOrgIds.every((orgId) => adminOrgIds.has(orgId))
        : owns(key),
    owns,
  };
};

/**
 * Out-of-scope keys are reported as NOT_FOUND so their ids can't be probed.
 * An owner who lacks full scope gets FORBIDDEN unless `ownerMayAct`.
 */
const assertCanManageKey = async (
  ctx: Context,
  apiKeyId: number,
  { ownerMayAct = false } = {},
) => {
  const [[apiKey], roles, { canManage, owns }] = await Promise.all([
    ctx.db
      .select({ ownerId: schema.apiKeys.ownerId })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, apiKeyId)),
    ctx.db
      .select({ orgId: schema.rolesXApiKeysXOrg.orgId })
      .from(schema.rolesXApiKeysXOrg)
      .where(eq(schema.rolesXApiKeysXOrg.apiKeyId, apiKeyId)),
    getApiKeyAccess(ctx),
  ]);
  if (!apiKey) throw new ORPCError("NOT_FOUND");

  const key = {
    ownerId: apiKey.ownerId,
    roleOrgIds: roles.map((r) => r.orgId),
  };
  const isOwner = owns(key);
  if (canManage(key) || (ownerMayAct && isOwner)) return;

  logWarn("api.api_key.manage_denied", {
    apiKeyId,
    userId: ctx.session?.id,
    viaApiKeyId: ctx.session?.apiKey?.id,
  });
  throw new ORPCError(isOwner ? "FORBIDDEN" : "NOT_FOUND");
};

export const apiKeyRouter = {
  list: adminProcedure
    .route({
      method: "GET",
      path: "/",
      tags: ["api-key"],
      summary: "List API keys",
      description:
        "Retrieve the API keys the caller can manage, with their metadata, owner information, role assignments, and status. Nation admins see every key; other admins see keys whose every organization they administer, plus keys they own. `canManage` is false on an owned key that holds roles beyond the caller's own; the owner may revoke it but not restore or purge it.",
    })
    .output(
      z.object({
        apiKeys: z
          .array(
            apiKeyFieldsSchema.extend({
              ownerName: z.string().nullable().describe("Owner user name"),
              ownerEmail: z.email().nullable().describe("Owner user email"),
              keySignature: z
                .string()
                .describe("Last 4 characters of the API key"),
              roles: z
                .array(
                  z.object({
                    orgId: z.number().describe("Organization ID"),
                    orgName: z.string().describe("Organization name"),
                    roleName: z.enum(["editor", "admin"]).describe("Role name"),
                  }),
                )
                .describe("Roles assigned to the API key"),
              orgIds: z.array(z.number()).describe("Organization IDs"),
              orgNames: z.array(z.string()).describe("Organization names"),
              canManage: z
                .boolean()
                .describe(
                  "Whether the caller may restore or purge this key. False means the caller only owns it and may only revoke it.",
                ),
            }),
          )
          .describe("List of API keys"),
      }),
    )
    .handler(async ({ context: ctx }) => {
      const isNationAdmin = isNationAdminFromSession(ctx.session);
      const { canManage, owns } = await getApiKeyAccess(ctx);

      const keyQuery = await ctx.db
        .select({
          ...apiKeyMetadataColumns,
          keySignature: sql<string>`right(${schema.apiKeys.key}, 4)`,
          ownerName: schema.users.f3Name,
          ownerEmail: schema.users.email,
        })
        .from(schema.apiKeys)
        .leftJoin(schema.users, eq(schema.users.id, schema.apiKeys.ownerId))
        .orderBy(desc(schema.apiKeys.created));

      const apiKeyIds = keyQuery.map((key) => key.id);
      const roleAssociations =
        apiKeyIds.length > 0
          ? await ctx.db
              .select({
                apiKeyId: schema.rolesXApiKeysXOrg.apiKeyId,
                orgId: schema.orgs.id,
                orgName: schema.orgs.name,
                isActive: schema.orgs.isActive,
                roleName: schema.roles.name,
              })
              .from(schema.rolesXApiKeysXOrg)
              .innerJoin(
                schema.orgs,
                eq(schema.orgs.id, schema.rolesXApiKeysXOrg.orgId),
              )
              .innerJoin(
                schema.roles,
                eq(schema.roles.id, schema.rolesXApiKeysXOrg.roleId),
              )
              .where(inArray(schema.rolesXApiKeysXOrg.apiKeyId, apiKeyIds))
          : [];

      const rolesByApiKeyId = new Map<number, typeof roleAssociations>();
      for (const assoc of roleAssociations) {
        if (!rolesByApiKeyId.has(assoc.apiKeyId)) {
          rolesByApiKeyId.set(assoc.apiKeyId, []);
        }
        rolesByApiKeyId.get(assoc.apiKeyId)?.push(assoc);
      }

      return {
        apiKeys: keyQuery.flatMap((key) => {
          const allRoles = rolesByApiKeyId.get(key.id) ?? [];
          const access = {
            ownerId: key.ownerId,
            roleOrgIds: allRoles.map((r) => r.orgId),
          };
          const manageable = canManage(access);
          if (!manageable && !owns(access)) {
            return [];
          }
          // Roles on inactive orgs still count toward access above; they're
          // just not displayed.
          const roles = allRoles.filter((r) => r.isActive);
          return [
            {
              ...key,
              ownerEmail: isNationAdmin ? key.ownerEmail : null,
              roles: roles.map((r) => ({
                orgId: r.orgId,
                orgName: r.orgName,
                roleName: r.roleName as "editor" | "admin",
              })),
              orgIds: roles.map((r) => r.orgId),
              orgNames: roles.map((r) => r.orgName),
              canManage: manageable,
            },
          ];
        }),
      };
    }),
  create: adminProcedure
    .input(createApiKeySchema)
    .route({
      method: "POST",
      path: "/",
      tags: ["api-key"],
      summary: "Create API key",
      description:
        "Generate a new API key for programmatic access. The key can be scoped to specific organizations with specific roles (editor or admin). Requires admin role for all assigned organizations.",
    })
    .output(
      z.object({
        id: z.number().describe("API key ID"),
        key: z.string().describe("API key value"),
        name: z.string().describe("API key name"),
        description: z.string().nullable().describe("API key description"),
        ownerId: z.number().nullable().describe("Owner user ID"),
        revokedAt: z
          .string()
          .nullable()
          .describe("Date the API key was revoked"),
        lastUsedAt: z
          .string()
          .nullable()
          .describe("Date the API key was last used"),
        expiresAt: z.string().nullable().describe("Date the API key expires"),
        created: z.string().describe("Date the API key was created"),
        updated: z.string().describe("Date the API key was last updated"),
        secret: z
          .string()
          .describe("The full API key secret (only returned on creation)"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const roles = input.roles ?? [];
      const expiresAt = input.expiresAt ?? null;

      // Check permissions for each org-role combination
      if (roles.length > 0) {
        for (const role of roles) {
          const permissionCheck = await checkHasRoleOnOrg({
            session: ctx.session,
            orgId: role.orgId,
            db: ctx.db,
            roleName: role.roleName,
          });

          if (!permissionCheck.success) {
            throw new ORPCError("FORBIDDEN", {
              message: `You do not have permission to grant "${role.roleName}" role on organization ${role.orgId}`,
            });
          }
        }

        // Callers may only create keys they can also manage.
        const { canManage } = await getApiKeyAccess(ctx);
        if (
          !canManage({
            ownerId: ctx.session?.id ?? null,
            roleOrgIds: roles.map((r) => r.orgId),
          })
        ) {
          throw new ORPCError("FORBIDDEN", {
            message:
              "You can only create API keys for organizations you administer",
          });
        }
      }

      const generatedKey = buildApiKey();
      try {
        const [apiKey] = await ctx.db
          .insert(schema.apiKeys)
          .values({
            key: generatedKey,
            name: input.name,
            description: input.description,
            ownerId: ctx.session?.id,
            expiresAt,
          })
          .returning();

        if (!apiKey) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Unable to generate unique API key",
          });
        }

        if (roles.length > 0) {
          // Get role IDs for all unique role names
          const roleNames = [...new Set(roles.map((r) => r.roleName))];
          const roleRecords = await ctx.db
            .select({ id: schema.roles.id, name: schema.roles.name })
            .from(schema.roles)
            .where(inArray(schema.roles.name, roleNames));

          const roleMap = new Map(roleRecords.map((r) => [r.name, r.id]));

          // Insert org associations with roles
          await ctx.db.insert(schema.rolesXApiKeysXOrg).values(
            roles.map((role) => {
              const roleId = roleMap.get(role.roleName);
              if (roleId == null) {
                throw new ORPCError("INTERNAL_SERVER_ERROR", {
                  message: `Role "${role.roleName}" not found`,
                });
              }
              return {
                roleId,
                apiKeyId: apiKey.id,
                orgId: role.orgId,
              };
            }),
          );
        }

        return { ...apiKey, secret: generatedKey };
      } catch (error) {
        if (isUniqueError(error)) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Unable to generate unique API key. Please try again.",
          });
        }
        // An ORPCError raised inside the try (e.g. the missing-role lookup) is
        // already typed and client-safe, so it passes through untouched.
        if (error instanceof ORPCError) throw error;
        // Anything else is an unexpected DB/driver fault. Rethrowing it raw
        // lets oRPC mask it as an opaque 500 and lose the cause, so log the
        // original and surface a generic message that leaks no internals.
        logError("api.api_key.create_failed", { name: input.name }, error);
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Unable to create API key",
        });
      }
    }),
  revoke: adminProcedure
    .input(revokeApiKeySchema)
    .route({
      method: "POST",
      path: "/{id}/revoke",
      tags: ["api-key"],
      summary: "Revoke API key",
      description:
        "Revoke an API key to prevent further use, or restore a previously revoked key. Revoked keys cannot be used to authenticate API requests. Owners may revoke their own keys; restoring is limited to keys the caller can manage.",
    })
    .output(z.object({ apiKey: apiKeyOutputSchema }))
    .handler(async ({ context: ctx, input }) => {
      // Revoking only removes access, so owners may do it on any key they own.
      await assertCanManageKey(ctx, input.id, {
        ownerMayAct: input.revoke !== false,
      });

      const timestamp =
        input.revoke === false
          ? null
          : sql`
        timezone('utc'::text, now())
      `;

      const [apiKey] = await ctx.db
        .update(schema.apiKeys)
        .set({
          revokedAt: timestamp,
          updated: sql`timezone('utc'::text, now())`,
        })
        .where(eq(schema.apiKeys.id, input.id))
        .returning(apiKeyMetadataColumns);

      if (!apiKey) {
        throw new ORPCError("NOT_FOUND");
      }

      return { apiKey };
    }),
  purge: adminProcedure
    .input(
      z.object({
        id: z.coerce.number().describe("The unique identifier of the API key"),
      }),
    )
    .route({
      method: "DELETE",
      path: "/{id}/purge",
      tags: ["api-key"],
      summary: "Purge API key",
      description:
        "Permanently delete an API key and all associated role assignments. This action cannot be undone. Limited to keys the caller can manage.",
    })
    .output(z.object({ apiKey: apiKeyOutputSchema }))
    .handler(async ({ context: ctx, input }) => {
      await assertCanManageKey(ctx, input.id);

      const [apiKey] = await ctx.db
        .delete(schema.apiKeys)
        .where(eq(schema.apiKeys.id, input.id))
        .returning(apiKeyMetadataColumns);

      if (!apiKey) {
        throw new ORPCError("NOT_FOUND");
      }

      return { apiKey };
    }),
  validate: adminProcedure
    .input(z.object({ key: z.string().describe("The API key to validate") }))
    .route({
      method: "POST",
      path: "/{key}/validate",
      tags: ["api-key"],
      summary: "Validate API key",
      description:
        "Check if an API key is valid, not revoked, and not expired. Returns true only if the key can be used for authentication.",
    })
    .output(
      z.object({
        isValid: z.boolean().describe("Whether the API key is valid"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const [apiKey] = await ctx.db
        .select({
          id: schema.apiKeys.id,
        })
        .from(schema.apiKeys)
        .where(
          and(
            eq(schema.apiKeys.key, input.key),
            isNull(schema.apiKeys.revokedAt),
            or(
              isNull(schema.apiKeys.expiresAt),
              gt(schema.apiKeys.expiresAt, sql`timezone('utc'::text, now())`),
            ),
          ),
        )
        .limit(1);

      return { isValid: Boolean(apiKey) };
    }),
};
