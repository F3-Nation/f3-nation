import { ORPCError } from "@orpc/server";
import omit from "lodash/omit";
import { z } from "zod";

import type { LowBandwidthF3Marker } from "@acme/validators";
import {
  aliasedTable,
  and,
  count,
  eq,
  ilike,
  inArray,
  isNotNull,
  or,
  schema,
  sql,
} from "@acme/db";
import { DayOfWeek, IsActiveStatus } from "@acme/shared/app/enums";
import { getFullAddress } from "@acme/shared/app/functions";
import { isTruthy } from "@acme/shared/common/functions";
import { LocationInsertSchema, SortingSchema } from "@acme/validators";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { getSortingColumns } from "../get-sorting-columns";
import { adminProcedure, editorProcedure, publicProcedure } from "../shared";
import { withPagination } from "../with-pagination";

export const locationRouter = {
  all: publicProcedure
    .input(
      z
        .object({
          searchTerm: z.string().optional(),
          pageIndex: z.number().optional(),
          pageSize: z.number().optional(),
          sorting: SortingSchema.optional(),
          statuses: z.enum(IsActiveStatus).array().optional(),
          regionIds: z.number().array().optional(),
        })
        .optional(),
    )
    .route({ method: "GET", path: "/locations/all" })
    .handler(async ({ context: ctx, input }) => {
      const regionOrg = aliasedTable(schema.orgs, "region_org");
      const limit = input?.pageSize ?? 10;
      const offset = (input?.pageIndex ?? 0) * limit;
      const usePagination =
        input?.pageIndex !== undefined && input?.pageSize !== undefined;
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
        : await query;

      return { locations, totalCount: locationCount?.count ?? 0 };
    }),
  getMapEventAndLocationData: publicProcedure.handler(
    async ({ context: ctx }) => {
      const aoOrg = aliasedTable(schema.orgs, "ao_org");
      const locationsAndEvents = await ctx.db
        .select({
          locations: {
            id: schema.locations.id,
            name: aoOrg.name,
            logo: aoOrg.logoUrl,
            lat: schema.locations.latitude,
            lon: schema.locations.longitude,
            locationAddress: schema.locations.addressStreet,
            locationAddress2: schema.locations.addressStreet2,
            locationCity: schema.locations.addressCity,
            locationState: schema.locations.addressState,
            locationCountry: schema.locations.addressCountry,
          },
          events: {
            id: schema.events.id,
            locationId: schema.events.locationId,
            dayOfWeek: schema.events.dayOfWeek,
            startTime: schema.events.startTime,
            endTime: schema.events.endTime,
            name: schema.events.name,
            eventTypes: sql<{ id: number; name: string }[]>`COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'id', ${schema.eventTypes.id},
                'name', ${schema.eventTypes.name}
              )
            )
            FILTER (
              WHERE ${schema.eventTypes.id} IS NOT NULL
            ),
            '[]'
          )`,
          },
        })
        .from(schema.locations)
        .leftJoin(
          schema.events,
          and(
            eq(schema.events.locationId, schema.locations.id),
            eq(schema.events.isActive, true),
          ),
        )
        .leftJoin(aoOrg, eq(schema.events.orgId, aoOrg.id))
        .leftJoin(
          schema.eventsXEventTypes,
          eq(schema.eventsXEventTypes.eventId, schema.events.id),
        )
        .leftJoin(
          schema.eventTypes,
          eq(schema.eventTypes.id, schema.eventsXEventTypes.eventTypeId),
        )
        .groupBy(
          schema.locations.id,
          aoOrg.name,
          aoOrg.logoUrl,
          schema.events.id,
        );

      // Reduce the results into the expected format
      const locationEvents = locationsAndEvents.reduce(
        (acc, item) => {
          const location = item.locations;
          const event = item.events;

          if (
            !acc[location.id] &&
            location.lat != null &&
            location.lon != null
          ) {
            acc[location.id] = {
              ...location,
              name: location.name ?? "",
              fullAddress: getFullAddress(location),
              lat: location.lat,
              lon: location.lon,
              events: [],
            };
          }

          if (event?.id != undefined) {
            acc[location.id]?.events.push(omit(event, "locationId"));
          }

          return acc;
        },
        {} as Record<
          number,
          {
            id: number;
            name: string;
            logo: string | null;
            lat: number;
            lon: number;
            fullAddress: string | null;
            events: Omit<
              NonNullable<(typeof locationsAndEvents)[number]["events"]>,
              "locationId"
            >[];
          }
        >,
      );

      const lowBandwidthLocationEvents: LowBandwidthF3Marker[] = Object.values(
        locationEvents,
      ).map((locationEvent) => [
        locationEvent.id,
        locationEvent.name,
        locationEvent.logo,
        locationEvent.lat,
        locationEvent.lon,
        locationEvent.fullAddress,
        locationEvent.events
          .sort(
            (a, b) =>
              DayOfWeek.indexOf(a.dayOfWeek ?? "sunday") -
              DayOfWeek.indexOf(b.dayOfWeek ?? "sunday"),
          )
          .map((event) => [
            event.id,
            event.name,
            event.dayOfWeek,
            event.startTime,
            event.eventTypes,
          ]),
      ]);

      return lowBandwidthLocationEvents;
    },
  ),
  getLocationWorkoutData: publicProcedure
    .input(z.object({ locationId: z.number() }))
    .handler(async ({ context: ctx, input }) => {
      const parentOrg = aliasedTable(schema.orgs, "parent_org");
      const regionOrg = aliasedTable(schema.orgs, "region_org");

      const results = await ctx.db
        .select({
          location: {
            id: schema.locations.id,
            name: schema.locations.name,
            description: schema.locations.description,
            lat: schema.locations.latitude,
            lon: schema.locations.longitude,
            orgId: schema.locations.orgId,
            locationName: schema.locations.name,
            locationMeta: schema.locations.meta,
            locationAddress: schema.locations.addressStreet,
            locationAddress2: schema.locations.addressStreet2,
            locationCity: schema.locations.addressCity,
            locationState: schema.locations.addressState,
            locationZip: schema.locations.addressZip,
            locationCountry: schema.locations.addressCountry,
            isActive: schema.locations.isActive,
            created: schema.locations.created,
            updated: schema.locations.updated,
            locationDescription: schema.locations.description,
            parentId: parentOrg.id,
            parentLogo: parentOrg.logoUrl,
            parentName: parentOrg.name,
            parentWebsite: parentOrg.website,
            regionId: regionOrg.id,
            regionName: regionOrg.name,
            regionLogo: regionOrg.logoUrl,
            regionWebsite: regionOrg.website,
            regionType: regionOrg.orgType,
          },
          event: {
            id: schema.events.id,
            name: schema.events.name,
            description: schema.events.description,
            dayOfWeek: schema.events.dayOfWeek,
            startTime: schema.events.startTime,
            endTime: schema.events.endTime,
            eventTypes: sql<{ id: number; name: string }[]>`COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'id', ${schema.eventTypes.id},
                'name', ${schema.eventTypes.name}
              )
            )
            FILTER (
              WHERE ${schema.eventTypes.id} IS NOT NULL
            ),
            '[]'
          )`,
            aoId: parentOrg.id,
            aoLogo: parentOrg.logoUrl,
            aoWebsite: parentOrg.website,
            aoName: parentOrg.name,
          },
        })
        .from(schema.locations)
        .innerJoin(
          schema.events,
          and(
            eq(schema.locations.id, schema.events.locationId),
            eq(schema.events.isActive, true),
          ),
        )
        .leftJoin(parentOrg, eq(schema.events.orgId, parentOrg.id))
        .leftJoin(
          regionOrg,
          or(
            and(
              eq(schema.events.orgId, regionOrg.id),
              eq(regionOrg.orgType, "region"),
            ),
            and(
              eq(parentOrg.orgType, "ao"),
              eq(parentOrg.parentId, regionOrg.id),
              eq(regionOrg.orgType, "region"),
            ),
          ),
        )
        .leftJoin(
          schema.eventsXEventTypes,
          eq(schema.eventsXEventTypes.eventId, schema.events.id),
        )
        .leftJoin(
          schema.eventTypes,
          and(
            eq(schema.eventTypes.id, schema.eventsXEventTypes.eventTypeId),
            eq(schema.eventTypes.isActive, true),
          ),
        )
        .where(
          and(
            eq(schema.locations.id, input.locationId),
            eq(schema.events.isActive, true),
          ),
        )
        .groupBy(
          schema.locations.id,
          schema.events.id,
          parentOrg.id,
          regionOrg.id,
        );

      const location = results[0]?.location;
      const events = results.map((r) => r.event);

      if (location?.lat == null || location?.lon == null) {
        throw new ORPCError("NOT_FOUND", {
          message: `Lat lng not found for location id: ${input.locationId}`,
        });
      }

      const locationWithEvents = {
        ...location,
        // Need to handle empty string values for parent and region logos
        parentLogo: !location.parentLogo ? null : location.parentLogo,
        regionLogo: !location.regionLogo ? null : location.regionLogo,
        lat: location.lat,
        lon: location.lon,
        fullAddress: getFullAddress(location),
        events: events.sort(
          (a, b) =>
            DayOfWeek.indexOf(a.dayOfWeek ?? "sunday") -
            DayOfWeek.indexOf(b.dayOfWeek ?? "sunday"),
        ),
      };

      return { location: locationWithEvents };
    }),
  getRegions: publicProcedure.handler(async ({ context: ctx }) => {
    const regions = await ctx.db
      .select()
      .from(schema.orgs)
      .where(eq(schema.orgs.orgType, "region"));
    return regions.map((region) => ({
      id: region.id,
      name: region.name,
      logo: region.logoUrl,
      website: region.website,
    }));
  }),
  getRegionsWithLocation: publicProcedure.handler(async ({ context: ctx }) => {
    const ao = aliasedTable(schema.orgs, "ao");
    const region = aliasedTable(schema.orgs, "region");
    const regionsWithLocation = await ctx.db
      .select({
        id: region.id,
        name: region.name,
        locationId: schema.locations.id,
        lat: schema.locations.latitude,
        lon: schema.locations.longitude,
        logo: ao.logoUrl,
      })
      .from(region)
      .innerJoin(ao, eq(ao.parentId, region.id))
      .innerJoin(schema.locations, eq(schema.locations.orgId, region.id))
      .where(
        and(eq(schema.locations.isActive, true), eq(region.isActive, true)),
      );

    const uniqueRegionsWithLocation = regionsWithLocation
      .map((rwl) =>
        typeof rwl.lat === "number" && typeof rwl.lon === "number"
          ? {
              ...rwl,
              lat: rwl.lat,
              lon: rwl.lon,
            }
          : null,
      )
      .filter(isTruthy)
      .filter(
        (region, index, self) =>
          index ===
          self.findIndex((t) => t.id === region.id && t.name === region.name),
      );
    return uniqueRegionsWithLocation;
  }),
  getWorkoutCount: publicProcedure.handler(async ({ context: ctx }) => {
    const [result] = await ctx.db
      .select({ count: count() })
      .from(schema.events)
      .where(
        and(
          isNotNull(schema.events.locationId),
          eq(schema.events.isActive, true),
        ),
      );

    return { count: result?.count };
  }),
  getRegionCount: publicProcedure.handler(async ({ context: ctx }) => {
    const regionOrg = aliasedTable(schema.orgs, "region_org");
    const [result] = await ctx.db
      .select({ count: count() })
      .from(regionOrg)
      .where(
        and(eq(regionOrg.isActive, true), eq(regionOrg.orgType, "region")),
      );

    return { count: result?.count };
  }),
  byId: publicProcedure
    .input(z.object({ id: z.number() }))
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

      return location;
    }),
  crupdate: editorProcedure
    .input(LocationInsertSchema.partial({ id: true }))
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
      return result;
    }),
  delete: adminProcedure
    .input(z.object({ id: z.number() }))
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
};
