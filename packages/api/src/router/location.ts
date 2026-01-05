import { ORPCError } from "@orpc/server";
import { z } from "zod";

import {
  aliasedTable,
  and,
  count,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  lte,
  or,
  schema,
} from "@acme/db";
import { IsActiveStatus } from "@acme/shared/app/enums";
import { arrayOrSingle, parseSorting } from "@acme/shared/app/functions";
import { LocationInsertSchema } from "@acme/validators";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { getDescendantOrgIds } from "../get-descendant-org-ids";
import { getEditableOrgIdsForUser } from "../get-editable-org-ids";
import { getSortingColumns } from "../get-sorting-columns";
import { adminProcedure, editorProcedure, protectedProcedure } from "../shared";
import { withPagination } from "../with-pagination";

export const locationRouter = {
  all: protectedProcedure
    .input(
      z
        .object({
          searchTerm: z.string().optional(),
          pageIndex: z.coerce.number().optional(),
          pageSize: z.coerce.number().optional(),
          sorting: parseSorting(),
          statuses: arrayOrSingle(z.enum(IsActiveStatus)).optional(),
          regionIds: arrayOrSingle(z.coerce.number()).optional(),
          onlyMine: z.coerce.boolean().optional(),
        })
        .optional(),
    )
    .route({
      method: "GET",
      path: "/",
      tags: ["location"],
      summary: "List all locations",
      description:
        "Get a paginated list of workout locations with optional filtering and sorting",
    })
    .handler(async ({ context: ctx, input }) => {
      const regionOrg = aliasedTable(schema.orgs, "region_org");
      const limit = input?.pageSize ?? 10;
      const offset = (input?.pageIndex ?? 0) * limit;
      const usePagination =
        input?.pageIndex !== undefined && input?.pageSize !== undefined;

      // Determine if filter by editable org IDs is needed
      let editableOrgIds: number[] = [];
      let isNationAdmin = false;

      if (input?.onlyMine) {
        const result = await getEditableOrgIdsForUser(ctx);
        const editableOrgs = result.editableOrgs;
        isNationAdmin = result.isNationAdmin;

        if (!isNationAdmin && editableOrgs.length > 0) {
          // Get all descendant org IDs (including regions) for the editable orgs
          const editableOrgIdsList = editableOrgs.map((org) => org.id);
          editableOrgIds = await getDescendantOrgIds(
            ctx.db,
            editableOrgIdsList,
          );
        }

        // If user has no editable orgs and is not a nation admin, return empty
        if (editableOrgIds.length === 0 && !isNationAdmin) {
          return { locations: [], totalCount: 0 };
        }
      }

      const where = and(
        !input?.statuses?.length ||
          input.statuses.length === IsActiveStatus.length
          ? undefined
          : input.statuses.includes("active")
            ? eq(schema.locations.isActive, true)
            : eq(schema.locations.isActive, false),
        input?.searchTerm
          ? or(
              ilike(schema.locations.name, `%${input?.searchTerm}%`),
              ilike(schema.locations.description, `%${input?.searchTerm}%`),
            )
          : undefined,
        input?.regionIds?.length
          ? inArray(schema.locations.orgId, input.regionIds)
          : undefined,
        // Filter by editable org IDs if onlyMine is true and not a nation admin
        input?.onlyMine && !isNationAdmin && editableOrgIds.length > 0
          ? inArray(schema.locations.orgId, editableOrgIds)
          : undefined,
      );

      const sortedColumns = getSortingColumns(
        input?.sorting,
        {
          id: schema.locations.id,
          name: schema.locations.name,
          regionName: regionOrg.name,
          isActive: schema.locations.isActive,
          latitude: schema.locations.latitude,
          longitude: schema.locations.longitude,
          addressStreet: schema.locations.addressStreet,
          addressStreet2: schema.locations.addressStreet2,
          addressCity: schema.locations.addressCity,
          addressState: schema.locations.addressState,
          addressZip: schema.locations.addressZip,
          addressCountry: schema.locations.addressCountry,
          created: schema.locations.created,
        },
        "id",
      );

      const select = {
        id: schema.locations.id,
        locationName: schema.locations.name,
        regionId: regionOrg.id,
        regionName: regionOrg.name,
        description: schema.locations.description,
        isActive: schema.locations.isActive,
        latitude: schema.locations.latitude,
        longitude: schema.locations.longitude,
        email: schema.locations.email,
        addressStreet: schema.locations.addressStreet,
        addressStreet2: schema.locations.addressStreet2,
        addressCity: schema.locations.addressCity,
        addressState: schema.locations.addressState,
        addressZip: schema.locations.addressZip,
        addressCountry: schema.locations.addressCountry,
        meta: schema.locations.meta,
        created: schema.locations.created,
      };

      const [locationCount] = await ctx.db
        .select({ count: count() })
        .from(schema.locations)
        .where(where);

      const query = ctx.db
        .select(select)
        .from(schema.locations)
        .leftJoin(regionOrg, eq(schema.locations.orgId, regionOrg.id))
        .where(where);

      const locations = usePagination
        ? await withPagination(query.$dynamic(), sortedColumns, offset, limit)
        : await query.orderBy(...sortedColumns);

      return { locations, totalCount: locationCount?.count ?? 0 };
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.coerce.number() }))
    .route({
      method: "GET",
      path: "/id/{id}",
      tags: ["location"],
      summary: "Get location by ID",
      description: "Retrieve detailed information about a specific location",
    })
    .handler(async ({ context: ctx, input }) => {
      const regionOrg = aliasedTable(schema.orgs, "region_org");
      const [location] = await ctx.db
        .select({
          id: schema.locations.id,
          locationName: schema.locations.name,
          description: schema.locations.description,
          isActive: schema.locations.isActive,
          created: schema.locations.created,
          orgId: schema.locations.orgId,
          regionId: regionOrg.id,
          regionName: regionOrg.name,
          email: schema.locations.email,
          latitude: schema.locations.latitude,
          longitude: schema.locations.longitude,
          addressStreet: schema.locations.addressStreet,
          addressStreet2: schema.locations.addressStreet2,
          addressCity: schema.locations.addressCity,
          addressState: schema.locations.addressState,
          addressZip: schema.locations.addressZip,
          addressCountry: schema.locations.addressCountry,
          meta: schema.locations.meta,
        })
        .from(schema.locations)
        .where(eq(schema.locations.id, input.id))
        .leftJoin(regionOrg, eq(regionOrg.id, schema.locations.orgId));

      return { location: location ?? null };
    }),
  crupdate: editorProcedure
    .input(LocationInsertSchema.partial({ id: true }))
    .route({
      method: "POST",
      path: "/",
      tags: ["location"],
      summary: "Create or update location",
      description: "Create a new location or update an existing one",
    })
    .handler(async ({ context: ctx, input }) => {
      const [existingLocation] = input.id
        ? await ctx.db
            .select()
            .from(schema.locations)
            .where(eq(schema.locations.id, input.id))
        : [];

      if (!input.orgId) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Parent ID or ID is required",
        });
      }
      const roleCheckResult = await checkHasRoleOnOrg({
        orgId: existingLocation?.orgId ?? input.orgId,
        session: ctx.session,
        db: ctx.db,
        roleName: "editor",
      });
      if (!roleCheckResult.success) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "You are not authorized to update this Location",
        });
      }
      const locationToCrupdate: typeof schema.locations.$inferInsert = {
        ...input,
        meta: {
          ...(input.meta as Record<string, string>),
        },
      };
      const [result] = await ctx.db
        .insert(schema.locations)
        .values(locationToCrupdate)
        .onConflictDoUpdate({
          target: [schema.locations.id],
          set: locationToCrupdate,
        })
        .returning();
      return { location: result ?? null };
    }),
  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .route({
      method: "DELETE",
      path: "/delete/{id}",
      tags: ["location"],
      summary: "Delete location",
      description: "Soft delete a location by marking it as inactive",
    })
    .handler(async ({ context: ctx, input }) => {
      const [location] = await ctx.db
        .select()
        .from(schema.locations)
        .where(eq(schema.locations.id, input.id));

      if (!location) {
        throw new ORPCError("NOT_FOUND", {
          message: "Location not found",
        });
      }

      const roleCheckResult = await checkHasRoleOnOrg({
        orgId: location.orgId,
        session: ctx.session,
        db: ctx.db,
        roleName: "admin",
      });
      if (!roleCheckResult.success) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "You are not authorized to delete this Location",
        });
      }
      await ctx.db
        .update(schema.locations)
        .set({ isActive: false })
        .where(
          and(
            eq(schema.locations.id, input.id),
            eq(schema.locations.isActive, true),
          ),
        );

      return { locationId: input.id };
    }),

  inBoundingBox: protectedProcedure
    .input(
      z.object({
        minLat: z.coerce.number(),
        maxLat: z.coerce.number(),
        minLng: z.coerce.number(),
        maxLng: z.coerce.number(),
        since: z.string().datetime().optional(),
        isActive: z.coerce.boolean().optional(),
      }),
    )
    .route({
      method: "GET",
      path: "/in-bounding-box",
      tags: ["location"],
      summary: "Get locations in bounding box",
      description:
        "Retrieve locations within a geographic bounding box, optionally filtered by creation date",
    })
    .handler(async ({ context: ctx, input }) => {
      const regionOrg = aliasedTable(schema.orgs, "region_org");

      const where = and(
        // Bounding box: latitude between minLat and maxLat
        gte(schema.locations.latitude, input.minLat),
        lte(schema.locations.latitude, input.maxLat),
        // Bounding box: longitude between minLng and maxLng
        gte(schema.locations.longitude, input.minLng),
        lte(schema.locations.longitude, input.maxLng),
        // Only include locations with coordinates
        isNotNull(schema.locations.latitude),
        isNotNull(schema.locations.longitude),
        // Only active locations
        input.isActive !== undefined
          ? eq(schema.locations.isActive, input.isActive)
          : undefined,
        // Optional: filter by creation date
        input.since
          ? gt(schema.locations.created, new Date(input.since).toISOString())
          : undefined,
      );

      const locations = await ctx.db
        .select({
          id: schema.locations.id,
          locationName: schema.locations.name,
          regionId: regionOrg.id,
          regionName: regionOrg.name,
          description: schema.locations.description,
          isActive: schema.locations.isActive,
          latitude: schema.locations.latitude,
          longitude: schema.locations.longitude,
          email: schema.locations.email,
          addressStreet: schema.locations.addressStreet,
          addressStreet2: schema.locations.addressStreet2,
          addressCity: schema.locations.addressCity,
          addressState: schema.locations.addressState,
          addressZip: schema.locations.addressZip,
          addressCountry: schema.locations.addressCountry,
          meta: schema.locations.meta,
          created: schema.locations.created,
        })
        .from(schema.locations)
        .leftJoin(regionOrg, eq(schema.locations.orgId, regionOrg.id))
        .where(where)
        .orderBy(schema.locations.created);

      return {
        locations,
        count: locations.length,
        boundingBox: {
          minLat: input.minLat,
          maxLat: input.maxLat,
          minLng: input.minLng,
          maxLng: input.maxLng,
        },
        since: input.since ?? null,
      };
    }),
};
