import { randomBytes } from "crypto";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { and, desc, eq, gt, inArray, isNull, or, schema, sql } from "@acme/db";
import { isTruthy } from "@acme/shared/common/functions";

import { adminProcedure } from "../shared";

const createApiKeySchema = z.object({
  name: z.string().min(1, { message: "Name is required" }),
  description: z.string().optional(),
  ownerId: z.number().optional(),
  ownerEmail: z.string().email().optional(),
  orgIds: z.array(z.number()).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const revokeApiKeySchema = z.object({
  id: z.number(),
  revoke: z.boolean().optional(),
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
  list: adminProcedure.handler(async ({ context: ctx }) => {
    const keyQuery = await ctx.db
      .select({
        id: schema.apiKeys.id,
        key: schema.apiKeys.key,
        name: schema.apiKeys.name,
        description: schema.apiKeys.description,
        ownerId: schema.apiKeys.ownerId,
        orgIds: schema.apiKeys.orgIds,
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

    const allOrgIds = keyQuery
      .map((key) => key.orgIds)
      .flat()
      .filter(isTruthy);

    const orgs =
      allOrgIds.length > 0
        ? await ctx.db
            .select({ name: schema.orgs.name })
            .from(schema.orgs)
            .where(
              and(
                eq(schema.orgs.isActive, true),
                inArray(schema.orgs.id, allOrgIds),
              ),
            )
        : [];

    return keyQuery.map((key) => ({
      ...key,
      keySignature: key.key.slice(-4),
      orgNames: orgs.map((org) => org.name),
    }));
  }),
  create: adminProcedure
    .input(createApiKeySchema)
    .handler(async ({ context: ctx, input }) => {
      const orgIds = input.orgIds?.length ? input.orgIds : [];
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
              orgIds,
              expiresAt,
            })
            .returning();

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
    .handler(async ({ context: ctx, input }) => {
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
