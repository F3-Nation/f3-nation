import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { and, asc, countDistinct, eq, isNotNull, schema, sql } from "@acme/db";
import { OrgType } from "@acme/shared/app/enums";

import { protectedProcedure } from "../../shared";

interface OrgRow {
  id: number;
  name: string | null;
  parentId: number | null;
  orgType: OrgType;
  isActive: boolean;
}

interface PositionRow {
  positionId: number;
  title: string;
  userId: number;
  f3Name: string | null;
  avatarUrl: string | null;
}

interface RoleRow {
  roleId: number;
  title: string;
  userId: number;
  f3Name: string | null;
  avatarUrl: string | null;
}

export const orgChartRouter = {
  all: protectedProcedure
    .route({
      method: "GET",
      path: "/",
      tags: ["Org Chart"],
      summary: "List org chart orgs",
      description:
        "Return active orgs and their hierarchy for the org chart, along with active location summaries.",
    })
    .output(
      z.object({
        orgs: z.array(
          z
            .object({
              orgId: z.number().describe("Organization ID"),
              name: z.string().nullable().describe("Organization name"),
              orgType: z.enum(OrgType).describe("Organization type"),
              hierarchy: z
                .array(
                  z.tuple([
                    z.number().describe("Ancestor org ID"),
                    z.string().nullable().describe("Ancestor org name"),
                    z.enum(OrgType).describe("Ancestor org type"),
                  ]),
                )
                .describe(
                  "Parent chain from immediate parent to root (each entry is [id, name, orgType])",
                ),
              activeLocations: z
                .array(
                  z.object({
                    latitude: z.number().describe("Location latitude"),
                    longitude: z.number().describe("Location longitude"),
                    eventCount: z
                      .number()
                      .describe("Number of active events at this location"),
                    aoCount: z
                      .number()
                      .describe("Number of distinct AOs at this location"),
                  }),
                )
                .describe("Active locations with event/AO counts"),
            })
            .nullable(),
        ),
      }),
    )
    .handler(async ({ context: ctx }) => {
      const orgsPromise = ctx.db
        .select({
          id: schema.orgs.id,
          name: schema.orgs.name,
          parentId: schema.orgs.parentId,
          orgType: schema.orgs.orgType,
          isActive: schema.orgs.isActive,
        })
        .from(schema.orgs)
        .where(eq(schema.orgs.isActive, true));

      const aoCountsPromise = ctx.db
        .select({
          locationId: schema.events.locationId,
          aoCount: countDistinct(schema.events.orgId),
        })
        .from(schema.events)
        .where(
          and(
            eq(schema.events.isActive, true),
            eq(schema.events.isPrivate, false),
          ),
        )
        .groupBy(schema.events.locationId);

      const locationSummariesPromise = ctx.db
        .select({
          locationId: schema.locations.id,
          orgId: schema.locations.orgId,
          latitude: schema.locations.latitude,
          longitude: schema.locations.longitude,
          eventCount: countDistinct(schema.events.id),
          aoCount: sql<number>`0`,
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
            isNotNull(schema.locations.latitude),
            isNotNull(schema.locations.longitude),
            eq(schema.locations.isActive, true),
          ),
        )
        .groupBy(
          schema.locations.id,
          schema.locations.orgId,
          schema.locations.latitude,
          schema.locations.longitude,
        );

      const [orgsForChart, aoCountsByLocation, locationSummaries] =
        await Promise.all([
          orgsPromise,
          aoCountsPromise,
          locationSummariesPromise,
        ]);

      if (!orgsForChart.length) {
        return { orgs: [] };
      }

      const orgMap = new Map<number, OrgRow>(
        orgsForChart.map((org) => [org.id, org]),
      );

      const ancestorCache = new Map<
        number,
        [number, string | null, OrgType][] | null
      >();

      const buildParentChain = (
        orgId: number,
      ): [number, string | null, OrgType][] | null => {
        const cached = ancestorCache.get(orgId);
        if (cached !== undefined) {
          return cached;
        }

        const chain: [number, string | null, OrgType][] = [];
        const visited = new Set<number>();
        let current = orgMap.get(orgId)?.parentId ?? null;

        while (current !== null) {
          if (visited.has(current)) {
            ancestorCache.set(orgId, null);
            return null;
          }
          visited.add(current);
          const parent = orgMap.get(current);
          if (!parent) {
            ancestorCache.set(orgId, null);
            return null;
          }
          chain.push([parent.id, parent.name, parent.orgType]);
          current = parent.parentId ?? null;
        }

        ancestorCache.set(orgId, chain);
        return chain;
      };

      const aoCountMap = new Map(
        aoCountsByLocation.map((row) => [row.locationId, Number(row.aoCount)]),
      );

      for (const summary of locationSummaries) {
        summary.aoCount = aoCountMap.get(summary.locationId) ?? 0;
      }

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
          match.aoCount = Math.max(match.aoCount, aoCount);
        } else {
          existing.push({
            latitude: summary.latitude,
            longitude: summary.longitude,
            eventCount,
            aoCount,
          });
        }
        activeLocationsByOrg.set(summary.orgId, existing);
      }

      const orgSummaries = orgsForChart
        .map((org) => {
          const hierarchy = buildParentChain(org.id);
          if (!hierarchy) {
            return null;
          }

          return {
            orgId: org.id,
            name: org.name,
            orgType: org.orgType,
            hierarchy,
            activeLocations: activeLocationsByOrg.get(org.id) ?? [],
          };
        })
        .filter((org) => org && org.activeLocations.length > 0);

      return { orgs: orgSummaries };
    }),

  byId: protectedProcedure
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
    .output(
      z.object({
        id: z.number().describe("Organization ID"),
        name: z.string().nullable().describe("Organization name"),
        orgType: z.enum(OrgType).describe("Organization type"),
        email: z.string().nullable().describe("Organization email"),
        phone: z.string().nullable().describe("Organization phone number"),
        website: z.string().nullable().describe("Organization website"),
        twitter: z.string().nullable().describe("Organization Twitter handle"),
        facebook: z.string().nullable().describe("Organization Facebook page"),
        instagram: z
          .string()
          .nullable()
          .describe("Organization Instagram handle"),
        positions: z
          .array(
            z.object({
              positionId: z.number().describe("Position ID"),
              title: z.string().describe("Position title"),
              userId: z.number().describe("User ID"),
              f3Name: z.string().nullable().describe("User F3 name"),
              avatarUrl: z.string().nullable().describe("User avatar URL"),
            }),
          )
          .describe("Leadership positions for this organization"),
        roles: z
          .array(
            z.object({
              roleId: z.number().describe("Role ID"),
              title: z.string().describe("Role title"),
              userId: z.number().describe("User ID"),
              f3Name: z.string().nullable().describe("User F3 name"),
              avatarUrl: z.string().nullable().describe("User avatar URL"),
            }),
          )
          .describe("Leadership roles for this organization"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const [org] = await ctx.db
        .select({
          id: schema.orgs.id,
          name: schema.orgs.name,
          orgType: schema.orgs.orgType,
          email: schema.orgs.email,
          phone: schema.orgs.phone,
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
          positionId: schema.positions.id,
          title: schema.positions.name,
          userId: schema.users.id,
          f3Name: schema.users.f3Name,
          avatarUrl: schema.users.avatarUrl,
        })
        .from(schema.positionsXOrgsXUsers)
        .innerJoin(
          schema.positions,
          and(
            eq(schema.positions.id, schema.positionsXOrgsXUsers.positionId),
            eq(schema.positions.isActive, true),
          ),
        )
        .innerJoin(
          schema.users,
          eq(schema.users.id, schema.positionsXOrgsXUsers.userId),
        )
        .where(eq(schema.positionsXOrgsXUsers.orgId, input.orgId))
        .orderBy(asc(schema.positions.name), asc(schema.users.f3Name));

      // Get roles for this org, similar to positions
      const orgRoles: RoleRow[] = await ctx.db
        .select({
          roleId: schema.roles.id,
          title: schema.roles.name,
          userId: schema.users.id,
          f3Name: schema.users.f3Name,
          avatarUrl: schema.users.avatarUrl,
        })
        .from(schema.rolesXUsersXOrg)
        .innerJoin(
          schema.roles,
          eq(schema.roles.id, schema.rolesXUsersXOrg.roleId),
        )
        .innerJoin(
          schema.users,
          eq(schema.users.id, schema.rolesXUsersXOrg.userId),
        )
        .where(eq(schema.rolesXUsersXOrg.orgId, input.orgId))
        .orderBy(asc(schema.roles.name), asc(schema.users.f3Name));

      return {
        id: org.id,
        name: org.name,
        orgType: org.orgType,
        email: org.email,
        phone: org.phone,
        website: org.website,
        twitter: org.twitter,
        facebook: org.facebook,
        instagram: org.instagram,
        positions: orgPositions.map((position) => ({
          positionId: position.positionId,
          title: position.title,
          userId: position.userId,
          f3Name: position.f3Name,
          avatarUrl: position.avatarUrl,
        })),
        roles: orgRoles.map((role) => ({
          roleId: role.roleId,
          title: role.title,
          userId: role.userId,
          f3Name: role.f3Name,
          avatarUrl: role.avatarUrl,
        })),
      };
    }),
};
