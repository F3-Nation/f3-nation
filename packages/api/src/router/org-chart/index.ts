import { ORPCError } from "@orpc/server";
import { z } from "zod";

import {
  aliasedTable,
  and,
  asc,
  countDistinct,
  eq,
  inArray,
  isNotNull,
  schema,
  sql,
} from "@acme/db";
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
                    locationId: z.number().describe("Location ID"),
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
        .innerJoin(
          schema.orgs,
          and(
            eq(schema.orgs.id, schema.events.orgId),
            eq(schema.orgs.orgType, "ao"),
            eq(schema.orgs.isActive, true),
          ),
        )
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
        .innerJoin(
          schema.orgs,
          and(
            eq(schema.orgs.id, schema.events.orgId),
            eq(schema.orgs.orgType, "ao"),
            eq(schema.orgs.isActive, true),
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
          locationId: number;
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
        const aoCount = aoCountMap.get(summary.locationId) ?? 0;

        const existing = activeLocationsByOrg.get(summary.orgId) ?? [];
        existing.push({
          locationId: summary.locationId,
          latitude: summary.latitude,
          longitude: summary.longitude,
          eventCount,
          aoCount,
        });
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
          and(
            eq(schema.users.id, schema.positionsXOrgsXUsers.userId),
            eq(schema.users.status, "active"),
          ),
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
          and(
            eq(schema.users.id, schema.rolesXUsersXOrg.userId),
            eq(schema.users.status, "active"),
          ),
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

  byLocation: protectedProcedure
    .input(
      z.object({
        locationId: z.coerce
          .number()
          .describe("The location ID to look up AOs for"),
      }),
    )
    .route({
      method: "GET",
      path: "/location/{locationId}",
      tags: ["Org Chart"],
      summary: "Get AOs at a location",
      description:
        "Return all AOs with active events at the given location, along with their leadership positions.",
    })
    .output(
      z.object({
        locationId: z.number(),
        locationName: z.string().nullable(),
        latitude: z.number().nullable(),
        longitude: z.number().nullable(),
        aos: z.array(
          z.object({
            id: z.number().describe("AO org ID"),
            name: z.string().nullable(),
            email: z.string().nullable(),
            website: z.string().nullable(),
            twitter: z.string().nullable(),
            facebook: z.string().nullable(),
            instagram: z.string().nullable(),
            logoUrl: z.string().nullable(),
            eventCount: z.number().describe("Active events at this location"),
            positions: z.array(
              z.object({
                positionId: z.number(),
                title: z.string(),
                userId: z.number(),
                f3Name: z.string().nullable(),
                avatarUrl: z.string().nullable(),
              }),
            ),
          }),
        ),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const [location] = await ctx.db
        .select({
          id: schema.locations.id,
          name: schema.locations.name,
          latitude: schema.locations.latitude,
          longitude: schema.locations.longitude,
        })
        .from(schema.locations)
        .where(
          and(
            eq(schema.locations.id, input.locationId),
            eq(schema.locations.isActive, true),
          ),
        );

      if (!location) {
        throw new ORPCError("NOT_FOUND", { message: "Location not found" });
      }

      const aoOrg = aliasedTable(schema.orgs, "ao_org");
      const aoRows = await ctx.db
        .select({
          id: aoOrg.id,
          name: aoOrg.name,
          email: aoOrg.email,
          website: aoOrg.website,
          twitter: aoOrg.twitter,
          facebook: aoOrg.facebook,
          instagram: aoOrg.instagram,
          logoUrl: aoOrg.logoUrl,
          eventCount: countDistinct(schema.events.id),
        })
        .from(schema.events)
        .innerJoin(
          aoOrg,
          and(
            eq(aoOrg.id, schema.events.orgId),
            eq(aoOrg.orgType, "ao"),
            eq(aoOrg.isActive, true),
          ),
        )
        .where(
          and(
            eq(schema.events.locationId, input.locationId),
            eq(schema.events.isActive, true),
            eq(schema.events.isPrivate, false),
          ),
        )
        .groupBy(
          aoOrg.id,
          aoOrg.name,
          aoOrg.email,
          aoOrg.website,
          aoOrg.twitter,
          aoOrg.facebook,
          aoOrg.instagram,
          aoOrg.logoUrl,
        )
        .orderBy(asc(aoOrg.name));

      if (aoRows.length === 0) {
        return {
          locationId: location.id,
          locationName: location.name,
          latitude: location.latitude,
          longitude: location.longitude,
          aos: [],
        };
      }

      const aoIds = aoRows.map((ao) => ao.id);
      const positionRows = await ctx.db
        .select({
          orgId: schema.positionsXOrgsXUsers.orgId,
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
          and(
            eq(schema.users.id, schema.positionsXOrgsXUsers.userId),
            eq(schema.users.status, "active"),
          ),
        )
        .where(inArray(schema.positionsXOrgsXUsers.orgId, aoIds))
        .orderBy(asc(schema.positions.name), asc(schema.users.f3Name));

      const positionsByOrgId = new Map<number, typeof positionRows>();
      for (const row of positionRows) {
        const list = positionsByOrgId.get(row.orgId) ?? [];
        list.push(row);
        positionsByOrgId.set(row.orgId, list);
      }

      return {
        locationId: location.id,
        locationName: location.name,
        latitude: location.latitude,
        longitude: location.longitude,
        aos: aoRows.map((ao) => ({
          id: ao.id,
          name: ao.name,
          email: ao.email,
          website: ao.website,
          twitter: ao.twitter,
          facebook: ao.facebook,
          instagram: ao.instagram,
          logoUrl: ao.logoUrl,
          eventCount: Number(ao.eventCount),
          positions: (positionsByOrgId.get(ao.id) ?? []).map((p) => ({
            positionId: p.positionId,
            title: p.title,
            userId: p.userId,
            f3Name: p.f3Name,
            avatarUrl: p.avatarUrl,
          })),
        })),
      };
    }),
};
