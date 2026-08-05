import { os } from "@orpc/server";
import omit from "lodash/omit";
import { z } from "zod";

import {
  aliasedTable,
  and,
  count,
  eq,
  isNotNull,
  isNull,
  ne,
  or,
  schema,
  sql,
} from "@acme/db";
import { DayOfWeek, SeriesException } from "@acme/shared/app/enums";
import { getFullAddress } from "@acme/shared/app/functions";
import { isTruthy } from "@acme/shared/common/functions";
import type { LowBandwidthF3Marker } from "@acme/validators";
import { LowBandwidthF3Marker as LowBandwidthF3MarkerSchema } from "@acme/validators";

import { protectedProcedure } from "../../shared";

export const mapLocationRouter = os.router({
  eventsAndLocations: protectedProcedure
    .route({
      method: "GET",
      path: "/events-and-locations",
      tags: ["map.location"],
      summary: "Get map data",
      description:
        "Retrieve all locations and events for displaying on the map. Returns data in a low-bandwidth array format optimized for client-side rendering. Includes only active, non-private events.",
    })
    .output(
      z
        .array(LowBandwidthF3MarkerSchema)
        .describe("Low-bandwidth array of events and locations"),
    )
    .handler(async ({ context: ctx }) => {
      const aoOrg = aliasedTable(schema.orgs, "ao_org");
      const regionOrg = aliasedTable(schema.orgs, "region_org");
      const locationsAndEvents = await ctx.db
        .select({
          locations: {
            id: schema.locations.id,
            name: aoOrg.name,
            logo: sql<
              string | null
            >`COALESCE(NULLIF(${aoOrg.logoUrl}, ''), NULLIF(${regionOrg.logoUrl}, ''))`,
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
            startDate: schema.events.startDate,
            endDate: schema.events.endDate,
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
        // INNER JOIN ensures only locations with at least one active,
        // non-private event are returned (no orphaned pins on the map).
        .innerJoin(
          schema.events,
          and(
            eq(schema.events.locationId, schema.locations.id),
            eq(schema.events.isActive, true),
            eq(schema.events.isPrivate, false),
          ),
        )
        .leftJoin(aoOrg, eq(schema.events.orgId, aoOrg.id))
        .leftJoin(
          regionOrg,
          and(
            eq(regionOrg.id, aoOrg.parentId),
            eq(regionOrg.orgType, "region"),
          ),
        )
        .leftJoin(
          schema.eventsXEventTypes,
          eq(schema.eventsXEventTypes.eventId, schema.events.id),
        )
        .leftJoin(
          schema.eventTypes,
          eq(schema.eventTypes.id, schema.eventsXEventTypes.eventTypeId),
        )
        .where(eq(schema.locations.isActive, true))
        .groupBy(
          schema.locations.id,
          aoOrg.name,
          aoOrg.logoUrl,
          regionOrg.logoUrl,
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
            acc[location.id]?.events.push({
              ...omit(event, "locationId"),
              aoName: location.name ?? null,
              aoLogo: location.logo,
            });
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
            events: (Omit<
              NonNullable<(typeof locationsAndEvents)[number]["events"]>,
              "locationId"
            > & {
              aoName: string | null;
              aoLogo: string | null;
            })[];
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
            event.aoName,
            event.aoLogo,
            event.startDate,
            event.endDate ?? null,
          ]),
      ]);

      return lowBandwidthLocationEvents;
    }),
  upcomingInstances: protectedProcedure
    .route({
      method: "GET",
      path: "/upcoming-instances",
      tags: ["map.location"],
      summary: "Get upcoming event instance exceptions and one-off events",
      description:
        "Returns event instances in the next 30 days that have a series exception (closed, different-time, miscellaneous), are standalone one-off events (no seriesId), or belong to a series but sit at a different location than their parent event (including a parent with no fixed location). Used for map pin status flagging.",
    })
    .output(
      z
        .array(
          z.object({
            id: z.number().describe("Event instance ID"),
            seriesId: z
              .number()
              .nullable()
              .describe("Parent series event ID, null for one-off instances"),
            locationId: z
              .number()
              .nullable()
              .describe("Location ID, null when the instance has no location"),
            startDate: z.string().describe("Instance start date (YYYY-MM-DD)"),
            startTime: z.string().nullable().describe("Instance start time"),
            endTime: z.string().nullable().describe("Instance end time"),
            seriesException: z
              .enum(SeriesException)
              .nullable()
              .describe("Series exception type, null when not an exception"),
            highlight: z
              .boolean()
              .describe("Whether the instance is highlighted"),
            name: z.string().describe("Instance name"),
            // Location and AO columns come from LEFT JOINs, so every one of
            // them is null for a locationless instance.
            lat: z.number().nullable().describe("Location latitude"),
            lon: z.number().nullable().describe("Location longitude"),
            aoName: z.string().nullable().describe("AO name"),
            aoLogo: z.string().nullable().describe("AO logo URL"),
            locationAddress: z.string().nullable().describe("Street address"),
            locationAddress2: z
              .string()
              .nullable()
              .describe("Street address line 2"),
            locationCity: z.string().nullable().describe("City"),
            locationState: z.string().nullable().describe("State"),
            locationCountry: z.string().nullable().describe("Country"),
            eventTypes: z
              .array(
                z.object({
                  id: z.number().describe("Event type ID"),
                  name: z.string().describe("Event type name"),
                }),
              )
              .describe("Event types, empty array when none are linked"),
            fullAddress: z
              .string()
              .nullable()
              .describe("Address assembled from the location columns"),
          }),
        )
        .describe("Upcoming event instances for map pin status flagging"),
    )
    .handler(async ({ context: ctx }) => {
      const aoOrg = aliasedTable(schema.orgs, "ao_org");
      const seriesEvent = aliasedTable(schema.events, "series_event");

      const instances = await ctx.db
        .select({
          id: schema.eventInstances.id,
          seriesId: schema.eventInstances.seriesId,
          locationId: schema.eventInstances.locationId,
          startDate: schema.eventInstances.startDate,
          startTime: schema.eventInstances.startTime,
          endTime: schema.eventInstances.endTime,
          seriesException: schema.eventInstances.seriesException,
          highlight: schema.eventInstances.highlight,
          name: schema.eventInstances.name,
          lat: schema.locations.latitude,
          lon: schema.locations.longitude,
          aoName: aoOrg.name,
          aoLogo: aoOrg.logoUrl,
          locationAddress: schema.locations.addressStreet,
          locationAddress2: schema.locations.addressStreet2,
          locationCity: schema.locations.addressCity,
          locationState: schema.locations.addressState,
          locationCountry: schema.locations.addressCountry,
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
        })
        .from(schema.eventInstances)
        // LEFT join so locationless exceptions (e.g. "closed") still reach the
        // client to flag their parent series. The active-location check moves to
        // the WHERE clause, applied only to rows that have a location.
        .leftJoin(
          schema.locations,
          eq(schema.eventInstances.locationId, schema.locations.id),
        )
        .leftJoin(aoOrg, eq(schema.eventInstances.orgId, aoOrg.id))
        .leftJoin(
          seriesEvent,
          eq(seriesEvent.id, schema.eventInstances.seriesId),
        )
        .leftJoin(
          schema.eventInstancesXEventTypes,
          eq(
            schema.eventInstancesXEventTypes.eventInstanceId,
            schema.eventInstances.id,
          ),
        )
        .leftJoin(
          schema.eventTypes,
          eq(
            schema.eventTypes.id,
            schema.eventInstancesXEventTypes.eventTypeId,
          ),
        )
        .where(
          and(
            eq(schema.eventInstances.isActive, true),
            eq(schema.eventInstances.isPrivate, false),
            sql`${schema.eventInstances.startDate} >= CURRENT_DATE`,
            sql`${schema.eventInstances.startDate} <= CURRENT_DATE + INTERVAL '30 days'`,
            // Locationless rows pass through (client skips markers without coords);
            // rows with a location must resolve to an active one.
            or(
              isNull(schema.eventInstances.locationId),
              eq(schema.locations.isActive, true),
            ),
            or(
              isNotNull(schema.eventInstances.seriesException),
              isNull(schema.eventInstances.seriesId),
              and(
                isNotNull(schema.eventInstances.seriesId),
                // Include a series occurrence not at its parent's location:
                // either side null, or the two differ. Both isNull arms are
                // required — `ne` yields NULL (not true) when a side is NULL,
                // which would silently drop those rows.
                or(
                  isNull(seriesEvent.locationId),
                  isNull(schema.eventInstances.locationId),
                  ne(schema.eventInstances.locationId, seriesEvent.locationId),
                ),
              ),
            ),
          ),
        )
        .groupBy(
          schema.eventInstances.id,
          schema.locations.id,
          schema.locations.latitude,
          schema.locations.longitude,
          schema.locations.addressStreet,
          schema.locations.addressStreet2,
          schema.locations.addressCity,
          schema.locations.addressState,
          schema.locations.addressCountry,
          aoOrg.id,
          aoOrg.name,
          aoOrg.logoUrl,
        );

      return instances.map((instance) => ({
        ...instance,
        fullAddress: getFullAddress(instance),
      }));
    }),
  locationWorkout: protectedProcedure
    .input(
      z.object({
        locationId: z.coerce
          .number()
          .describe("The unique identifier of the location"),
      }),
    )
    .route({
      method: "GET",
      path: "/location-workout",
      tags: ["map.location"],
      summary: "Get location workout data",
      description:
        "Retrieve detailed workout information for a specific location, including all events, associated organizations, and metadata",
    })
    .output(
      z.object({
        location: z
          .object({
            id: z.number().describe("Location ID"),
            name: z.string().describe("Location name"),
            description: z.string().nullable().describe("Location description"),
            lat: z.number().describe("Location latitude"),
            lon: z.number().describe("Location longitude"),
            orgId: z.number().describe("Organization ID"),
            locationName: z.string().describe("Location name (alias)"),
            locationMeta: z
              .record(z.string(), z.unknown())
              .nullable()
              .describe("Location metadata"),
            locationAddress: z
              .string()
              .nullable()
              .describe("Location street address"),
            locationAddress2: z
              .string()
              .nullable()
              .describe("Location street address line 2"),
            locationCity: z.string().nullable().describe("Location city"),
            locationState: z.string().nullable().describe("Location state"),
            locationZip: z.string().nullable().describe("Location zip code"),
            locationCountry: z.string().nullable().describe("Location country"),
            isActive: z.boolean().describe("Whether the location is active"),
            created: z.string().describe("Location creation date"),
            updated: z.string().describe("Location last updated date"),
            locationDescription: z
              .string()
              .nullable()
              .describe("Location description (alias)"),
            parentId: z.number().nullable().describe("Parent AO org ID"),
            parentLogo: z.string().nullable().describe("Parent AO logo URL"),
            parentName: z.string().nullable().describe("Parent AO name"),
            parentWebsite: z.string().nullable().describe("Parent AO website"),
            parentEmail: z.string().nullable().describe("Parent AO email"),
            parentPhone: z.string().nullable().describe("Parent AO phone"),
            parentTwitter: z.string().nullable().describe("Parent AO Twitter"),
            parentFacebook: z
              .string()
              .nullable()
              .describe("Parent AO Facebook"),
            parentInstagram: z
              .string()
              .nullable()
              .describe("Parent AO Instagram"),
            regionId: z.number().nullable().describe("Region org ID"),
            regionName: z.string().nullable().describe("Region name"),
            regionLogo: z.string().nullable().describe("Region logo URL"),
            regionWebsite: z.string().nullable().describe("Region website"),
            regionEmail: z.string().nullable().describe("Region email"),
            regionPhone: z.string().nullable().describe("Region phone"),
            regionTwitter: z.string().nullable().describe("Region Twitter"),
            regionFacebook: z.string().nullable().describe("Region Facebook"),
            regionInstagram: z.string().nullable().describe("Region Instagram"),
            regionType: z.string().nullable().describe("Region org type"),
            fullAddress: z
              .string()
              .nullable()
              .describe("Full formatted address"),
            events: z
              .array(
                z.object({
                  id: z.number().describe("Event ID"),
                  name: z.string().describe("Event name"),
                  description: z
                    .string()
                    .nullable()
                    .describe("Event description"),
                  dayOfWeek: z
                    .enum(DayOfWeek)
                    .nullable()
                    .describe("Day of week"),
                  startTime: z.string().nullable().describe("Event start time"),
                  endTime: z.string().nullable().describe("Event end time"),
                  eventTypes: z
                    .array(z.object({ id: z.number(), name: z.string() }))
                    .describe("Event types"),
                  aoId: z.number().nullable().describe("AO org ID"),
                  aoLogo: z.string().nullable().describe("AO logo URL"),
                  aoWebsite: z.string().nullable().describe("AO website"),
                  aoName: z.string().nullable().describe("AO name"),
                }),
              )
              .describe("Events at this location"),
          })
          .nullable()
          .describe("Location with events"),
        message: z
          .string()
          .optional()
          .describe("Error message if location not found"),
      }),
    )
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
            parentEmail: parentOrg.email,
            parentPhone: parentOrg.phone,
            parentTwitter: parentOrg.twitter,
            parentFacebook: parentOrg.facebook,
            parentInstagram: parentOrg.instagram,
            regionId: regionOrg.id,
            regionName: regionOrg.name,
            regionLogo: regionOrg.logoUrl,
            regionWebsite: regionOrg.website,
            regionEmail: regionOrg.email,
            regionPhone: regionOrg.phone,
            regionTwitter: regionOrg.twitter,
            regionFacebook: regionOrg.facebook,
            regionInstagram: regionOrg.instagram,
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
        .leftJoin(
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
            eq(schema.locations.isActive, true),
          ),
        )
        .groupBy(
          schema.locations.id,
          schema.events.id,
          parentOrg.id,
          regionOrg.id,
        );

      const location = results[0]?.location;
      const events = results
        .map((r) => r.event)
        .filter(
          (
            e,
          ): e is NonNullable<(typeof results)[number]["event"]> & {
            id: number;
            name: string;
          } => e?.id != null && e.name != null,
        )
        .map((e) => ({ ...e, id: e.id, name: e.name }));

      // Return a message instead of throwing so the client can show a friendly
      // "deleted/unavailable" panel without crashing into an error state.
      if (location?.lat == null || location?.lon == null) {
        return {
          location: null,
          message: `Lat/lng not found for location id: ${input.locationId}`,
        };
      }

      const locationWithEvents = {
        ...location,
        // Need to handle empty string values for parent and region logos
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        parentLogo: !location.parentLogo ? null : location.parentLogo,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
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

      return { location: locationWithEvents, message: undefined };
    }),
  regions: protectedProcedure
    .route({
      method: "GET",
      path: "/regions",
      tags: ["map.location"],
      summary: "Get all regions",
      description:
        "Retrieve a list of all active F3 regions with their basic information (id, name, logo, website)",
    })
    .output(
      z.object({
        regions: z.array(
          z.object({
            id: z.number().describe("Region ID"),
            name: z.string().describe("Region name"),
            logo: z.string().nullable().describe("Region logo"),
            website: z.string().nullable().describe("Region website"),
          }),
        ),
      }),
    )
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
        "Retrieve all active regions that have associated location coordinates. Useful for displaying region centers on a map.",
    })
    .output(
      z.object({
        regionsWithLocation: z.array(
          z.object({
            id: z.number().describe("Region ID"),
            name: z.string().describe("Region name"),
            locationId: z.number().describe("Location ID"),
            lat: z.number().describe("Location latitude"),
            lon: z.number().describe("Location longitude"),
            logo: z.string().nullable().describe("AO logo URL"),
          }),
        ),
      }),
    )
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
    .output(
      z.object({
        count: z
          .number()
          .optional()
          .describe("Total number of active workouts"),
      }),
    )
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
    .output(
      z.object({
        count: z
          .number()
          .optional()
          .describe("Total number of active F3 regions"),
      }),
    )
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
  getAOsInRegion: protectedProcedure
    .input(z.object({ regionId: z.number() }))
    .output(
      z.object({
        aos: z.array(
          z.object({
            id: z.number(),
            name: z.string(),
            workouts: z.array(z.string()),
          }),
        ),
      }),
    )
    .route({
      method: "GET",
      path: "/aos-in-region",
      tags: ["map.location"],
      summary: "Get AOs in region",
      description: "Get a list of AOs in a region",
    })
    .handler(async ({ context: ctx, input }) => {
      const aos = await ctx.db
        .select({
          id: schema.orgs.id,
          name: schema.orgs.name,
          workouts: sql<string[]>`COALESCE(
            ARRAY_AGG(DISTINCT ${schema.events.name})
            FILTER (WHERE ${schema.events.name} IS NOT NULL),
            ARRAY[]::text[]
          )`,
        })
        .from(schema.orgs)
        .leftJoin(
          schema.events,
          and(
            eq(schema.events.orgId, schema.orgs.id),
            eq(schema.events.isActive, true),
          ),
        )
        .where(
          and(
            eq(schema.orgs.parentId, input.regionId),
            eq(schema.orgs.orgType, "ao"),
            eq(schema.orgs.isActive, true),
          ),
        )
        .groupBy(schema.orgs.id);
      return { aos };
    }),
});
