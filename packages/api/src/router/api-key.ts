import { ORPCError } from "@orpc/server";
import { randomBytes } from "crypto";
import { z } from "zod";

import { and, desc, eq, gt, inArray, isNull, or, schema, sql } from "@acme/db";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { getEditableOrgIdsForUser } from "../get-editable-org-ids";
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

export const apiKeyRouter = {
  list: adminProcedure
    .route({
      method: "GET",
      path: "/",
      tags: ["api-key"],
      summary: "List API keys",
      description:
        "Retrieve all API keys with their metadata, owner information, role assignments, and status. Requires admin role for any organization.",
    })
    .output(
      z.object({
        apiKeys: z
          .array(
            z.object({
              id: z.number().describe("API key ID"),
              name: z.string().describe("API key name"),
              description: z
                .string()
                .nullable()
                .describe("API key description"),
              ownerId: z.number().nullable().describe("Owner user ID"),
              revokedAt: z
                .string()
                .nullable()
                .describe("Date the API key was revoked"),
              lastUsedAt: z
                .string()
                .nullable()
                .describe("Date the API key was last used"),
              expiresAt: z
                .string()
                .nullable()
                .describe("Date the API key expires"),
              created: z.string().describe("Date the API key was created"),
              updated: z.string().describe("Date the API key was last updated"),
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
            }),
          )
          .describe("List of API keys"),
      }),
    )
    .handler(async ({ context: ctx }) => {
      // Check if user is a nation admin (for email visibility)
      const { isNationAdmin } = await getEditableOrgIdsForUser(ctx);

      const keyQuery = await ctx.db
        .select({
          id: schema.apiKeys.id,
          key: schema.apiKeys.key,
          name: schema.apiKeys.name,
          description: schema.apiKeys.description,
          ownerId: schema.apiKeys.ownerId,
          revokedAt: schema.apiKeys.revokedAt,
          lastUsedAt: schema.apiKeys.lastUsedAt,
          expiresAt: schema.apiKeys.expiresAt,
          created: schema.apiKeys.created,
          updated: schema.apiKeys.updated,
          ownerName: schema.users.f3Name,
          ownerEmail: schema.users.email,
        })
        .from(schema.apiKeys)
        .leftJoin(schema.users, eq(schema.users.id, schema.apiKeys.ownerId))
        .orderBy(desc(schema.apiKeys.created));

      // Get all role-org associations for all API keys
      const apiKeyIds = keyQuery.map((key) => key.id);
      const roleAssociations =
        apiKeyIds.length > 0
          ? await ctx.db
              .select({
                apiKeyId: schema.rolesXApiKeysXOrg.apiKeyId,
                orgId: schema.orgs.id,
                orgName: schema.orgs.name,
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
              .where(
                and(
                  inArray(schema.rolesXApiKeysXOrg.apiKeyId, apiKeyIds),
                  eq(schema.orgs.isActive, true),
                ),
              )
          : [];

      // Group roles by API key ID
      const rolesByApiKeyId = new Map<
        number,
        { orgId: number; orgName: string; roleName: string }[]
      >();
      for (const assoc of roleAssociations) {
        if (!rolesByApiKeyId.has(assoc.apiKeyId)) {
          rolesByApiKeyId.set(assoc.apiKeyId, []);
        }
        rolesByApiKeyId.get(assoc.apiKeyId)?.push({
          orgId: assoc.orgId,
          orgName: assoc.orgName,
          roleName: assoc.roleName,
        });
      }

      return {
        apiKeys: keyQuery.map((key) => {
          const roles = rolesByApiKeyId.get(key.id) ?? [];
          return {
            id: key.id,
            name: key.name,
            description: key.description,
            ownerId: key.ownerId,
            revokedAt: key.revokedAt,
            lastUsedAt: key.lastUsedAt,
            expiresAt: key.expiresAt,
            created: key.created,
            updated: key.updated,
            ownerName: key.ownerName,
            // Only include email if user is a nation admin
            ownerEmail: isNationAdmin ? key.ownerEmail : null,
            keySignature: key.key.slice(-4),
            roles: roles.map((r) => ({
              orgId: r.orgId,
              orgName: r.orgName,
              roleName: r.roleName as "editor" | "admin",
            })),
            orgIds: roles.map((r) => r.orgId),
            orgNames: roles.map((r) => r.orgName),
          };
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

        if (apiKey && roles.length > 0) {
          // Get role IDs for all unique role names
          const roleNames = [...new Set(roles.map((r) => r.roleName))];
          const roleRecords = await ctx.db
            .select({ id: schema.roles.id, name: schema.roles.name })
            .from(schema.roles)
            .where(inArray(schema.roles.name, roleNames));

          const roleMap = new Map(roleRecords.map((r) => [r.name, r.id]));

          // Verify all roles exist
          for (const roleName of roleNames) {
            if (!roleMap.has(roleName)) {
              throw new Error(`Role "${roleName}" not found`);
            }
          }

          // Insert org associations with roles
          await ctx.db.insert(schema.rolesXApiKeysXOrg).values(
            roles.map((role) => {
              const roleId = roleMap.get(role.roleName);
              if (!roleId) {
                throw new Error(`Role "${role.roleName}" not found`);
              }
              return {
                roleId,
                apiKeyId: apiKey.id,
                orgId: role.orgId,
              };
            }),
          );
        }

        if (apiKey) {
          return { ...apiKey, secret: generatedKey };
        }
      } catch (error) {
        if (isUniqueError(error)) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Unable to generate unique API key. Please try again.",
          });
        }
        throw error;
      }

      throw new Error("Unable to generate unique API key");
    }),
  revoke: adminProcedure
    .input(revokeApiKeySchema)
    .route({
      method: "POST",
      path: "/{id}/revoke",
      tags: ["api-key"],
      summary: "Revoke API key",
      description:
        "Revoke an API key to prevent further use, or restore a previously revoked key. Revoked keys cannot be used to authenticate API requests.",
    })
    .output(
      z.object({
        apiKey: z
          .object({
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
            expiresAt: z
              .string()
              .nullable()
              .describe("Date the API key expires"),
            created: z.string().describe("Date the API key was created"),
            updated: z.string().describe("Date the API key was last updated"),
          })
          .nullable()
          .describe("API key"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
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
        .returning();

      if (!apiKey) {
        throw new ORPCError("NOT_FOUND");
      }

      return { apiKey: apiKey ?? null };
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
        "Permanently delete an API key and all associated role assignments. This action cannot be undone.",
    })
    .output(
      z.object({
        apiKey: z
          .object({
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
            expiresAt: z
              .string()
              .nullable()
              .describe("Date the API key expires"),
            created: z.string().describe("Date the API key was created"),
            updated: z.string().describe("Date the API key was last updated"),
          })
          .nullable()
          .describe("API key"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      // Delete org associations first (cascade should handle this, but being explicit)
      await ctx.db
        .delete(schema.rolesXApiKeysXOrg)
        .where(eq(schema.rolesXApiKeysXOrg.apiKeyId, input.id));

      const [apiKey] = await ctx.db
        .delete(schema.apiKeys)
        .where(eq(schema.apiKeys.id, input.id))
        .returning();

      if (!apiKey) {
        throw new ORPCError("NOT_FOUND");
      }

      return { apiKey: apiKey ?? null };
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
