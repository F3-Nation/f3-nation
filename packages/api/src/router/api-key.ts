import { randomBytes } from "crypto";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { and, desc, eq, gt, inArray, isNull, or, schema, sql } from "@acme/db";

import { adminProcedure } from "../shared";

const createApiKeySchema = z.object({
  name: z.string().min(1, { message: "Name is required" }),
  description: z.string().optional(),
  ownerId: z.number().optional(),
  ownerEmail: z.string().email().optional(),
  roles: z
    .object({
      orgId: z.number(),
      roleName: z.enum(["editor", "admin"]),
    })
    .array()
    .optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const revokeApiKeySchema = z.object({
  id: z.number(),
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
      description: "List all API keys",
    })
    .handler(async ({ context: ctx }) => {
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

      return keyQuery.map((key) => {
        const roles = rolesByApiKeyId.get(key.id) ?? [];
        return {
          ...key,
          keySignature: key.key.slice(-4),
          roles: roles.map((r) => ({
            orgId: r.orgId,
            orgName: r.orgName,
            roleName: r.roleName as "editor" | "admin",
          })),
          orgIds: roles.map((r) => r.orgId),
          orgNames: roles.map((r) => r.orgName),
        };
      });
    }),
  create: adminProcedure
    .input(createApiKeySchema)
    .route({
      method: "POST",
      path: "/",
      tags: ["api-key"],
      summary: "Create API key",
      description: "Generate a new API key for programmatic access",
    })
    .handler(async ({ context: ctx, input }) => {
      const roles = input.roles ?? [];
      const expiresAt = input.expiresAt ?? null;

      for (let attempt = 0; attempt < 5; attempt++) {
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
            continue;
          }
          throw error;
        }
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
      description: "Revoke or restore an API key",
    })
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

      return apiKey;
    }),
  purge: adminProcedure
    .input(z.object({ id: z.number() }))
    .route({
      method: "DELETE",
      path: "/{id}/purge",
      tags: ["api-key"],
      summary: "Purge API key",
      description: "Permanently delete an API key",
    })
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

      return apiKey;
    }),
  validate: adminProcedure
    .input(z.object({ key: z.string() }))
    .route({
      method: "POST",
      path: "/{key}/validate",
      tags: ["api-key"],
      summary: "Validate API key",
      description: "Check if an API key is valid and not expired or revoked",
    })
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
