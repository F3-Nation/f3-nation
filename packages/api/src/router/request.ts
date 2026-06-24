import { ORPCError } from "@orpc/server";
import dayjs from "dayjs";
import omit from "lodash/omit";
import { z } from "zod";

import {
  aliasedTable,
  and,
  countDistinct,
  eq,
  ilike,
  inArray,
  or,
  schema,
} from "@acme/db";
import type { OrgType } from "@acme/shared/app/enums";
import { DayOfWeek } from "@acme/shared/app/enums";
import { RequestType, UpdateRequestStatus } from "@acme/shared/app/enums";
import { arrayOrSingle, parseSorting } from "@acme/shared/app/functions";
import type { EventMeta, UpdateRequestMeta } from "@acme/shared/app/types";
import type {
  DeleteRequestResponse,
  UpdateRequestResponse,
} from "@acme/validators";
import { DeleteRequestSchema, RequestInsertSchema } from "@acme/validators";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { getEditableOrgIdsForUser } from "../get-editable-org-ids";
import { getSortingColumns } from "../get-sorting-columns";
import { getPublicImageStorage } from "../lib/storage";
import { notifyMapDataChange } from "../lib/webhook-events";
import { logError, logDebug } from "../logger";
import { notifyMapChangeRequest } from "../services/map-request-notification";
import type { Context } from "../shared";
import { editorProcedure, protectedProcedure } from "../shared";
import { withPagination } from "../with-pagination";

export const requestRouter = {
  all: editorProcedure
    .input(
      z
        .object({
          pageIndex: z.coerce
            .number()
            .optional()
            .describe("Zero-based page index for pagination. Defaults to 0."),
          pageSize: z.coerce
            .number()
            .optional()
            .describe("Number of requests per page. Defaults to 10."),
          sorting: parseSorting().describe(
            "Sort results by field(s). Format: [{ id: 'fieldName', desc: true/false }]. Available fields: id, status, requestType, regionName, aoName, workoutName, dayOfWeek, startTime, endTime, description, locationAddress, submittedBy, created.",
          ),
          searchTerm: z
            .string()
            .optional()
            .describe(
              "Search requests by submitter name, event name, description, location info, or AO name.",
            ),
          onlyMine: z.coerce
            .boolean()
            .optional()
            .describe(
              "If true, only return requests from regions where the requester has editor or admin role.",
            ),
          statuses: arrayOrSingle(z.enum(UpdateRequestStatus))
            .optional()
            .describe(
              "Filter requests by status. Matches requests with ANY of the given statuses (pending, approved, rejected, reverted).",
            ),
        })
        .optional(),
    )
    .route({
      method: "GET",
      path: "/",
      tags: ["request"],
      summary: "List all requests",
      description:
        "Get a paginated list of map change requests with optional filtering and sorting",
    })
    .output(
      z.object({
        requests: z
          .array(
            z.object({
              id: z.string().describe("The unique identifier of the request"),
              submittedBy: z.string().describe("The email of the submitter"),
              submitterValidated: z
                .boolean()
                .nullable()
                .describe("Whether the submitter is validated"),
              oldWorkoutName: z
                .string()
                .nullable()
                .describe("The name of the old workout"),
              newWorkoutName: z
                .string()
                .nullable()
                .describe("The name of the new workout"),
              oldRegionName: z
                .string()
                .nullable()
                .describe("The name of the old region"),
              newRegionName: z
                .string()
                .nullable()
                .describe("The name of the new region"),
              oldAoName: z
                .string()
                .nullable()
                .describe("The name of the old ao"),
              newAoName: z
                .string()
                .nullable()
                .describe("The name of the new ao"),
              oldDayOfWeek: z
                .string()
                .nullable()
                .describe("The day of the week of the old workout"),
              newDayOfWeek: z
                .string()
                .nullable()
                .describe("The day of the week of the new workout"),
              oldStartTime: z
                .string()
                .nullable()
                .describe("The start time of the old workout"),
              newStartTime: z
                .string()
                .nullable()
                .describe("The start time of the new workout"),
              oldEndTime: z
                .string()
                .nullable()
                .describe("The end time of the old workout"),
              newEndTime: z
                .string()
                .nullable()
                .describe("The end time of the new workout"),
              oldDescription: z
                .string()
                .nullable()
                .describe("The description of the old workout"),
              newDescription: z
                .string()
                .nullable()
                .describe("The description of the new workout"),
              oldLocationAddress: z
                .string()
                .nullable()
                .describe("The address of the old location"),
              newLocationAddress: z
                .string()
                .nullable()
                .describe("The address of the new location"),
              oldLocationAddress2: z
                .string()
                .nullable()
                .describe("The address 2 of the old location"),
              newLocationAddress2: z
                .string()
                .nullable()
                .describe("The address 2 of the new location"),
              oldLocationCity: z
                .string()
                .nullable()
                .describe("The city of the old location"),
              newLocationCity: z
                .string()
                .nullable()
                .describe("The city of the new location"),
              oldLocationState: z
                .string()
                .nullable()
                .describe("The state of the old location"),
              newLocationState: z
                .string()
                .nullable()
                .describe("The state of the new location"),
              oldLocationCountry: z
                .string()
                .nullable()
                .describe("The country of the old location"),
              newLocationCountry: z
                .string()
                .nullable()
                .describe("The country of the new location"),
              oldLocationZipCode: z
                .string()
                .nullable()
                .describe("The zip code of the old location"),
              newLocationZipCode: z
                .string()
                .nullable()
                .describe("The zip code of the new location"),
              oldLocationLat: z
                .number()
                .nullable()
                .describe("The latitude of the old location"),
              newLocationLat: z
                .number()
                .nullable()
                .describe("The latitude of the new location"),
              oldLocationLng: z
                .number()
                .nullable()
                .describe("The longitude of the old location"),
              newLocationLng: z
                .number()
                .nullable()
                .describe("The longitude of the new location"),
              created: z.string().describe("The date the request was created"),
              status: z
                .enum(UpdateRequestStatus)
                .describe("The status of the request"),
              requestType: z.string().describe("The type of the request"),
            }),
          )
          .describe("List of requests"),
        totalCount: z.number().describe("The total number of requests"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const onlyMine = input?.onlyMine ?? false;
      const oldAoOrg = aliasedTable(schema.orgs, "old_ao_org");
      const oldRegionOrg = aliasedTable(schema.orgs, "old_region_org");
      const oldLocation = aliasedTable(schema.locations, "old_location");
      const newRegionOrg = aliasedTable(schema.orgs, "new_region_org");

      const limit = input?.pageSize ?? 10;
      const offset = (input?.pageIndex ?? 0) * limit;
      const usePagination =
        input?.pageIndex !== undefined && input?.pageSize !== undefined;

      // Determine if filter by region IDs is needed
      let editableOrgs: { id: number; type: OrgType }[] = [];
      let isNationAdmin = false;

      if (onlyMine) {
        const result = await getEditableOrgIdsForUser(ctx);
        editableOrgs = result.editableOrgs;
        isNationAdmin = result.isNationAdmin;

        if (editableOrgs.length === 0 && !isNationAdmin) {
          // User has no editable orgs and is not a nation admin
          return { requests: [], totalCount: 0 };
        }
      }

      const where = and(
        input?.statuses?.length
          ? inArray(schema.updateRequests.status, input?.statuses)
          : undefined,
        input?.searchTerm
          ? or(
              ilike(
                schema.updateRequests.submittedBy,
                `%${input?.searchTerm}%`,
              ),
              ilike(schema.updateRequests.eventName, `%${input?.searchTerm}%`),
              ilike(
                schema.updateRequests.eventDescription,
                `%${input?.searchTerm}%`,
              ),
              ilike(schema.updateRequests.aoName, `%${input?.searchTerm}%`),
              ilike(
                schema.updateRequests.locationName,
                `%${input?.searchTerm}%`,
              ),
              ilike(
                schema.updateRequests.locationDescription,
                `%${input?.searchTerm}%`,
              ),
            )
          : undefined,
        // Filter by editable orgs if onlyMine is true and not a nation admin
        onlyMine && !isNationAdmin && editableOrgs.length > 0
          ? inArray(
              schema.updateRequests.regionId,
              editableOrgs.map((org) => org.id),
            )
          : undefined,
      );

      const sortedColumns = getSortingColumns(
        input?.sorting,
        {
          id: schema.updateRequests.id,
          status: schema.updateRequests.status,
          requestType: schema.updateRequests.requestType,
          regionName: newRegionOrg.name,
          aoName: schema.updateRequests.aoName,
          workoutName: schema.updateRequests.eventName,
          dayOfWeek: schema.updateRequests.eventDayOfWeek,
          startTime: schema.updateRequests.eventStartTime,
          endTime: schema.updateRequests.eventEndTime,
          description: schema.updateRequests.eventDescription,
          locationAddress: schema.updateRequests.locationAddress,
          locationAddress2: schema.updateRequests.locationAddress2,
          locationCity: schema.updateRequests.locationCity,
          locationState: schema.updateRequests.locationState,
          locationZip: schema.updateRequests.locationZip,
          locationCountry: schema.updateRequests.locationCountry,
          latitude: schema.updateRequests.locationLat,
          longitude: schema.updateRequests.locationLng,
          submittedBy: schema.updateRequests.submittedBy,
          created: schema.updateRequests.created,
        },
        "id",
      );

      const select = {
        id: schema.updateRequests.id,
        submittedBy: schema.updateRequests.submittedBy,
        submitterValidated: schema.updateRequests.submitterValidated,
        oldWorkoutName: schema.events.name,
        newWorkoutName: schema.updateRequests.eventName,
        oldRegionName: oldRegionOrg.name,
        newRegionName: newRegionOrg.name,
        oldAoName: oldAoOrg.name,
        newAoName: schema.updateRequests.aoName,
        oldDayOfWeek: schema.events.dayOfWeek,
        newDayOfWeek: schema.updateRequests.eventDayOfWeek,
        oldStartTime: schema.events.startTime,
        newStartTime: schema.updateRequests.eventStartTime,
        oldEndTime: schema.events.endTime,
        newEndTime: schema.updateRequests.eventEndTime,
        oldDescription: schema.events.description,
        newDescription: schema.updateRequests.eventDescription,
        oldLocationAddress: oldLocation.addressStreet,
        newLocationAddress: schema.updateRequests.locationAddress,
        oldLocationAddress2: oldLocation.addressStreet2,
        newLocationAddress2: schema.updateRequests.locationAddress2,
        oldLocationCity: oldLocation.addressCity,
        newLocationCity: schema.updateRequests.locationCity,
        oldLocationState: oldLocation.addressState,
        newLocationState: schema.updateRequests.locationState,
        oldLocationCountry: oldLocation.addressCountry,
        newLocationCountry: schema.updateRequests.locationCountry,
        oldLocationZipCode: oldLocation.addressZip,
        newLocationZipCode: schema.updateRequests.locationZip,
        oldLocationLat: oldLocation.latitude,
        newLocationLat: schema.updateRequests.locationLat,
        oldLocationLng: oldLocation.longitude,
        newLocationLng: schema.updateRequests.locationLng,
        created: schema.updateRequests.created,
        status: schema.updateRequests.status,
        requestType: schema.updateRequests.requestType,
      };

      const [totalCount] = await ctx.db
        .select({ count: countDistinct(schema.updateRequests.id) })
        .from(schema.updateRequests)
        .where(where);

      const query = ctx.db
        .select(select)
        .from(schema.updateRequests)
        .leftJoin(
          newRegionOrg,
          eq(schema.updateRequests.regionId, newRegionOrg.id),
        )
        .leftJoin(
          schema.events,
          eq(schema.updateRequests.eventId, schema.events.id),
        )
        .leftJoin(oldAoOrg, eq(oldAoOrg.id, schema.events.orgId))
        .leftJoin(oldRegionOrg, eq(oldRegionOrg.id, oldAoOrg.parentId))
        .leftJoin(oldLocation, eq(oldLocation.id, schema.events.locationId))
        .where(where);

      const requests = usePagination
        ? await withPagination(query.$dynamic(), sortedColumns, offset, limit)
        : await query.orderBy(...sortedColumns);

      return { requests, totalCount: totalCount?.count ?? 0 };
    }),
  byId: editorProcedure
    .input(
      z.object({
        id: z.string().describe("The unique identifier of the request"),
      }),
    )
    .route({
      method: "GET",
      path: "/id/{id}",
      tags: ["request"],
      summary: "Get request by ID",
      description:
        "Retrieve detailed information about a specific map change request including the proposed changes and current status",
    })
    .output(
      z.object({
        request: z
          .object({
            id: z.string().describe("Request ID"),
            token: z.string().describe("Request token"),
            regionId: z.number().describe("Region ID"),
            eventId: z.number().nullable().describe("Event ID"),
            eventTypeIds: z
              .array(z.number())
              .nullable()
              .describe("Event type IDs"),
            eventTag: z.string().nullable().describe("Event tag"),
            eventSeriesId: z.number().nullable().describe("Event series ID"),
            eventIsSeries: z
              .boolean()
              .nullable()
              .describe("Whether the event is a series"),
            eventIsActive: z
              .boolean()
              .nullable()
              .describe("Whether the event is active"),
            eventHighlight: z
              .boolean()
              .nullable()
              .describe("Whether the event is highlighted"),
            eventStartDate: z.string().nullable().describe("Event start date"),
            eventEndDate: z.string().nullable().describe("Event end date"),
            eventStartTime: z.string().nullable().describe("Event start time"),
            eventEndTime: z.string().nullable().describe("Event end time"),
            eventDayOfWeek: z
              .enum(DayOfWeek)
              .nullable()
              .describe("Event day of week"),
            eventName: z.string().describe("Event name"),
            eventDescription: z
              .string()
              .nullable()
              .describe("Event description"),
            eventRecurrencePattern: z
              .string()
              .nullable()
              .describe("Event recurrence pattern"),
            eventRecurrenceInterval: z
              .number()
              .nullable()
              .describe("Event recurrence interval"),
            eventIndexWithinInterval: z
              .number()
              .nullable()
              .describe("Event index within interval"),
            eventMeta: z.any().nullable().describe("Event metadata"),
            eventContactEmail: z
              .string()
              .nullable()
              .describe("Event contact email"),
            locationName: z.string().nullable().describe("Location name"),
            locationDescription: z
              .string()
              .nullable()
              .describe("Location description"),
            locationAddress: z.string().nullable().describe("Location address"),
            locationAddress2: z
              .string()
              .nullable()
              .describe("Location address line 2"),
            locationCity: z.string().nullable().describe("Location city"),
            locationState: z.string().nullable().describe("Location state"),
            locationZip: z.string().nullable().describe("Location zip code"),
            locationCountry: z.string().nullable().describe("Location country"),
            locationLat: z.number().nullable().describe("Location latitude"),
            locationLng: z.number().nullable().describe("Location longitude"),
            locationId: z.number().nullable().describe("Location ID"),
            locationContactEmail: z
              .string()
              .nullable()
              .describe("Location contact email"),
            aoId: z.number().nullable().describe("AO ID"),
            aoName: z.string().nullable().describe("AO name"),
            aoLogo: z.string().nullable().describe("AO logo URL"),
            aoWebsite: z.string().nullable().describe("AO website URL"),
            submittedBy: z.string().describe("Submitter email"),
            submitterValidated: z
              .boolean()
              .nullable()
              .describe("Whether the submitter is validated"),
            reviewedBy: z.string().nullable().describe("Reviewer email"),
            reviewedAt: z.string().nullable().describe("Review date"),
            status: z.enum(UpdateRequestStatus).describe("Request status"),
            meta: z.any().nullable().describe("Request metadata"),
            created: z.string().describe("Date the request was created"),
            updated: z.string().describe("Date the request was last updated"),
            requestType: z.enum(RequestType).describe("Request type"),
          })
          .nullable()
          .describe("The request"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const [request] = await ctx.db
        .select()
        .from(schema.updateRequests)
        .where(eq(schema.updateRequests.id, input.id));
      return { request: request ?? null };
    }),
  canDeleteEvent: protectedProcedure
    .input(z.object({ eventId: z.coerce.number() }))
    .route({
      method: "GET",
      path: "/can-delete-event",
      tags: ["request"],
      summary: "Check if event can be deleted",
      description:
        "Check if there is a pending delete request for a specific event",
    })
    .output(
      z.object({
        canDelete: z.boolean().describe("Whether the event can be deleted"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const [request] = await ctx.db
        .select()
        .from(schema.updateRequests)
        .where(
          and(
            eq(schema.updateRequests.eventId, input.eventId),
            eq(schema.updateRequests.requestType, "delete_event"),
            eq(schema.updateRequests.status, "pending"),
          ),
        );
      return { canDelete: !!request };
    }),
  canEditRegions: protectedProcedure
    .input(z.object({ orgIds: z.array(z.number()) }))
    .route({
      method: "POST",
      path: "/can-edit-regions",
      tags: ["request"],
      summary: "Check region edit permissions",
      description:
        "Check if the current user has editor permissions for specified organizations",
    })
    .handler(async ({ context: ctx, input }) => {
      // protectedProcedure guarantees an authenticated session, so every result
      // comes from checkHasRoleOnOrg (modes: direct-permission/org-admin/no-permission).
      const results = await Promise.all(
        input.orgIds.map((orgId) =>
          checkHasRoleOnOrg({
            orgId,
            session: ctx.session,
            db: ctx.db,
            roleName: "editor" as const,
          }),
        ),
      );
      return { results };
    }),
  submitDeleteRequest: protectedProcedure
    .input(DeleteRequestSchema)
    .route({
      method: "POST",
      path: "/delete-request",
      tags: ["request"],
      summary: "Submit delete request",
      description: "Submit a request to delete an event or location",
    })
    .output(
      z.object({
        status: z
          .enum(UpdateRequestStatus)
          .describe("The status of the request"),
        deleteRequest: z.object({
          id: z.string().optional().describe("Request ID"),
          regionId: z.number().optional().describe("Region ID"),
          eventId: z.number().nullable().optional().describe("Event ID"),
          eventName: z.string().nullable().optional().describe("Event name"),
          submittedBy: z.string().optional().describe("Submitter email"),
          reviewedBy: z
            .string()
            .nullable()
            .optional()
            .describe("Reviewer email"),
        }),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const submittedBy = ctx.session?.user?.email ?? input.submittedBy;
      if (!submittedBy) {
        throw new Error("Submitted by is required");
      }

      const [existingEvent] = input.eventId
        ? await ctx.db
            .select()
            .from(schema.events)
            .where(eq(schema.events.id, input.eventId))
        : [];

      const canEditRegion = ctx.session
        ? await checkHasRoleOnOrg({
            orgId: input.regionId,
            session: ctx.session,
            db: ctx.db,
            roleName: "editor",
          })
        : null;

      const canEditEvent =
        ctx.session && existingEvent?.orgId
          ? await checkHasRoleOnOrg({
              orgId: existingEvent.orgId,
              session: ctx.session,
              db: ctx.db,
              roleName: "editor",
            })
          : null;

      // Immediately update if user has permission
      if (
        canEditRegion?.success &&
        canEditEvent?.success &&
        ctx.session?.user?.email
      ) {
        const result = await applyDeleteRequest(ctx, {
          ...input,
          reviewedBy: ctx.session?.user?.email,
        });

        // Notify webhooks and invalidate cache about the auto-approved delete
        if (result.status === "approved") {
          notifyMapDataChange({
            type: "map.deleted",
            eventId: input.eventId,
            orgId: input.regionId,
          });
        }

        return { status: result.status, deleteRequest: result.deleteRequest };
      }

      const [request] = await ctx.db
        .insert(schema.updateRequests)
        .values({
          eventId: input.eventId,
          regionId: input.regionId,
          requestType: "delete_event",
          eventName: input.eventName,
          submittedBy: input.submittedBy,
        })
        .returning();

      if (!request) {
        throw new Error("Unable to create a new request");
      }

      // Notify admins and editors about the new delete request
      if (request.status === "pending") {
        try {
          await notifyMapChangeRequest({
            db: ctx.db,
            requestId: request.id,
          });
        } catch (error) {
          logError(
            "api.request.notification_failed",
            { requestId: request.id, flow: "submit_delete_request" },
            error,
          );
          // Don't fail the request if notification fails
        }
      }

      return {
        status: "pending",
        deleteRequest: request,
      };
    }),
  submitUpdateRequest: protectedProcedure
    .input(RequestInsertSchema)
    .route({
      method: "POST",
      path: "/update-request",
      tags: ["request"],
      summary: "Submit update request",
      description: "Submit a request to create or update a workout on the map",
    })
    .output(
      z.object({
        status: z
          .enum(UpdateRequestStatus)
          .describe("The status of the request"),
        updateRequest: z.object({
          id: z.string().optional().describe("Request ID"),
          regionId: z.number().optional().describe("Region ID"),
          eventId: z.number().nullable().optional().describe("Event ID"),
          submittedBy: z.string().optional().describe("Submitter email"),
          reviewedBy: z
            .string()
            .nullable()
            .optional()
            .describe("Reviewer email"),
          reviewedAt: z.string().nullable().optional().describe("Review date"),
          status: z
            .enum(UpdateRequestStatus)
            .optional()
            .describe("Request status"),
          meta: z.any().nullable().optional().describe("Request metadata"),
          created: z
            .string()
            .optional()
            .describe("Date the request was created"),
          updated: z
            .string()
            .optional()
            .describe("Date the request was last updated"),
          requestType: z.enum(RequestType).optional().describe("Request type"),
        }),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const submittedBy = ctx.session?.user?.email ?? input.submittedBy;
      if (!submittedBy) {
        throw new Error("Submitted by is required");
      }

      if (input.eventStartTime && input.eventEndTime) {
        if (input.eventStartTime > input.eventEndTime) {
          throw new Error("End time must be after start time");
        }
      }

      const [existingEvent] = input.eventId
        ? await ctx.db
            .select()
            .from(schema.events)
            .where(eq(schema.events.id, input.eventId))
        : [null];

      const canEditEvent =
        existingEvent === null
          ? { success: true }
          : ctx.session && existingEvent?.orgId
            ? await checkHasRoleOnOrg({
                orgId: existingEvent.orgId,
                session: ctx.session,
                db: ctx.db,
                roleName: "editor",
              })
            : { success: false };

      const [existingLocation] = input.locationId
        ? await ctx.db
            .select()
            .from(schema.locations)
            .where(eq(schema.locations.id, input.locationId))
        : [null];

      const canEditLocation =
        existingLocation === null
          ? { success: true }
          : ctx.session && existingLocation?.orgId
            ? await checkHasRoleOnOrg({
                orgId: existingLocation.orgId,
                session: ctx.session,
                db: ctx.db,
                roleName: "editor",
              })
            : { success: false };

      const canEditRegion = ctx.session
        ? await checkHasRoleOnOrg({
            orgId: input.regionId,
            session: ctx.session,
            db: ctx.db,
            roleName: "editor",
          })
        : { success: false };

      // Immediately update if user has permission
      if (
        canEditRegion.success &&
        canEditEvent.success &&
        canEditLocation.success &&
        ctx.session?.user?.email
      ) {
        const result = await applyUpdateRequest(ctx, {
          ...input,
          reviewedBy: ctx.session?.user?.email,
        });

        // Notify webhooks and invalidate cache about the auto-approved update
        if (result.status === "approved") {
          notifyMapDataChange({
            type: input.eventId ? "map.updated" : "map.created",
            eventId: result.updateRequest?.eventId ?? undefined,
            locationId: result.updateRequest?.locationId ?? undefined,
            orgId:
              result.updateRequest?.aoId ??
              result.updateRequest?.regionId ??
              undefined,
          });
        }

        return { status: result.status, updateRequest: result.updateRequest };
      }

      const updateRequest: typeof schema.updateRequests.$inferInsert = {
        ...input,
        submittedBy,
        submitterValidated: false,
        reviewedBy: null,
        reviewedAt: null,
        eventMeta: input.eventMeta,
      };

      const [inserted] = await ctx.db
        .insert(schema.updateRequests)
        .values(updateRequest)
        .returning();

      if (!inserted) {
        throw new Error("Failed to insert update request");
      }
      const [region] = await ctx.db
        .select()
        .from(schema.orgs)
        .where(eq(schema.orgs.id, input.regionId));

      if (!region) {
        throw new Error("Failed to find region");
      }

      // Notify admins and editors about the new request
      if (inserted.status === "pending") {
        try {
          await notifyMapChangeRequest({
            db: ctx.db,
            requestId: inserted.id,
          });
        } catch (error) {
          logError(
            "api.request.notification_failed",
            { requestId: inserted.id, flow: "submit_update_request" },
            error,
          );
          // Don't fail the request if notification fails
        }
      }

      return {
        status: "pending" as const,
        updateRequest: omit(inserted, ["token"]),
      };
    }),
  validateDeleteByAdmin: editorProcedure
    .input(DeleteRequestSchema)
    .route({
      method: "POST",
      path: "/validate-delete-by-admin",
      tags: ["request"],
      summary: "Approve delete request",
      description: "Approve and apply a delete request as an admin",
    })
    .output(
      z.object({
        status: z
          .enum(UpdateRequestStatus)
          .describe("The status of the request"),
        deleteRequest: z.object({
          id: z.string().optional().describe("Request ID"),
          regionId: z.number().optional().describe("Region ID"),
          eventId: z.number().nullable().optional().describe("Event ID"),
          eventName: z.string().nullable().optional().describe("Event name"),
          submittedBy: z.string().optional().describe("Submitter email"),
          reviewedBy: z
            .string()
            .nullable()
            .optional()
            .describe("Reviewer email"),
        }),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const result = await applyDeleteRequest(ctx, {
        ...input,
        reviewedBy: ctx.session?.user?.email,
      });

      // Notify webhooks and invalidate cache about the admin-approved delete
      if (result.status === "approved") {
        notifyMapDataChange({
          type: "map.deleted",
          eventId: input.eventId,
          orgId: input.regionId,
        });
      }

      return { status: result.status, deleteRequest: result.deleteRequest };
    }),
  validateSubmissionByAdmin: editorProcedure
    .input(RequestInsertSchema)
    .route({
      method: "POST",
      path: "/validate-submission-by-admin",
      tags: ["request"],
      summary: "Approve update request",
      description: "Approve and apply an update request as an admin",
    })
    .output(
      z.object({
        status: z
          .enum(UpdateRequestStatus)
          .describe("The status of the request"),
        updateRequest: z
          .object({
            id: z.string().optional().describe("Request ID"),
            regionId: z.number().optional().describe("Region ID"),
            eventId: z.number().nullable().optional().describe("Event ID"),
            eventName: z.string().optional().describe("Event name"),
            submittedBy: z.string().optional().describe("Submitter email"),
            reviewedBy: z
              .string()
              .nullable()
              .optional()
              .describe("Reviewer email"),
            reviewedAt: z
              .string()
              .nullable()
              .optional()
              .describe("Review date"),
            status: z
              .enum(UpdateRequestStatus)
              .optional()
              .describe("Request status"),
            meta: z.any().nullable().optional().describe("Request metadata"),
            created: z
              .string()
              .optional()
              .describe("Date the request was created"),
            updated: z
              .string()
              .optional()
              .describe("Date the request was last updated"),
            requestType: z
              .enum(RequestType)
              .optional()
              .describe("Request type"),
          })
          .optional()
          .describe(
            "The update request details (present when requestType is not delete_event)",
          ),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const reviewedBy = ctx.session?.user?.email;
      if (!reviewedBy) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Validated by is required",
        });
      }

      const roleCheckResult = await checkHasRoleOnOrg({
        orgId: input.regionId,
        session: ctx.session,
        db: ctx.db,
        roleName: "editor",
      });

      if (!roleCheckResult.success) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "You are not authorized to edit this region",
        });
      }

      if (input.requestType === "delete_event") {
        const result = await applyDeleteRequest(ctx, {
          ...input,
          regionId: input.regionId,
          reviewedBy: "email",
          // Type check
          eventDayOfWeek: input.eventDayOfWeek ?? undefined,
          eventMeta: input.eventMeta ?? undefined,
        });

        // Notify webhooks and invalidate cache about the admin-approved delete
        if (result.status === "approved") {
          notifyMapDataChange({
            type: "map.deleted",
            eventId: input.eventId ?? undefined,
            locationId: input.locationId ?? undefined,
            orgId: input.regionId,
          });
        }

        return {
          status: result.status,
          deleteRequest: result.deleteRequest,
        };
      } else {
        const result = await applyUpdateRequest(ctx, {
          ...input,
          regionId: input.regionId,
          reviewedBy: "email",
        });

        // Notify webhooks and invalidate cache about the admin-approved update
        if (result.status === "approved") {
          notifyMapDataChange({
            type: input.eventId ? "map.updated" : "map.created",
            eventId: result.updateRequest?.eventId ?? undefined,
            locationId: result.updateRequest?.locationId ?? undefined,
            orgId:
              result.updateRequest?.aoId ??
              result.updateRequest?.regionId ??
              undefined,
          });
        }

        return {
          status: result.status,
          updateRequest: result.updateRequest,
        };
      }
    }),
  rejectSubmission: editorProcedure
    .input(z.object({ id: z.string() }))
    .route({
      method: "POST",
      path: "/reject-submission",
      tags: ["request"],
      summary: "Reject request",
      description: "Reject a pending map change request",
    })
    .output(
      z.object({
        status: z
          .enum(UpdateRequestStatus)
          .describe("The status of the request"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const [updateRequest] = await ctx.db
        .select()
        .from(schema.updateRequests)
        .where(eq(schema.updateRequests.id, input.id));

      if (!updateRequest) {
        throw new Error("Failed to find update request");
      }

      const { success: hasPermissionToEditThisRegion } =
        await checkHasRoleOnOrg({
          orgId: updateRequest.regionId,
          session: ctx.session,
          db: ctx.db,
          roleName: "editor",
        });

      if (!hasPermissionToEditThisRegion) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "You are not authorized to edit this region",
        });
      }
      await ctx.db
        .update(schema.updateRequests)
        .set({ status: "rejected" })
        .where(eq(schema.updateRequests.id, input.id));

      return {
        status: "rejected",
      };
    }),
};

const applyDeleteRequest = async (
  ctx: Context,
  deleteRequest: Partial<z.infer<typeof RequestInsertSchema>>,
): Promise<DeleteRequestResponse> => {
  if (deleteRequest.eventId != undefined) {
    await ctx.db
      .delete(schema.eventsXEventTypes)
      .where(eq(schema.eventsXEventTypes.eventId, deleteRequest.eventId));
    await ctx.db
      .update(schema.events)
      .set({ isActive: false })
      .where(eq(schema.events.id, deleteRequest.eventId));
    await ctx.db
      .update(schema.updateRequests)
      .set({ status: "approved" })
      .where(
        and(
          eq(schema.updateRequests.requestType, "delete_event"),
          eq(schema.updateRequests.eventId, deleteRequest.eventId),
        ),
      );
  } else if (deleteRequest.locationId != undefined) {
    await ctx.db
      .update(schema.locations)
      .set({ isActive: false })
      .where(eq(schema.locations.id, deleteRequest.locationId));
  } else {
    throw new Error("Nothing to delete");
  }

  return {
    status: "approved" as const,
    deleteRequest: omit(deleteRequest, ["token"]),
  };
};

const applyUpdateRequest = async (
  ctx: Context,
  updateRequest: Omit<
    z.infer<typeof RequestInsertSchema>,
    "meta" | "eventMeta" | "eventDayOfWeek"
  > & {
    reviewedBy: string;
    meta?: UpdateRequestMeta | null;
    eventMeta?: EventMeta | null;
    eventDayOfWeek?: DayOfWeek | null;
  },
): Promise<UpdateRequestResponse> => {
  // Promote a pending change-request logo (org-logos/{orgId}-{requestId}.jpg)
  // to the canonical org path (org-logos/{orgId}.jpg), overwriting any previous
  // logo and removing the pending file, so the DB stores the canonical URL.
  if (updateRequest.aoLogo) {
    try {
      const storage = getPublicImageStorage();
      if (storage.isAllowedPublicImageUrl(updateRequest.aoLogo)) {
        updateRequest.aoLogo = await storage.promoteOrgLogo(
          updateRequest.aoLogo,
        );
      }
    } catch (error) {
      // Don't fail approval on storage issues; keep the submitted URL.
      logError(
        "api.request.logo_promotion_failed",
        { aoLogo: updateRequest.aoLogo },
        error,
      );
    }
  }

  // LOCATION
  if (updateRequest.locationId == undefined) {
    // INSERT LOCATION
    const newLocation: typeof schema.locations.$inferInsert = {
      name: updateRequest.locationName ?? "",
      description: updateRequest.locationDescription ?? "",
      addressStreet: updateRequest.locationAddress ?? "",
      addressStreet2: updateRequest.locationAddress2 ?? "",
      addressCity: updateRequest.locationCity ?? "",
      addressState: updateRequest.locationState ?? "",
      addressZip: updateRequest.locationZip ?? "",
      addressCountry: updateRequest.locationCountry ?? "",
      latitude: updateRequest.locationLat,
      longitude: updateRequest.locationLng,
      orgId: updateRequest.regionId,
      email: updateRequest.locationContactEmail,
      isActive: true,
    };
    const [location] = await ctx.db
      .insert(schema.locations)
      .values(newLocation)
      .returning();

    if (!location) {
      throw new Error("Failed to find location");
    }
    updateRequest.locationId = location.id;
  } else {
    const [location] = await ctx.db
      .update(schema.locations)
      .set({
        description: updateRequest.locationDescription,
        addressStreet: updateRequest.locationAddress,
        addressStreet2: updateRequest.locationAddress2,
        addressCity: updateRequest.locationCity,
        addressState: updateRequest.locationState,
        addressZip: updateRequest.locationZip,
        addressCountry: updateRequest.locationCountry,
        latitude: updateRequest.locationLat,
        longitude: updateRequest.locationLng,
        email: updateRequest.locationContactEmail,
      })
      .where(eq(schema.locations.id, updateRequest.locationId))
      .returning();

    if (!location) {
      throw new Error("Failed to find location to update");
    }
  }

  // AO
  if (updateRequest.aoId == undefined) {
    // INSERT AO
    logDebug("api.request.inserting_ao", {
      regionId: updateRequest.regionId,
      locationId: updateRequest.locationId,
    });
    const [ao] = await ctx.db
      .insert(schema.orgs)
      .values({
        parentId: updateRequest.regionId,
        orgType: "ao",
        website: updateRequest.aoWebsite,
        defaultLocationId: updateRequest.locationId,
        name: updateRequest.aoName ?? "",
        isActive: true,
        logoUrl: updateRequest.aoLogo,
      })
      .returning();

    if (!ao) throw new Error("Failed to insert AO");
    updateRequest.aoId = ao.id;
  } else {
    const [ao] = await ctx.db
      .select()
      .from(schema.orgs)
      .where(eq(schema.orgs.id, updateRequest.aoId));

    if (ao?.orgType !== "ao") {
      throw new Error("Failed to find ao to update. Does the AO exist?");
    }

    // UPDATE AO
    await ctx.db
      .update(schema.orgs)
      .set({
        parentId: updateRequest.regionId,
        website: updateRequest.aoWebsite,
        defaultLocationId: updateRequest.locationId,
        name: updateRequest.aoName ?? ao.name,
        logoUrl: updateRequest.aoLogo,
      })
      .where(eq(schema.orgs.id, updateRequest.aoId));
  }

  // EVENT - Handle event first to get eventId
  let eventId: number;
  if (updateRequest.eventId != undefined) {
    const [_updated] = await ctx.db
      .update(schema.events)
      .set({
        name: updateRequest.eventName,
        locationId: updateRequest.locationId,
        description: updateRequest.eventDescription,
        // Use undefined to not remove the existing value
        startDate: updateRequest.eventStartDate ?? undefined,
        endDate: updateRequest.eventEndDate ?? undefined,
        startTime: updateRequest.eventStartTime ?? undefined,
        endTime: updateRequest.eventEndTime ?? undefined,
        dayOfWeek: updateRequest.eventDayOfWeek ?? undefined,
        seriesId: updateRequest.eventSeriesId,
        isActive: true,
        highlight: false,
        orgId: updateRequest.aoId,
        recurrencePattern: updateRequest.eventRecurrencePattern,
        recurrenceInterval: updateRequest.eventRecurrenceInterval,
        indexWithinInterval: updateRequest.eventIndexWithinInterval,
        meta: updateRequest.eventMeta,
        email: updateRequest.eventContactEmail,
      })
      .where(eq(schema.events.id, updateRequest.eventId))
      .returning();

    if (!_updated) {
      throw new Error("Failed to update event");
    }
    eventId = _updated.id;
  } else {
    logDebug("api.request.inserting_event", {
      aoId: updateRequest.aoId,
      eventId: updateRequest.eventId,
      locationId: updateRequest.locationId,
    });
    const newEvent: typeof schema.events.$inferInsert = {
      name: updateRequest.eventName,
      locationId: updateRequest.locationId,
      description: updateRequest.eventDescription,
      startDate: updateRequest.eventStartDate ?? dayjs().format("YYYY-MM-DD"),
      endDate: updateRequest.eventEndDate ?? undefined,
      startTime: updateRequest.eventStartTime ?? undefined,
      endTime: updateRequest.eventEndTime ?? undefined,
      seriesId: updateRequest.eventSeriesId,
      isActive: true,
      highlight: false,
      dayOfWeek: updateRequest.eventDayOfWeek,
      orgId: updateRequest.aoId,
      recurrencePattern: updateRequest.eventRecurrencePattern,
      recurrenceInterval: updateRequest.eventRecurrenceInterval,
      indexWithinInterval: updateRequest.eventIndexWithinInterval,
      meta: updateRequest.eventMeta,
      email: updateRequest.eventContactEmail,
    };

    const [_inserted] = await ctx.db
      .insert(schema.events)
      .values(newEvent)
      .returning();

    if (!_inserted) {
      throw new Error("Failed to insert event");
    }
    eventId = _inserted.id;
  }

  // Now update the request with the eventId
  const updateRequestInsertData: typeof schema.updateRequests.$inferInsert = {
    ...updateRequest,
    eventId, // Use the eventId we just got from creating/updating the event
    status: "approved",
    reviewedAt: new Date().toISOString(),
  };

  const [updated] = await ctx.db
    .insert(schema.updateRequests)
    .values(updateRequestInsertData)
    .onConflictDoUpdate({
      target: [schema.updateRequests.id],
      set: updateRequestInsertData,
    })
    .returning();

  if (!updated) {
    throw new Error("Failed to update update request");
  }

  // Update event types
  await ctx.db
    .delete(schema.eventsXEventTypes)
    .where(eq(schema.eventsXEventTypes.eventId, eventId));

  await ctx.db.insert(schema.eventsXEventTypes).values(
    updateRequest.eventTypeIds?.map((id: number) => ({
      eventId,
      eventTypeId: id,
    })) ?? [],
  );

  return {
    status: "approved",
    updateRequest: omit(updated, ["token"]),
  };
};
