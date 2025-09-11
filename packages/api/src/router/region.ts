import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { aliasedTable, and, eq, schema } from "@acme/db";
import { RegionInsertSchema } from "@acme/validators";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { adminProcedure, createTRPCRouter, editorProcedure } from "../trpc";

export const regionRouter = createTRPCRouter({
  all: editorProcedure.query(async ({ ctx }) => {
    const regionOrg = aliasedTable(schema.orgs, "region_org");
    const sectorOrg = aliasedTable(schema.orgs, "sector_org");

    const regions = await ctx.db
      .select({
        id: regionOrg.id,
        parentId: regionOrg.parentId,
        name: regionOrg.name,
        orgType: regionOrg.orgType,
        defaultLocationId: regionOrg.defaultLocationId,
        description: regionOrg.description,
        isActive: regionOrg.isActive,
        logoUrl: regionOrg.logoUrl,
        website: regionOrg.website,
        email: regionOrg.email,
        twitter: regionOrg.twitter,
        facebook: regionOrg.facebook,
        instagram: regionOrg.instagram,
        lastAnnualReview: regionOrg.lastAnnualReview,
        meta: regionOrg.meta,
        created: regionOrg.created,
        area: schema.orgs.name,
        sector: sectorOrg.name,
      })
      .from(regionOrg)
      .innerJoin(schema.orgs, eq(regionOrg.parentId, schema.orgs.id))
      .innerJoin(sectorOrg, eq(schema.orgs.parentId, sectorOrg.id))
      .where(
        and(eq(regionOrg.orgType, "region"), eq(regionOrg.isActive, true)),
      );

    return regions;
  }),
  byId: editorProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const [region] = await ctx.db
        .select()
        .from(schema.orgs)
        .where(
          and(eq(schema.orgs.id, input.id), eq(schema.orgs.orgType, "region")),
        );
      return { ...region };
    }),
  crupdate: editorProcedure
    .input(RegionInsertSchema.partial({ id: true }))
    .mutation(async ({ ctx, input }) => {
      const [existingRegion] = input.id
        ? await ctx.db
            .select()
            .from(schema.orgs)
            .where(eq(schema.orgs.id, input.id))
        : [];

      const orgIdToCheck = existingRegion?.id ?? input.parentId;
      if (!orgIdToCheck) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Parent ID or ID is required",
        });
      }
      const roleCheckResult = await checkHasRoleOnOrg({
        orgId: existingRegion?.id ?? orgIdToCheck,
        session: ctx.session,
        db: ctx.db,
        roleName: "editor",
      });
      if (!roleCheckResult.success) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to update this Region",
        });
      }
      const regionToCrupdate: typeof schema.orgs.$inferInsert = {
        ...input,
        orgType: "region",
        meta: {
          ...(input.meta as Record<string, string>),
        },
      };
      const [result] = await ctx.db
        .insert(schema.orgs)
        .values(regionToCrupdate)
        .onConflictDoUpdate({
          target: [schema.orgs.id],
          set: regionToCrupdate,
        })
        .returning();
      return result;
    }),
  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const roleCheckResult = await checkHasRoleOnOrg({
        orgId: input.id,
        session: ctx.session,
        db: ctx.db,
        roleName: "admin",
      });
      if (!roleCheckResult.success) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to delete this Region",
        });
      }
      await ctx.db
        .update(schema.orgs)
        .set({ isActive: false })
        .where(eq(schema.orgs.id, input.id));
    }),
});
