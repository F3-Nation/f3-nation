import { ORPCError } from "@orpc/server";
import { z } from "zod";

import {
  aliasedTable,
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  or,
  schema,
  sql,
} from "@acme/db";
import { SeriesException } from "@acme/shared/app/enums";
import { arrayOrSingle } from "@acme/shared/app/functions";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { logWarn } from "../logger";
import { editorProcedure, protectedProcedure } from "../shared";
import { withPagination } from "../with-pagination";

const booleanStringSchema = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");

type SlackChannelSource =
  | "event_instance_meta"
  | "region_settings"
  | "region_settings_misconfigured"
  | "ao_org_meta"
  | "none";

interface SlackChannelContext {
  channelId: string | null;
  source: SlackChannelSource;
}

const getNonEmptySlackChannelId = (meta: unknown): string | null => {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return null;
  }

  const channelId = (meta as Record<string, unknown>).slack_channel_id;
  return typeof channelId === "string" && channelId.trim().length > 0
    ? channelId.trim()
    : null;
};

type SpecifiedDestinationChannelResolution =
  | { status: "not_configured" }
  | { status: "configured"; channelId: string }
  | { status: "misconfigured" };

const getSpecifiedDestinationChannelId = (
  settings: unknown,
  kind: "preblast" | "backblast",
): SpecifiedDestinationChannelResolution => {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return { status: "not_configured" };
  }

  const settingsRecord = settings as Record<string, unknown>;
  const destinationKey = `default_${kind}_destination`;
  const channelKey = `${kind}_destination_channel`;

  if (settingsRecord[destinationKey] !== "specified_channel") {
    return { status: "not_configured" };
  }

  const channelId = settingsRecord[channelKey];
  if (typeof channelId === "string" && channelId.trim().length > 0) {
    return { status: "configured", channelId: channelId.trim() };
  }

  return { status: "misconfigured" };
};

const resolveSlackChannel = ({
  eventInstanceChannelId,
  regionSettings,
  aoChannelId,
  kind,
}: {
  eventInstanceChannelId: string | null;
  regionSettings: unknown;
  aoChannelId: string | null;
  kind: "preblast" | "backblast";
}): SlackChannelContext => {
  if (eventInstanceChannelId) {
    return { channelId: eventInstanceChannelId, source: "event_instance_meta" };
  }

  const regionChannel = getSpecifiedDestinationChannelId(regionSettings, kind);
  if (regionChannel.status === "configured") {
    return { channelId: regionChannel.channelId, source: "region_settings" };
  }
  if (regionChannel.status === "misconfigured") {
    logWarn("api.event_instance.slack_channel_misconfigured", { kind });
    return { channelId: null, source: "region_settings_misconfigured" };
  }

  if (aoChannelId) {
    return { channelId: aoChannelId, source: "ao_org_meta" };
  }

  return { channelId: null, source: "none" };
};

/**
 * Event Instance Router
 * Event instances are individual event occurrences stored in the event_instances table.
 * They may or may not be linked to a series (recurring event) via seriesId.
 */
export const eventInstanceRouter = {
  all: protectedProcedure
    .input(
      z
        .object({
          pageIndex: z.coerce.number().optional(),
          pageSize: z.coerce.number().optional(),
          searchTerm: z.string().optional(),
          statuses: arrayOrSingle(z.enum(["active", "inactive"])).optional(),
          sorting: z
            .array(z.object({ id: z.string(), desc: z.coerce.boolean() }))
            .optional(),
          regionOrgId: z.coerce.number().optional(),
          aoOrgId: z.coerce.number().optional(),
          regionOrgIds: z.array(z.coerce.number()).optional(),
          aoOrgIds: z.array(z.coerce.number()).optional(),
          startDate: z.string().optional(),
          seriesId: z.coerce.number().optional(),
          onlyStandalone: z.coerce.boolean().optional(), // Only instances without a series
        })
        .optional(),
    )
    .route({
      method: "GET",
      path: "/",
      tags: ["event-instance"],
      summary: "List all event instances",
      description:
        "Get a paginated list of event instances (individual occurrences)",
    })
    .handler(async ({ context: ctx, input }) => {
      const regionOrg = aliasedTable(schema.orgs, "region_org");
      const aoOrg = aliasedTable(schema.orgs, "ao_org");
      const limit = input?.pageSize ?? 40;
      const offset = (input?.pageIndex ?? 0) * limit;
      const usePagination =
        input?.pageIndex !== undefined && input?.pageSize !== undefined;

      const statusFilter = (() => {
        const s = input?.statuses;
        if (s === undefined) return eq(schema.eventInstances.isActive, true);
        if (s.length === 0) return undefined;
        if (s.length >= 2) return undefined;
        return s.includes("active")
          ? eq(schema.eventInstances.isActive, true)
          : eq(schema.eventInstances.isActive, false);
      })();

      const where = and(
        statusFilter,
        // Search filter
        input?.searchTerm
          ? or(
              ilike(schema.eventInstances.name, `%${input.searchTerm}%`),
              ilike(schema.eventInstances.description, `%${input.searchTerm}%`),
            )
          : undefined,
        // Region filter (through AO's parent)
        input?.regionOrgIds?.length
          ? inArray(regionOrg.id, input.regionOrgIds)
          : input?.regionOrgId
            ? eq(regionOrg.id, input.regionOrgId)
            : undefined,
        // AO filter
        input?.aoOrgIds?.length
          ? inArray(aoOrg.id, input.aoOrgIds)
          : input?.aoOrgId
            ? eq(aoOrg.id, input.aoOrgId)
            : undefined,
        // Start date filter
        input?.startDate
          ? gte(schema.eventInstances.startDate, input.startDate)
          : undefined,
        // Series filter
        input?.seriesId
          ? eq(schema.eventInstances.seriesId, input.seriesId)
          : undefined,
        // Standalone instances only (no series link)
        input?.onlyStandalone
          ? isNull(schema.eventInstances.seriesId)
          : undefined,
      );

      const select = {
        id: schema.eventInstances.id,
        name: schema.eventInstances.name,
        description: schema.eventInstances.description,
        isActive: schema.eventInstances.isActive,
        aoName: aoOrg.name,
        regionName: regionOrg.name,
        locationId: schema.eventInstances.locationId,
        orgId: schema.eventInstances.orgId,
        seriesId: schema.eventInstances.seriesId,
        seriesException: schema.eventInstances.seriesException,
        startDate: schema.eventInstances.startDate,
        endDate: schema.eventInstances.endDate,
        startTime: schema.eventInstances.startTime,
        endTime: schema.eventInstances.endTime,
        highlight: schema.eventInstances.highlight,
        meta: schema.eventInstances.meta,
        isPrivate: schema.eventInstances.isPrivate,
        paxCount: schema.eventInstances.paxCount,
        fngCount: schema.eventInstances.fngCount,
      };

      const [instanceCount] = await ctx.db
        .select({ count: count() })
        .from(schema.eventInstances)
        .leftJoin(
          aoOrg,
          and(
            eq(aoOrg.orgType, "ao"),
            eq(aoOrg.id, schema.eventInstances.orgId),
          ),
        )
        .leftJoin(
          regionOrg,
          and(
            eq(regionOrg.orgType, "region"),
            eq(regionOrg.id, aoOrg.parentId),
          ),
        )
        .where(where);

      const sortedColumns = input?.sorting?.map((sorting) => {
        const direction = sorting.desc ? desc : asc;
        switch (sorting.id) {
          case "startDate":
            return direction(schema.eventInstances.startDate);
          case "startTime":
            return direction(schema.eventInstances.startTime);
          case "name":
            return direction(schema.eventInstances.name);
          default:
            return direction(schema.eventInstances.startDate);
        }
      }) ?? [
        asc(schema.eventInstances.startDate),
        asc(schema.eventInstances.startTime),
      ];

      const query = ctx.db
        .select(select)
        .from(schema.eventInstances)
        .leftJoin(
          aoOrg,
          and(
            eq(aoOrg.orgType, "ao"),
            eq(aoOrg.id, schema.eventInstances.orgId),
          ),
        )
        .leftJoin(
          regionOrg,
          and(
            eq(regionOrg.orgType, "region"),
            eq(regionOrg.id, aoOrg.parentId),
          ),
        )
        .where(where);

      const instances = usePagination
        ? await withPagination(query.$dynamic(), sortedColumns, offset, limit)
        : await query.orderBy(...sortedColumns).limit(limit);

      return {
        eventInstances: instances,
        totalCount: instanceCount?.count ?? 0,
      };
    }),

  byId: protectedProcedure
    .input(
      z.object({
        id: z.coerce.number(),
        includeSlackChannelId: booleanStringSchema.optional().default(false),
      }),
    )
    .route({
      method: "GET",
      path: "/id/{id}",
      tags: ["event-instance"],
      summary: "Get event instance by ID",
      description:
        "Retrieve detailed information about a specific event instance",
    })
    .handler(async ({ context: ctx, input }) => {
      const aoOrg = aliasedTable(schema.orgs, "ao_org");

      const [instance] = await ctx.db
        .select({
          id: schema.eventInstances.id,
          name: schema.eventInstances.name,
          description: schema.eventInstances.description,
          isActive: schema.eventInstances.isActive,
          locationId: schema.eventInstances.locationId,
          orgId: schema.eventInstances.orgId,
          seriesId: schema.eventInstances.seriesId,
          seriesException: schema.eventInstances.seriesException,
          startDate: schema.eventInstances.startDate,
          endDate: schema.eventInstances.endDate,
          startTime: schema.eventInstances.startTime,
          endTime: schema.eventInstances.endTime,
          highlight: schema.eventInstances.highlight,
          meta: schema.eventInstances.meta,
          isPrivate: schema.eventInstances.isPrivate,
          paxCount: schema.eventInstances.paxCount,
          fngCount: schema.eventInstances.fngCount,
          preblast: schema.eventInstances.preblast,
          preblastRich: schema.eventInstances.preblastRich,
          preblastTs: schema.eventInstances.preblastTs,
          backblast: schema.eventInstances.backblast,
          backblastRich: schema.eventInstances.backblastRich,
          backblastTs: schema.eventInstances.backblastTs,
          org: sql<{
            id: number;
            name: string;
            parentId: number | null;
            meta: Record<string, unknown> | null;
          } | null>`
            CASE WHEN ${aoOrg.id} IS NOT NULL THEN
              jsonb_build_object(
                'id', ${aoOrg.id},
                'name', ${aoOrg.name},
                'parentId', ${aoOrg.parentId},
                'meta', ${aoOrg.meta}
              )
            ELSE NULL END
          `,
          eventTypes: sql<
            { eventTypeId: number; eventTypeName: string }[]
          >`COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'eventTypeId', ${schema.eventTypes.id},
                'eventTypeName', ${schema.eventTypes.name}
              )
            )
            FILTER (
              WHERE ${schema.eventTypes.id} IS NOT NULL
            ),
            '[]'
          )`,
          eventTags: sql<
            { eventTagId: number; eventTagName: string }[]
          >`COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'eventTagId', ${schema.eventTags.id},
                'eventTagName', ${schema.eventTags.name}
              )
            )
            FILTER (
              WHERE ${schema.eventTags.id} IS NOT NULL
            ),
            '[]'
          )`,
          location: sql<{
            id: number;
            locationName: string | null;
            latitude: number | null;
            longitude: number | null;
          } | null>`
            CASE WHEN ${schema.locations.id} IS NOT NULL THEN
              jsonb_build_object(
                'id', ${schema.locations.id},
                'locationName', ${schema.locations.name},
                'latitude', ${schema.locations.latitude},
                'longitude', ${schema.locations.longitude}
              )
            ELSE NULL END
          `,
        })
        .from(schema.eventInstances)
        .leftJoin(
          aoOrg,
          and(
            eq(aoOrg.orgType, "ao"),
            eq(aoOrg.id, schema.eventInstances.orgId),
          ),
        )
        .leftJoin(
          schema.locations,
          eq(schema.locations.id, schema.eventInstances.locationId),
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
        .leftJoin(
          schema.eventTagsXEventInstances,
          eq(
            schema.eventTagsXEventInstances.eventInstanceId,
            schema.eventInstances.id,
          ),
        )
        .leftJoin(
          schema.eventTags,
          eq(schema.eventTags.id, schema.eventTagsXEventInstances.eventTagId),
        )
        .where(eq(schema.eventInstances.id, input.id))
        .groupBy(
          schema.eventInstances.id,
          aoOrg.id,
          aoOrg.name,
          aoOrg.parentId,
          sql`${aoOrg.meta}::text`,
          schema.locations.id,
          schema.locations.name,
          schema.locations.latitude,
          schema.locations.longitude,
        );

      if (!instance || !input.includeSlackChannelId) {
        return instance ?? null;
      }

      const [eventOrg] = await ctx.db
        .select({
          id: schema.orgs.id,
          parentId: schema.orgs.parentId,
          orgType: schema.orgs.orgType,
          meta: schema.orgs.meta,
        })
        .from(schema.orgs)
        .where(eq(schema.orgs.id, instance.orgId));

      const regionOrgId =
        eventOrg?.orgType === "ao"
          ? eventOrg.parentId
          : eventOrg?.orgType === "region"
            ? eventOrg.id
            : null;
      const aoChannelId =
        eventOrg?.orgType === "ao"
          ? getNonEmptySlackChannelId(eventOrg.meta)
          : null;

      const regionOrg = aliasedTable(schema.orgs, "context_region_org");
      const regionSlackSpaces = regionOrgId
        ? await ctx.db
            .select({ settings: schema.slackSpaces.settings })
            .from(schema.orgsXSlackSpaces)
            .innerJoin(
              schema.slackSpaces,
              eq(schema.slackSpaces.id, schema.orgsXSlackSpaces.slackSpaceId),
            )
            .innerJoin(
              regionOrg,
              and(
                eq(regionOrg.id, schema.orgsXSlackSpaces.orgId),
                eq(regionOrg.orgType, "region"),
                eq(regionOrg.isActive, true),
              ),
            )
            .where(eq(schema.orgsXSlackSpaces.orgId, regionOrgId))
            .limit(2)
        : [];

      if (regionSlackSpaces.length > 1) {
        throw new ORPCError("CONFLICT", {
          message: "Multiple Slack spaces are linked to this region",
        });
      }

      const eventInstanceChannelId = getNonEmptySlackChannelId(instance.meta);
      const regionSettings = regionSlackSpaces[0]?.settings ?? null;

      return {
        ...instance,
        slackChannels: {
          preblast: resolveSlackChannel({
            eventInstanceChannelId,
            regionSettings,
            aoChannelId,
            kind: "preblast",
          }),
          backblast: resolveSlackChannel({
            eventInstanceChannelId,
            regionSettings,
            aoChannelId,
            kind: "backblast",
          }),
        },
      };
    }),

  crupdate: editorProcedure
    .input(
      z.object({
        id: z.coerce.number().optional(),
        name: z.string().optional(),
        description: z.string().nullish(),
        isActive: z.boolean().optional(),
        locationId: z.coerce.number().nullish(),
        orgId: z.coerce.number(),
        seriesId: z.coerce.number().nullish(), // Link to series if this is a series instance
        seriesException: z.enum(SeriesException).nullish(), // Exception type for series instances
        startDate: z.string(),
        endDate: z.string().nullish(),
        startTime: z.string().nullish(),
        endTime: z.string().nullish(),
        highlight: z.boolean().optional().default(false),
        meta: z.record(z.string(), z.unknown()).nullish(),
        isPrivate: z.boolean().optional().default(false),
        eventTypeId: z.coerce.number().nullish(),
        eventTagId: z.coerce.number().nullish(),
        preblast: z.string().nullish(),
        preblastRich: z.record(z.string(), z.unknown()).nullish(),
        preblastTs: z.number().nullish(),
        // Backblast fields
        backblast: z.string().nullish(),
        backblastRich: z.array(z.record(z.string(), z.unknown())).nullish(),
        backblastTs: z.number().nullish(),
        paxCount: z.number().nullish(),
        fngCount: z.number().nullish(),
      }),
    )
    .route({
      method: "POST",
      path: "/",
      tags: ["event-instance"],
      summary: "Create or update event instance",
      description: "Create a new event instance or update an existing one",
    })
    .handler(async ({ context: ctx, input }) => {
      // When updating, load the persisted instance and authorize against
      // its actual org — never trust the submitted orgId alone.
      let existingName: string | null = null;
      let existingIsActive: boolean | null = null;
      if (input.id) {
        const [existing] = await ctx.db
          .select({
            orgId: schema.eventInstances.orgId,
            name: schema.eventInstances.name,
            isActive: schema.eventInstances.isActive,
          })
          .from(schema.eventInstances)
          .where(eq(schema.eventInstances.id, input.id));

        if (!existing) {
          throw new ORPCError("NOT_FOUND", {
            message: "Event instance not found",
          });
        }

        const sourceAuth = await checkHasRoleOnOrg({
          orgId: existing.orgId,
          session: ctx.session,
          db: ctx.db,
          roleName: "editor",
        });
        if (!sourceAuth.success) {
          throw new ORPCError("UNAUTHORIZED", {
            message: "You are not authorized to update this event instance",
          });
        }

        if (input.orgId !== existing.orgId) {
          const destAuth = await checkHasRoleOnOrg({
            orgId: input.orgId,
            session: ctx.session,
            db: ctx.db,
            roleName: "editor",
          });
          if (!destAuth.success) {
            throw new ORPCError("UNAUTHORIZED", {
              message:
                "You are not authorized to move this event instance to the destination organization",
            });
          }
        }

        existingName = existing.name;
        existingIsActive = existing.isActive;
      } else {
        const createAuth = await checkHasRoleOnOrg({
          orgId: input.orgId,
          session: ctx.session,
          db: ctx.db,
          roleName: "editor",
        });
        if (!createAuth.success) {
          throw new ORPCError("UNAUTHORIZED", {
            message: "You are not authorized to create event instances",
          });
        }
      }

      // Generate a default name if not provided or empty
      let name = input.name;
      if (!name || name.trim() === "") {
        if (existingName) {
          name = existingName;
        }

        // If still no name (new record or existing had no name), generate default
        if (!name || name.trim() === "") {
          // Get AO name
          const [ao] = await ctx.db
            .select({ name: schema.orgs.name })
            .from(schema.orgs)
            .where(eq(schema.orgs.id, input.orgId));
          const aoName = ao?.name ?? "Workout";

          // Get event type name if provided
          let eventTypeName = "Event";
          if (input.eventTypeId) {
            const [eventType] = await ctx.db
              .select({ name: schema.eventTypes.name })
              .from(schema.eventTypes)
              .where(eq(schema.eventTypes.id, input.eventTypeId));
            eventTypeName = eventType?.name ?? "Event";
          }

          name = `${aoName} - ${eventTypeName}`;
        }
      }

      // On create, default isActive to true; on update, preserve the
      // persisted value when the client omits the field so editing an
      // inactive instance doesn't silently reactivate it.
      const isActive = input.isActive ?? existingIsActive ?? true;

      // Presence of the key — not truthiness of the value — decides whether the
      // association is rewritten, so an explicit null can clear it. Must be read
      // before destructuring, which would lose the distinction.
      const shouldUpdateEventType = "eventTypeId" in input;
      const shouldUpdateEventTag = "eventTagId" in input;
      const {
        eventTypeId,
        eventTagId,
        name: _inputName,
        isActive: _inputIsActive,
        ...eventData
      } = input;

      const result = await ctx.db.transaction(async (tx) => {
        // Create or update the event instance
        const [upserted] = await tx
          .insert(schema.eventInstances)
          .values({
            ...eventData,
            name,
            isActive,
          })
          .onConflictDoUpdate({
            target: [schema.eventInstances.id],
            set: { ...eventData, name, isActive },
          })
          .returning();

        if (!upserted) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Failed to create/update event instance",
          });
        }

        // Handle event type in join table
        if (shouldUpdateEventType) {
          await tx
            .delete(schema.eventInstancesXEventTypes)
            .where(
              eq(schema.eventInstancesXEventTypes.eventInstanceId, upserted.id),
            );

          if (eventTypeId != null) {
            await tx.insert(schema.eventInstancesXEventTypes).values({
              eventInstanceId: upserted.id,
              eventTypeId,
            });
          }
        }

        // Handle event tag in join table
        if (shouldUpdateEventTag) {
          await tx
            .delete(schema.eventTagsXEventInstances)
            .where(
              eq(schema.eventTagsXEventInstances.eventInstanceId, upserted.id),
            );

          if (eventTagId != null) {
            await tx.insert(schema.eventTagsXEventInstances).values({
              eventInstanceId: upserted.id,
              eventTagId,
            });
          }
        }

        return upserted;
      });

      return result;
    }),

  delete: editorProcedure
    .input(z.object({ id: z.coerce.number() }))
    .route({
      method: "DELETE",
      path: "/id/{id}",
      tags: ["event-instance"],
      summary: "Delete event instance",
      description: "Delete an event instance (hard delete)",
    })
    .handler(async ({ context: ctx, input }) => {
      const [instance] = await ctx.db
        .select()
        .from(schema.eventInstances)
        .where(eq(schema.eventInstances.id, input.id));

      if (!instance) {
        throw new ORPCError("NOT_FOUND", {
          message: "Event instance not found",
        });
      }

      const roleCheckResult = await checkHasRoleOnOrg({
        orgId: instance.orgId,
        session: ctx.session,
        db: ctx.db,
        roleName: "admin",
      });
      if (!roleCheckResult.success) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "You are not authorized to delete this event instance",
        });
      }

      // Soft delete for event instances
      await ctx.db
        .update(schema.eventInstances)
        .set({ isActive: false })
        .where(eq(schema.eventInstances.id, input.id));

      return { eventInstanceId: input.id };
    }),

  /**
   * Get upcoming events where the user is Q or Co-Q
   * Used for preblast selection menu
   */
  getUpcomingQs: protectedProcedure
    .input(
      z.object({
        userId: z.coerce.number(),
        regionOrgId: z.coerce.number(),
        /** Only return events without a posted preblast (preblast_ts IS NULL) */
        notPostedOnly: z
          .enum(["true", "false"])
          .optional()
          .default("true")
          .transform((v) => v === "true"),
      }),
    )
    .route({
      method: "GET",
      path: "/upcoming-qs",
      tags: ["event-instance"],
      summary: "Get upcoming events where user is Q/Co-Q",
      description:
        "Get events where the user has Q or Co-Q attendance for preblast creation",
    })
    .handler(async ({ context: ctx, input }) => {
      const aoOrg = aliasedTable(schema.orgs, "ao_org");

      // Attendance type IDs: 2 = Q, 3 = Co-Q
      const qAttendanceTypeIds = [2, 3];

      // Get today's date in YYYY-MM-DD format
      const today = new Date().toISOString().split("T")[0]!;

      // Build where conditions
      const whereConditions = [
        // Event is active
        eq(schema.eventInstances.isActive, true),
        // Start date is today or later
        gte(schema.eventInstances.startDate, today),
        // User has planned attendance
        eq(schema.attendance.userId, input.userId),
        eq(schema.attendance.isPlanned, true),
        // Attendance is Q or Co-Q type
        inArray(
          schema.attendanceXAttendanceTypes.attendanceTypeId,
          qAttendanceTypeIds,
        ),
        // Event is in the region or a child org of the region
        or(
          eq(schema.eventInstances.orgId, input.regionOrgId),
          eq(aoOrg.parentId, input.regionOrgId),
        ),
      ];

      // Add preblast_ts IS NULL filter if notPostedOnly is true
      if (input.notPostedOnly) {
        whereConditions.push(isNull(schema.eventInstances.preblastTs));
      }

      const instances = await ctx.db
        .selectDistinct({
          id: schema.eventInstances.id,
          name: schema.eventInstances.name,
          startDate: schema.eventInstances.startDate,
          startTime: schema.eventInstances.startTime,
          orgId: schema.eventInstances.orgId,
          orgName: aoOrg.name,
          locationId: schema.eventInstances.locationId,
          seriesId: schema.eventInstances.seriesId,
          preblastTs: schema.eventInstances.preblastTs,
        })
        .from(schema.eventInstances)
        .leftJoin(aoOrg, eq(aoOrg.id, schema.eventInstances.orgId))
        .innerJoin(
          schema.attendance,
          eq(schema.attendance.eventInstanceId, schema.eventInstances.id),
        )
        .innerJoin(
          schema.attendanceXAttendanceTypes,
          eq(
            schema.attendanceXAttendanceTypes.attendanceId,
            schema.attendance.id,
          ),
        )
        .where(and(...whereConditions))
        .orderBy(
          asc(schema.eventInstances.startDate),
          asc(schema.eventInstances.startTime),
        );

      return { eventInstances: instances };
    }),

  /**
   * Get past events where the user is Q or Co-Q
   * Used for backblast selection menu
   */
  getPastQs: protectedProcedure
    .input(
      z.object({
        userId: z.coerce.number(),
        regionOrgId: z.coerce.number(),
        /** Only return events without a posted backblast (backblast_ts IS NULL) */
        notPostedOnly: z
          .enum(["true", "false"])
          .optional()
          .default("true")
          .transform((v) => v === "true"),
      }),
    )
    .route({
      method: "GET",
      path: "/past-qs",
      tags: ["event-instance"],
      summary: "Get past events where user is Q/Co-Q",
      description:
        "Get past events where the user has Q or Co-Q attendance for backblast creation",
    })
    .handler(async ({ context: ctx, input }) => {
      const aoOrg = aliasedTable(schema.orgs, "ao_org");

      // Attendance type IDs: 2 = Q, 3 = Co-Q
      const qAttendanceTypeIds = [2, 3];

      // Get today's date in YYYY-MM-DD format
      const today = new Date().toISOString().split("T")[0]!;

      // Build where conditions
      const whereConditions = [
        // Event is active
        eq(schema.eventInstances.isActive, true),
        // Start date is today or earlier (past events)
        sql`${schema.eventInstances.startDate} <= ${today}`,
        // User has planned attendance
        eq(schema.attendance.userId, input.userId),
        eq(schema.attendance.isPlanned, true),
        // Attendance is Q or Co-Q type
        inArray(
          schema.attendanceXAttendanceTypes.attendanceTypeId,
          qAttendanceTypeIds,
        ),
        // Event is in the region or a child org of the region
        or(
          eq(schema.eventInstances.orgId, input.regionOrgId),
          eq(aoOrg.parentId, input.regionOrgId),
        ),
      ];

      // Add backblast_ts IS NULL filter if notPostedOnly is true
      if (input.notPostedOnly) {
        whereConditions.push(isNull(schema.eventInstances.backblastTs));
      }

      const instances = await ctx.db
        .selectDistinct({
          id: schema.eventInstances.id,
          name: schema.eventInstances.name,
          startDate: schema.eventInstances.startDate,
          startTime: schema.eventInstances.startTime,
          orgId: schema.eventInstances.orgId,
          orgName: aoOrg.name,
          locationId: schema.eventInstances.locationId,
          seriesId: schema.eventInstances.seriesId,
          backblastTs: schema.eventInstances.backblastTs,
        })
        .from(schema.eventInstances)
        .leftJoin(aoOrg, eq(aoOrg.id, schema.eventInstances.orgId))
        .innerJoin(
          schema.attendance,
          eq(schema.attendance.eventInstanceId, schema.eventInstances.id),
        )
        .innerJoin(
          schema.attendanceXAttendanceTypes,
          eq(
            schema.attendanceXAttendanceTypes.attendanceId,
            schema.attendance.id,
          ),
        )
        .where(and(...whereConditions))
        .orderBy(
          desc(schema.eventInstances.startDate),
          desc(schema.eventInstances.startTime),
        );

      return { eventInstances: instances };
    }),

  /**
   * Get past events without any Q or Co-Q assigned
   * Used for backblast selection menu "unclaimed events" section
   */
  getEventsWithoutQ: protectedProcedure
    .input(
      z.object({
        regionOrgId: z.coerce.number(),
        /** Only return events without a posted backblast (backblast_ts IS NULL) */
        notPostedOnly: z
          .enum(["true", "false"])
          .optional()
          .default("true")
          .transform((v) => v === "true"),
        /** Maximum number of events to return */
        limit: z.coerce.number().optional().default(20),
      }),
    )
    .route({
      method: "GET",
      path: "/without-q",
      tags: ["event-instance"],
      summary: "Get past events without Q assigned",
      description: "Get past events that have no Q or Co-Q attendance assigned",
    })
    .handler(async ({ context: ctx, input }) => {
      const aoOrg = aliasedTable(schema.orgs, "ao_org");

      // Get today's date in YYYY-MM-DD format
      const today = new Date().toISOString().split("T")[0]!;

      // Subquery to find event instances that DO have Q or Co-Q attendance
      const eventsWithQ = ctx.db
        .selectDistinct({ eventInstanceId: schema.attendance.eventInstanceId })
        .from(schema.attendance)
        .innerJoin(
          schema.attendanceXAttendanceTypes,
          eq(
            schema.attendanceXAttendanceTypes.attendanceId,
            schema.attendance.id,
          ),
        )
        .where(
          and(
            eq(schema.attendance.isPlanned, true),
            inArray(schema.attendanceXAttendanceTypes.attendanceTypeId, [2, 3]),
          ),
        );

      // Build where conditions
      const whereConditions = [
        // Event is active
        eq(schema.eventInstances.isActive, true),
        // Start date is today or earlier (past events)
        sql`${schema.eventInstances.startDate} <= ${today}`,
        // Event is in the region or a child org of the region
        or(
          eq(schema.eventInstances.orgId, input.regionOrgId),
          eq(aoOrg.parentId, input.regionOrgId),
        ),
        // Exclude events that have Q or Co-Q
        sql`${schema.eventInstances.id} NOT IN (${eventsWithQ})`,
      ];

      // Add backblast_ts IS NULL filter if notPostedOnly is true
      if (input.notPostedOnly) {
        whereConditions.push(isNull(schema.eventInstances.backblastTs));
      }

      const instances = await ctx.db
        .selectDistinct({
          id: schema.eventInstances.id,
          name: schema.eventInstances.name,
          startDate: schema.eventInstances.startDate,
          startTime: schema.eventInstances.startTime,
          orgId: schema.eventInstances.orgId,
          orgName: aoOrg.name,
          locationId: schema.eventInstances.locationId,
          seriesId: schema.eventInstances.seriesId,
          backblastTs: schema.eventInstances.backblastTs,
        })
        .from(schema.eventInstances)
        .leftJoin(aoOrg, eq(aoOrg.id, schema.eventInstances.orgId))
        .where(and(...whereConditions))
        .orderBy(
          desc(schema.eventInstances.startDate),
          desc(schema.eventInstances.startTime),
        )
        .limit(input.limit);

      return { eventInstances: instances };
    }),

  /**
   * Get calendar home schedule view
   * Optimized query using CTE pattern to limit attendance table scans.
   * Returns events with aggregated Q names and user attendance status.
   */
  calendarHomeSchedule: protectedProcedure
    .input(
      z.object({
        userId: z.coerce.number(),
        regionOrgId: z.coerce.number(),
        aoOrgIds: arrayOrSingle(z.coerce.number()).optional(),
        startDate: z.string().optional(),
        eventTypeIds: arrayOrSingle(z.coerce.number()).optional(),
        // Use transform instead of coerce for booleans to handle "false" string correctly
        openQOnly: z
          .union([z.boolean(), z.string()])
          .transform((val) => val === true || val === "true")
          .optional()
          .default(false),
        onlyUserEvents: z
          .union([z.boolean(), z.string()])
          .transform((val) => val === true || val === "true")
          .optional()
          .default(false),
        limit: z.coerce.number().optional().default(45),
      }),
    )
    .route({
      method: "GET",
      path: "/calendar-home-schedule",
      tags: ["event-instance"],
      summary: "Get calendar home schedule",
      description:
        "Get events for calendar home view with Q info and user attendance status",
    })
    .handler(async ({ context: ctx, input }) => {
      const aoOrg = aliasedTable(schema.orgs, "ao_org");
      const seriesEvent = aliasedTable(schema.events, "series_event");

      // Get today's date if no start date provided
      const startDate =
        input.startDate ?? new Date().toISOString().split("T")[0]!;

      // Build org filter based on whether specific AOs are selected
      // If specific AO IDs provided, filter by those exact orgs
      // Otherwise, filter by events where the org's parent is the region (i.e., all AOs under region)
      const orgFilter = input.aoOrgIds?.length
        ? inArray(schema.eventInstances.orgId, input.aoOrgIds)
        : eq(aoOrg.parentId, input.regionOrgId);

      // Build base filters for event instances
      const baseFilters = [
        eq(schema.eventInstances.isActive, true),
        gte(schema.eventInstances.startDate, startDate),
        orgFilter,
      ];

      // Add event type filter if provided
      if (input.eventTypeIds?.length) {
        baseFilters.push(
          inArray(
            schema.eventInstancesXEventTypes.eventTypeId,
            input.eventTypeIds,
          ),
        );
      }

      // Use optimized CTE pattern when not filtering by attendance data
      const useOptimization = !input.openQOnly && !input.onlyUserEvents;

      if (useOptimization) {
        // OPTIMIZED PATH: Use CTE to limit first, then join attendance
        // Step 1: Get candidate event IDs (include ORDER BY columns in select for DISTINCT)
        const candidateQuery = ctx.db
          .selectDistinct({
            eventId: schema.eventInstances.id,
            startDate: schema.eventInstances.startDate,
            startTime: schema.eventInstances.startTime,
          })
          .from(schema.eventInstances)
          .leftJoin(aoOrg, eq(aoOrg.id, schema.eventInstances.orgId))
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
          .where(and(...baseFilters))
          .orderBy(
            asc(schema.eventInstances.startDate),
            asc(schema.eventInstances.startTime),
            asc(schema.eventInstances.id),
          )
          .limit(input.limit);

        // Execute candidate query first
        const candidateIds = await candidateQuery;
        const eventIds = candidateIds.map((c) => c.eventId);

        if (eventIds.length === 0) {
          return { events: [] };
        }

        // Step 2: Main query with attendance aggregation for only these IDs
        const events = await ctx.db
          .select({
            id: schema.eventInstances.id,
            name: schema.eventInstances.name,
            startDate: schema.eventInstances.startDate,
            startTime: schema.eventInstances.startTime,
            orgId: schema.eventInstances.orgId,
            orgName: aoOrg.name,
            seriesId: schema.eventInstances.seriesId,
            seriesName: seriesEvent.name,
            hasPreblast: sql<boolean>`${schema.eventInstances.preblastTs} IS NOT NULL`,
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
            plannedQs: sql<string | null>`(
              SELECT string_agg(u.f3_name, ', ')
              FROM attendance a
              JOIN users u ON u.id = a.user_id
              JOIN attendance_x_attendance_types axat ON axat.attendance_id = a.id
              WHERE a.event_instance_id = ${schema.eventInstances.id}
                AND a.is_planned = true
                AND axat.attendance_type_id IN (2, 3)
            )`,
            userAttending: sql<boolean>`EXISTS(
              SELECT 1 FROM attendance a
              WHERE a.event_instance_id = ${schema.eventInstances.id}
                AND a.user_id = ${input.userId}
                AND a.is_planned = true
            )`,
            userIsQ: sql<boolean>`EXISTS(
              SELECT 1 FROM attendance a
              JOIN attendance_x_attendance_types axat ON axat.attendance_id = a.id
              WHERE a.event_instance_id = ${schema.eventInstances.id}
                AND a.user_id = ${input.userId}
                AND a.is_planned = true
                AND axat.attendance_type_id IN (2, 3)
            )`,
          })
          .from(schema.eventInstances)
          .leftJoin(aoOrg, eq(aoOrg.id, schema.eventInstances.orgId))
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
          .where(inArray(schema.eventInstances.id, eventIds))
          .groupBy(
            schema.eventInstances.id,
            schema.eventInstances.name,
            schema.eventInstances.startDate,
            schema.eventInstances.startTime,
            schema.eventInstances.orgId,
            schema.eventInstances.seriesId,
            aoOrg.name,
            seriesEvent.name,
          )
          .orderBy(
            asc(schema.eventInstances.startDate),
            asc(schema.eventInstances.startTime),
            asc(schema.eventInstances.id),
          );

        return { events };
      } else {
        // NON-OPTIMIZED PATH: For openQOnly or onlyUserEvents filters
        // Must calculate attendance before applying limit
        const events = await ctx.db
          .select({
            id: schema.eventInstances.id,
            name: schema.eventInstances.name,
            startDate: schema.eventInstances.startDate,
            startTime: schema.eventInstances.startTime,
            orgId: schema.eventInstances.orgId,
            orgName: aoOrg.name,
            seriesId: schema.eventInstances.seriesId,
            seriesName: seriesEvent.name,
            hasPreblast: sql<boolean>`${schema.eventInstances.preblastTs} IS NOT NULL`,
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
            plannedQs: sql<string | null>`(
              SELECT string_agg(u.f3_name, ', ')
              FROM attendance a
              JOIN users u ON u.id = a.user_id
              JOIN attendance_x_attendance_types axat ON axat.attendance_id = a.id
              WHERE a.event_instance_id = ${schema.eventInstances.id}
                AND a.is_planned = true
                AND axat.attendance_type_id IN (2, 3)
            )`,
            userAttending: sql<boolean>`EXISTS(
              SELECT 1 FROM attendance a
              WHERE a.event_instance_id = ${schema.eventInstances.id}
                AND a.user_id = ${input.userId}
                AND a.is_planned = true
            )`,
            userIsQ: sql<boolean>`EXISTS(
              SELECT 1 FROM attendance a
              JOIN attendance_x_attendance_types axat ON axat.attendance_id = a.id
              WHERE a.event_instance_id = ${schema.eventInstances.id}
                AND a.user_id = ${input.userId}
                AND a.is_planned = true
                AND axat.attendance_type_id IN (2, 3)
            )`,
          })
          .from(schema.eventInstances)
          .leftJoin(aoOrg, eq(aoOrg.id, schema.eventInstances.orgId))
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
          .where(and(...baseFilters))
          .groupBy(
            schema.eventInstances.id,
            schema.eventInstances.name,
            schema.eventInstances.startDate,
            schema.eventInstances.startTime,
            schema.eventInstances.orgId,
            schema.eventInstances.seriesId,
            aoOrg.name,
            seriesEvent.name,
          )
          .orderBy(
            asc(schema.eventInstances.startDate),
            asc(schema.eventInstances.startTime),
            asc(schema.eventInstances.id),
          )
          .limit(input.limit * 5);

        // Apply post-query filters
        let filteredEvents = events;

        if (input.openQOnly) {
          filteredEvents = filteredEvents.filter((e) => !e.plannedQs);
        }

        if (input.onlyUserEvents) {
          filteredEvents = filteredEvents.filter((e) => e.userAttending);
        }

        // Apply limit after filtering
        return { events: filteredEvents.slice(0, input.limit) };
      }
    }),
};
