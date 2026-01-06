import { ORPCError, os } from "@orpc/server";
import omit from "lodash/omit";
import { z } from "zod";

import {
  aliasedTable,
  and,
  count,
  eq,
  isNotNull,
  or,
  schema,
  sql,
} from "@acme/db";
import { DayOfWeek } from "@acme/shared/app/enums";
import { getFullAddress } from "@acme/shared/app/functions";
import { isTruthy } from "@acme/shared/common/functions";
import type { LowBandwidthF3Marker } from "@acme/validators";

import { protectedProcedure } from "../../shared";

export const mapLocationRouter = os.router({
  eventsAndLocations: protectedProcedure
    .route({
      method: "GET",
      path: "/events-and-locations",
      tags: ["map.location"],
      summary: "Get map data",
      description:
        "Retrieve all locations and events for displaying on the map in a low-bandwidth format",
    })
    .handler(async ({ context: ctx }) => {
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
            eq(schema.events.isPrivate, false),
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
    }),
  locationWorkout: protectedProcedure
    .input(z.object({ locationId: z.coerce.number() }))
    .route({
      method: "GET",
      path: "/location-workout",
      tags: ["map.location"],
      summary: "Get location workout data",
      description:
        "Retrieve detailed workout information for a specific location",
    })
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
            eq(schema.events.isPrivate, false),
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
  regions: protectedProcedure
    .route({
      method: "GET",
      path: "/regions",
      tags: ["map.location"],
      summary: "Get all regions",
      description: "Retrieve a list of all F3 regions",
    })
    .handler(async ({ context: ctx }) => {
      const regions = await ctx.db
        .select()
        .from(schema.orgs)
        .where(eq(schema.orgs.orgType, "region"));
      return {
        regions: regions.map((region) => ({
          id: region.id,
          name: region.name,
          logo: region.logoUrl,
          website: region.website,
        })),
      };
    }),
  regionsWithLocation: protectedProcedure
    .route({
      method: "GET",
      path: "/regions-with-location",
      tags: ["map.location"],
      summary: "Get regions with coordinates",
      description:
        "Retrieve all regions that have associated location coordinates",
    })
    .handler(async ({ context: ctx }) => {
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
      return { regionsWithLocation: uniqueRegionsWithLocation };
    }),
  workoutCount: protectedProcedure
    .route({
      method: "GET",
      path: "/workout-count",
      tags: ["map.location"],
      summary: "Get workout count",
      description:
        "Get the total count of active workouts across all locations",
    })
    .handler(async ({ context: ctx }) => {
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
  regionCount: protectedProcedure
    .route({
      method: "GET",
      path: "/region-count",
      tags: ["map.location"],
      summary: "Get region count",
      description: "Get the total count of active F3 regions",
    })
    .handler(async ({ context: ctx }) => {
      const regionOrg = aliasedTable(schema.orgs, "region_org");
      const [result] = await ctx.db
        .select({ count: count() })
        .from(regionOrg)
        .where(
          and(eq(regionOrg.isActive, true), eq(regionOrg.orgType, "region")),
        );

      return { count: result?.count };
    }),
  locationIdToRegionNameLookup: protectedProcedure
    .route({
      method: "GET",
      path: "/location-id-to-region-name-lookup",
      tags: ["map"],
      summary: "Location to region lookup",
      description: "Get a mapping of location IDs to their region names",
    })
    .handler(async ({ context: ctx }) => {
      const regionOrg = aliasedTable(schema.orgs, "region_org");
      const parentOrg = aliasedTable(schema.orgs, "parent_org");
      const result = await ctx.db
        .select({
          locationId: schema.locations.id,
          regionName: regionOrg.name,
        })
        .from(schema.locations)
        .leftJoin(parentOrg, eq(schema.locations.orgId, parentOrg.id))
        .leftJoin(
          regionOrg,
          or(
            and(
              eq(schema.locations.orgId, regionOrg.id),
              eq(regionOrg.orgType, "region"),
            ),
            and(
              eq(parentOrg.orgType, "ao"),
              eq(parentOrg.parentId, regionOrg.id),
              eq(regionOrg.orgType, "region"),
            ),
          ),
        )
        .groupBy(schema.locations.id, regionOrg.id);

      const lookup = result.reduce(
        (acc, curr) => {
          if (curr.regionName) {
            acc[curr.locationId] = curr.regionName;
          }
          return acc;
        },
        {} as Record<number, string>,
      );

      return { lookup };
    }),
});
