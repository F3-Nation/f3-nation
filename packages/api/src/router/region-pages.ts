import { os } from "@orpc/server";
import { z } from "zod";

import { aliasedTable, and, asc, eq, isNotNull, schema, sql } from "@acme/db";

import type { RegionPageWorkout } from "../lib/region-pages";
import type { Context } from "../shared";
import {
  dedupeWorkouts,
  regionSlug,
  toRegionPageRegion,
  toRegionPageWorkout,
  uniqueBySlug,
} from "../lib/region-pages";
import { cachedMapData } from "../lib/map-data-cache";
import { ancestorOrgsAreActive } from "../org-activity";
import { logIfOrgTreeExceedsMaxDepth } from "../org-tree";
import { publicReadProcedure } from "../shared";
import { withinCurrentEventDateWindow } from "./map/location";

const workoutSchema = z.object({
  id: z.string().describe("Event (series) ID"),
  regionId: z.string().describe("Region org ID"),
  name: z.string().describe("Workout name"),
  time: z.string().describe('Time range, e.g. "5:30 AM - 6:15 AM"'),
  type: z.string().describe("Primary event type"),
  types: z.array(z.string()).describe("All event types"),
  group: z.string().describe("Day of week (lowercase)"),
  notes: z.string().nullable().describe("Event description"),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  location: z.string().describe("Formatted street address"),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zip: z.string().nullable(),
  country: z.string().nullable(),
});

const regionSchema = z.object({
  id: z.string().describe("Region org ID"),
  name: z.string(),
  slug: z.string().describe("URL slug (kebab-case of the name)"),
  description: z.string().nullable(),
  website: z.string().nullable(),
  image: z.string().nullable().describe("Region logo URL"),
  email: z.string().nullable(),
  facebook: z.string().nullable(),
  twitter: z.string().nullable(),
  instagram: z.string().nullable(),
  city: z.string().nullable().describe("City of the most common workout zip"),
  state: z.string().nullable(),
  zip: z.string().nullable(),
  country: z.string().nullable(),
  latitude: z
    .number()
    .nullable()
    .describe("Map center latitude; null when no workout has coordinates"),
  longitude: z.number().nullable().describe("Map center longitude"),
  zoom: z.number().nullable().describe("Map zoom that frames every workout"),
  workoutCount: z.number().describe("Public workouts in the region"),
});

/** Active regions whose ancestor chain is also active, ordered by id. */
const selectActiveRegions = (db: Context["db"]) =>
  db
    .select({
      id: schema.orgs.id,
      name: schema.orgs.name,
      description: schema.orgs.description,
      website: schema.orgs.website,
      logoUrl: schema.orgs.logoUrl,
      email: schema.orgs.email,
      facebook: schema.orgs.facebook,
      twitter: schema.orgs.twitter,
      instagram: schema.orgs.instagram,
    })
    .from(schema.orgs)
    .where(
      and(
        eq(schema.orgs.orgType, "region"),
        eq(schema.orgs.isActive, true),
        ancestorOrgsAreActive(schema.orgs.id),
      ),
    )
    .orderBy(asc(schema.orgs.id));

/**
 * Public workouts: active, non-private, current series at an active location,
 * owned by an active AO directly under an active region. Same visibility rules
 * as the map's eventsAndLocations, scoped to one region when `regionId` is set.
 */
async function selectWorkouts(
  db: Context["db"],
  regionId?: number,
): Promise<RegionPageWorkout[]> {
  const aoOrg = aliasedTable(schema.orgs, "ao_org");
  const regionOrg = aliasedTable(schema.orgs, "region_org");

  const rows = await db
    .select({
      id: schema.events.id,
      regionId: regionOrg.id,
      name: schema.events.name,
      dayOfWeek: schema.events.dayOfWeek,
      startTime: schema.events.startTime,
      endTime: schema.events.endTime,
      description: schema.events.description,
      latitude: schema.locations.latitude,
      longitude: schema.locations.longitude,
      addressStreet: schema.locations.addressStreet,
      addressStreet2: schema.locations.addressStreet2,
      addressCity: schema.locations.addressCity,
      addressState: schema.locations.addressState,
      addressZip: schema.locations.addressZip,
      addressCountry: schema.locations.addressCountry,
      eventTypeNames: sql<
        string[] | null
      >`array_agg(${schema.eventTypes.name} ORDER BY ${schema.eventTypes.id})`,
    })
    .from(schema.events)
    .innerJoin(
      schema.locations,
      and(
        eq(schema.locations.id, schema.events.locationId),
        eq(schema.locations.isActive, true),
      ),
    )
    .innerJoin(
      aoOrg,
      and(
        eq(aoOrg.id, schema.events.orgId),
        eq(aoOrg.orgType, "ao"),
        eq(aoOrg.isActive, true),
      ),
    )
    .innerJoin(
      regionOrg,
      and(
        eq(regionOrg.id, aoOrg.parentId),
        eq(regionOrg.orgType, "region"),
        eq(regionOrg.isActive, true),
      ),
    )
    .innerJoin(
      schema.eventsXEventTypes,
      eq(schema.eventsXEventTypes.eventId, schema.events.id),
    )
    .innerJoin(
      schema.eventTypes,
      eq(schema.eventTypes.id, schema.eventsXEventTypes.eventTypeId),
    )
    .where(
      and(
        eq(schema.events.isActive, true),
        eq(schema.events.isPrivate, false),
        isNotNull(schema.events.dayOfWeek),
        withinCurrentEventDateWindow(),
        ancestorOrgsAreActive(regionOrg.id),
        regionId === undefined ? undefined : eq(regionOrg.id, regionId),
      ),
    )
    .groupBy(schema.events.id, regionOrg.id, schema.locations.id);

  return rows.map(toRegionPageWorkout).filter((w) => w !== null);
}

export const regionPagesRouter = os.router({
  regions: publicReadProcedure
    .route({
      method: "GET",
      path: "/regions",
      tags: ["region-pages"],
      summary: "List regions for the region directory",
      description:
        "All active regions with their public workout count and an area (city/state and map center) derived from their workouts. Ordered by name.",
    })
    .output(z.array(regionSchema))
    .handler(({ context: ctx }) =>
      // Always cached (not mapDataFor): honoring the spoofable orpc-ssg
      // client header here would let any caller force this nationwide
      // aggregation on every request.
      cachedMapData("regionPages.regions", async () => {
        void logIfOrgTreeExceedsMaxDepth(ctx.db);
        const [regions, workouts] = await Promise.all([
          selectActiveRegions(ctx.db),
          selectWorkouts(ctx.db),
        ]);

        const workoutsByRegion = new Map<string, RegionPageWorkout[]>();
        for (const workout of dedupeWorkouts(workouts)) {
          const list = workoutsByRegion.get(workout.regionId) ?? [];
          list.push(workout);
          workoutsByRegion.set(workout.regionId, list);
        }

        return uniqueBySlug(regions)
          .map((org) =>
            toRegionPageRegion(org, workoutsByRegion.get(String(org.id)) ?? []),
          )
          .sort((a, b) => a.name.localeCompare(b.name));
      }),
    ),

  region: publicReadProcedure
    .input(z.object({ slug: z.string().min(1).max(200) }))
    .route({
      method: "GET",
      path: "/region",
      tags: ["region-pages"],
      summary: "Get one region and its workouts",
      description:
        "Look up an active region by its slug and return it with its public workouts. Returns null when no active region has that slug.",
    })
    .output(
      z
        .object({ region: regionSchema, workouts: z.array(workoutSchema) })
        .nullable(),
    )
    .handler(async ({ context: ctx, input }) => {
      void logIfOrgTreeExceedsMaxDepth(ctx.db);
      // Slugs are derived in JS (lodash kebabCase), so resolve them against
      // the region list (~600 rows) rather than in SQL. Lowest id wins when
      // two regions share a slug. The list sits under one fixed cache key, so
      // a flood of made-up slugs neither reaches the database nor grows the
      // cache; only a real slug costs a (bounded, per-region) query.
      const regions = await cachedMapData("regionPages.activeRegions", () =>
        selectActiveRegions(ctx.db),
      );
      const org = regions.find((r) => regionSlug(r.name) === input.slug);
      if (!org) return null;

      const workouts = dedupeWorkouts(await selectWorkouts(ctx.db, org.id));
      return { region: toRegionPageRegion(org, workouts), workouts };
    }),
});
