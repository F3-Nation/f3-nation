import { ORPCError } from "@orpc/server";
import { z } from "zod";

import {
  and,
  asc,
  countDistinct,
  eq,
  inArray,
  isNotNull,
  schema,
  sql,
} from "@acme/db";
import { positions, positionsXOrgsXUsers } from "@acme/db/schema/schema";
import { OrgType as OrgTypeValues } from "@acme/shared/app/enums";
import type { OrgType } from "@acme/shared/app/enums";

import { withSessionAndDb } from "../../shared";

const orgChartOrgTypes = OrgTypeValues.filter((orgType) => orgType !== "ao");

interface OrgRow {
  id: number;
  name: string | null;
  parentId: number | null;
  orgType: OrgType;
  isActive: boolean;
}

interface LocationSummaryRow {
  locationId: number;
  orgId: number;
  latitude: number | null;
  longitude: number | null;
  eventCount: number;
  aoCount: number;
}

interface PositionRow {
  title: string;
  f3Name: string | null;
  avatarUrl: string | null;
}

export const orgChartRouter = {
  all: withSessionAndDb
    .route({
      method: "GET",
      path: "/",
      tags: ["Org Chart"],
      summary: "List org chart orgs",
      description:
        "Return active orgs and their hierarchy for the org chart, along with active location summaries.",
    })
    .handler(async ({ context: ctx }) => {
      const orgs: OrgRow[] = await ctx.db
        .select({
          id: schema.orgs.id,
          name: schema.orgs.name,
          parentId: schema.orgs.parentId,
          orgType: schema.orgs.orgType,
          isActive: schema.orgs.isActive,
        })
        .from(schema.orgs)
        .where(eq(schema.orgs.isActive, true));

      const orgMap = new Map<number, OrgRow>(orgs.map((org) => [org.id, org]));

      const orgsForChart = orgs.filter((org) =>
        orgChartOrgTypes.includes(org.orgType),
      );

      const orgIds = orgsForChart.map((org) => org.id);

      const ancestorCache = new Map<
        number,
        [number, string | null, OrgType][]
      >();

      const buildParentChain = (
        orgId: number,
      ): [number, string | null, OrgType][] => {
        const cached = ancestorCache.get(orgId);
        if (cached) {
          return cached;
        }

        const chain: [number, string | null, OrgType][] = [];
        const visited = new Set<number>();
        let current = orgMap.get(orgId)?.parentId ?? null;

        while (current !== null && !visited.has(current)) {
          visited.add(current);
          const parent = orgMap.get(current);
          if (!parent) {
            break;
          }
          chain.push([parent.id, parent.name, parent.orgType]);
          current = parent.parentId ?? null;
        }

        ancestorCache.set(orgId, chain);
        return chain;
      };

      // First, get AO counts per location
      const aoCountsByLocation = orgIds.length
        ? await ctx.db
            .select({
              locationId: schema.events.locationId,
              aoCount: countDistinct(schema.events.orgId),
            })
            .from(schema.events)
            .innerJoin(
              schema.orgs,
              and(
                eq(schema.orgs.id, schema.events.orgId),
                eq(schema.orgs.orgType, "ao"),
              ),
            )
            .where(
              and(
                eq(schema.events.isActive, true),
                eq(schema.events.isPrivate, false),
              ),
            )
            .groupBy(schema.events.locationId)
        : [];

      const aoCountMap = new Map(
        aoCountsByLocation.map((row) => [row.locationId, Number(row.aoCount)]),
      );

      // Then get location summaries with event counts
      const locationSummaries: LocationSummaryRow[] = orgIds.length
        ? await ctx.db
            .select({
              locationId: schema.locations.id,
              orgId: schema.locations.orgId,
              latitude: schema.locations.latitude,
              longitude: schema.locations.longitude,
              eventCount: countDistinct(schema.events.id),
              aoCount: sql<number>`0`, // Placeholder, will be filled from aoCountMap
            })
            .from(schema.locations)
            .innerJoin(
              schema.events,
              and(
                eq(schema.events.locationId, schema.locations.id),
                eq(schema.events.isActive, true),
                eq(schema.events.isPrivate, false),
              ),
            )
            .where(
              and(
                inArray(schema.locations.orgId, orgIds),
                isNotNull(schema.locations.latitude),
                isNotNull(schema.locations.longitude),
              ),
            )
            .groupBy(
              schema.locations.id,
              schema.locations.orgId,
              schema.locations.latitude,
              schema.locations.longitude,
            )
        : [];

      // Merge AO counts into location summaries
      for (const summary of locationSummaries) {
        summary.aoCount = aoCountMap.get(summary.locationId) ?? 0;
      }

      const activeLocationsByOrg = new Map<
        number,
        {
          latitude: number;
          longitude: number;
          eventCount: number;
          aoIds: Set<number>;
        }[]
      >();

      for (const summary of locationSummaries) {
        if (summary.latitude === null || summary.longitude === null) {
          continue;
        }

        const eventCount = Number(summary.eventCount ?? 0);
        const aoCount = Number(summary.aoCount ?? 0);

        const existing = activeLocationsByOrg.get(summary.orgId) ?? [];
        const match = existing.find(
          (location) =>
            location.latitude === summary.latitude &&
            location.longitude === summary.longitude,
        );

        if (match) {
          match.eventCount += eventCount;
          // For co-located venues, aoCount is already distinct per location
          // To avoid overcounting the same AO across multiple co-located locations,
          // we take the maximum instead of summing
          match.aoIds.add(aoCount);
        } else {
          const aoIds = new Set<number>();
          aoIds.add(aoCount);
          existing.push({
            latitude: summary.latitude,
            longitude: summary.longitude,
            eventCount,
            aoIds,
          });
        }
        activeLocationsByOrg.set(summary.orgId, existing);
      }

      const orgSummaries = orgsForChart
        .map((org) => ({
          orgId: org.id,
          name: org.name,
          orgType: org.orgType,
          hierarchy: buildParentChain(org.id),
          activeLocations:
            activeLocationsByOrg.get(org.id)?.map((loc) => ({
              latitude: loc.latitude,
              longitude: loc.longitude,
              eventCount: loc.eventCount,
              aoCount: Math.max(...loc.aoIds),
            })) ?? [],
        }))
        .filter((org) => org.activeLocations.length > 0);

      return { orgs: orgSummaries };
    }),

  byId: withSessionAndDb
    .input(
      z.object({
        orgId: z.coerce
          .number()
          .describe("The unique identifier of the organization"),
      }),
    )
    .route({
      method: "GET",
      path: "/{orgId}",
      tags: ["Org Chart"],
      summary: "Get org chart org",
      description:
        "Return org chart details and leadership positions for the specified organization.",
    })
    .handler(async ({ context: ctx, input }) => {
      const [org] = await ctx.db
        .select({
          id: schema.orgs.id,
          name: schema.orgs.name,
          orgType: schema.orgs.orgType,
          email: schema.orgs.email,
          website: schema.orgs.website,
          twitter: schema.orgs.twitter,
          facebook: schema.orgs.facebook,
          instagram: schema.orgs.instagram,
        })
        .from(schema.orgs)
        .where(eq(schema.orgs.id, input.orgId));

      if (!org) {
        throw new ORPCError("NOT_FOUND", {
          message: "Organization not found",
        });
      }

      const orgPositions: PositionRow[] = await ctx.db
        .select({
          title: positions.name,
          f3Name: schema.users.f3Name,
          avatarUrl: schema.users.avatarUrl,
        })
        .from(positionsXOrgsXUsers)
        .innerJoin(
          positions,
          and(
            eq(positions.id, positionsXOrgsXUsers.positionId),
            eq(positions.isActive, true),
          ),
        )
        .innerJoin(
          schema.users,
          eq(schema.users.id, positionsXOrgsXUsers.userId),
        )
        .where(eq(positionsXOrgsXUsers.orgId, input.orgId))
        .orderBy(asc(positions.name), asc(schema.users.f3Name));

      return {
        id: org.id,
        name: org.name,
        orgType: org.orgType,
        email: org.email,
        website: org.website,
        twitter: org.twitter,
        facebook: org.facebook,
        instagram: org.instagram,
        positions: orgPositions.map((position) => ({
          title: position.title,
          f3Name: position.f3Name,
          avatarUrl: position.avatarUrl,
        })),
      };
    }),
};
