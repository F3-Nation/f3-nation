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
} from "@acme/db";
import { positions, positionsXOrgsXUsers } from "@acme/db/schema/schema";
import { OrgType as OrgTypeValues } from "@acme/shared/app/enums";
import type { OrgType } from "@acme/shared/app/enums";

import { withSessionAndDb } from "../../shared";

const orgChartOrgTypes = OrgTypeValues.filter((orgType) => orgType !== "ao");

interface OrgRow {
  id: number;
  parentId: number | null;
  orgType: OrgType;
  isActive: boolean;
}

interface LocationSummaryRow {
  orgId: number;
  latitude: number | null;
  longitude: number | null;
  eventCount: number;
  aoCount: number;
}

interface PositionRow {
  title: string;
  username: string | null;
  avatarUrl: string | null;
}

export const orgChartRouter = {
  all: withSessionAndDb
    .route({
      method: "GET",
      path: "/",
      tags: ["org-chart"],
      summary: "List org chart orgs",
      description:
        "Return active orgs and their hierarchy for the org chart, along with active location summaries.",
    })
    .handler(async ({ context: ctx }) => {
      const orgs: OrgRow[] = await ctx.db
        .select({
          id: schema.orgs.id,
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
      const orgIdsSet = new Set(orgIds);

      const ancestorCache = new Map<number, number[]>();
      const ancestorMatchCache = new Map<number, boolean>();

      const buildParentChain = (orgId: number): number[] => {
        const cached = ancestorCache.get(orgId);
        if (cached) {
          return cached;
        }

        const chain: number[] = [];
        const visited = new Set<number>();
        let current = orgMap.get(orgId)?.parentId ?? null;

        while (current !== null && !visited.has(current)) {
          visited.add(current);
          chain.push(current);
          current = orgMap.get(current)?.parentId ?? null;
        }

        ancestorCache.set(orgId, chain);
        return chain;
      };

      const hasAncestorInChart = (orgId: number): boolean => {
        const cached = ancestorMatchCache.get(orgId);
        if (cached !== undefined) {
          return cached;
        }

        const chain = buildParentChain(orgId);
        const hasMatch = chain.some((ancestorId) => orgIdsSet.has(ancestorId));
        ancestorMatchCache.set(orgId, hasMatch);
        return hasMatch;
      };

      const descendantOrgIds = orgs
        .filter((org) => hasAncestorInChart(org.id) || orgIdsSet.has(org.id))
        .map((org) => org.id);

      const locationSummaries: LocationSummaryRow[] = orgIds.length
        ? await ctx.db
            .select({
              orgId: schema.locations.orgId,
              latitude: schema.locations.latitude,
              longitude: schema.locations.longitude,
              eventCount: countDistinct(schema.events.id),
              aoCount: countDistinct(schema.events.orgId),
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
                descendantOrgIds.length
                  ? inArray(schema.locations.orgId, descendantOrgIds)
                  : undefined,
                isNotNull(schema.locations.latitude),
                isNotNull(schema.locations.longitude),
              ),
            )
            .groupBy(
              schema.locations.orgId,
              schema.locations.latitude,
              schema.locations.longitude,
            )
        : [];

      const activeLocationsByOrg = new Map<
        number,
        {
          latitude: number;
          longitude: number;
          eventCount: number;
          aoCount: number;
        }[]
      >();

      for (const summary of locationSummaries) {
        if (summary.latitude === null || summary.longitude === null) {
          continue;
        }

        const eventCount = Number(summary.eventCount ?? 0);
        const aoCount = Number(summary.aoCount ?? 0);

        const orgChain = [summary.orgId, ...buildParentChain(summary.orgId)];

        for (const orgId of orgChain) {
          const existing = activeLocationsByOrg.get(orgId) ?? [];
          const match = existing.find(
            (location) =>
              location.latitude === summary.latitude &&
              location.longitude === summary.longitude,
          );

          if (match) {
            match.eventCount += eventCount;
            match.aoCount += aoCount;
          } else {
            existing.push({
              latitude: summary.latitude,
              longitude: summary.longitude,
              eventCount,
              aoCount,
            });
          }
          activeLocationsByOrg.set(orgId, existing);
        }
      }

      const orgSummaries = orgs.map((org) => ({
        orgId: org.id,
        orgType: org.orgType,
        hiearchy: buildParentChain(org.id),
        activeLocations: activeLocationsByOrg.get(org.id) ?? [],
      }));

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
      tags: ["org-chart"],
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
          username: schema.users.f3Name,
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
          username: position.username,
          avatar_url: position.avatarUrl,
        })),
      };
    }),
};
