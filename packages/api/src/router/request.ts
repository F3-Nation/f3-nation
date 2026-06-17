import { ORPCError } from "@orpc/server";
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
  sql,
} from "@acme/db";
import type { OrgType, UserRole } from "@acme/shared/app/enums";
import { DayOfWeek } from "@acme/shared/app/enums";
import { RequestType, UpdateRequestStatus } from "@acme/shared/app/enums";
import { arrayOrSingle, parseSorting } from "@acme/shared/app/functions";
import {
  CreateAOAndLocationAndEventSchema,
  CreateEventSchema,
  DeleteAOSchema,
  DeleteEventSchema,
  EditAOAndLocationSchema,
  EditEventSchema,
  MoveAOToDifferentLocationSchema,
  MoveAOToDifferentRegionSchema,
  MoveAOToNewLocationSchema,
  MoveEventToDifferentAOSchema,
  MoveEventToNewAOSchema,
  MoveEventToNewLocationSchema,
} from "@acme/validators/request-schemas";

import type { UpdateRequestData } from "../lib/types";
import type { Context } from "../shared";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { getEditableOrgIdsForUser } from "../get-editable-org-ids";
import { getSortingColumns } from "../get-sorting-columns";
import { checkUpdatePermissions } from "../lib/check-update-permissions";
import {
  handleCreateEvent,
  handleCreateLocationAndEvent,
  handleDeleteAO,
  handleDeleteEvent,
  handleEditAOAndLocation,
  handleEditEvent,
  handleMoveAOToDifferentLocation,
  handleMoveAOToDifferentRegion,
  handleMoveAOToNewLocation,
  handleMoveEventToDifferentAO,
  handleMoveEventToNewAO,
  handleMoveEventToNewLocation,
  recordUpdateRequest,
} from "../lib/update-request-handlers";
import { notifyMapChangeRequest } from "../services/map-request-notification";
import { editorProcedure, protectedProcedure } from "../shared";
import { withPagination } from "../with-pagination";

const ValidateSubmissionByAdminSchema = z.discriminatedUnion("requestType", [
  CreateAOAndLocationAndEventSchema,
  CreateEventSchema,
  EditEventSchema,
  EditAOAndLocationSchema,
  MoveAOToDifferentRegionSchema,
  MoveAOToDifferentLocationSchema,
  MoveAOToNewLocationSchema,
  MoveEventToDifferentAOSchema,
  MoveEventToNewAOSchema,
  MoveEventToNewLocationSchema,
  DeleteEventSchema,
  DeleteAOSchema,
]);

const normalizeAdminRequestInput = (input: Record<string, unknown>) => {
  const normalized = { ...input };
  const meta =
    normalized.meta && typeof normalized.meta === "object"
      ? (normalized.meta as Record<string, unknown>)
      : {};
  const usesOriginalIds = [
    "edit_ao_and_location",
    "create_event",
    "edit_event",
  ].includes(String(normalized.requestType));
  const usesCurrentValues = ["edit_ao_and_location", "edit_event"].includes(
    String(normalized.requestType),
  );

  if (usesOriginalIds) {
    normalized.originalRegionId ??= normalized.regionId;
    normalized.originalAoId ??= normalized.aoId;
    normalized.originalLocationId ??= normalized.locationId;
    normalized.originalEventId ??= normalized.eventId;
  }

  if (normalized.requestType === "create_ao_and_location_and_event") {
    normalized.originalRegionId ??=
      meta.originalRegionId ?? normalized.regionId;
  }

  if (normalized.requestType === "move_event_to_different_ao") {
    normalized.originalRegionId ??= meta.originalRegionId;
    normalized.originalAoId ??= meta.originalAoId;
    normalized.originalEventId ??= meta.originalEventId ?? normalized.eventId;
    normalized.newRegionId ??= meta.newRegionId ?? normalized.regionId;
    normalized.newAoId ??= meta.newAoId ?? normalized.aoId;
    normalized.newLocationId ??= meta.newLocationId ?? normalized.locationId;
  }

  if (normalized.requestType === "move_ao_to_different_location") {
    normalized.originalRegionId ??=
      meta.originalRegionId ?? normalized.regionId;
    normalized.originalAoId ??= meta.originalAoId ?? normalized.aoId;
    normalized.originalLocationId ??= meta.originalLocationId;
    normalized.newLocationId ??= meta.newLocationId ?? normalized.locationId;
  }

  if (normalized.requestType === "move_ao_to_new_location") {
    normalized.originalRegionId ??=
      meta.originalRegionId ?? normalized.regionId;
    normalized.originalAoId ??= meta.originalAoId ?? normalized.aoId;
    normalized.originalLocationId ??=
      meta.originalLocationId ?? normalized.locationId;
    normalized.currentValues ??= {};
  }

  if (normalized.requestType === "move_ao_to_different_region") {
    normalized.originalRegionId ??= meta.originalRegionId;
    normalized.originalAoId ??= meta.originalAoId ?? normalized.aoId;
    normalized.newRegionId ??= meta.newRegionId ?? normalized.regionId;
  }

  if (normalized.requestType === "move_event_to_new_location") {
    normalized.originalRegionId ??=
      meta.originalRegionId ?? normalized.regionId;
    normalized.originalEventId ??= meta.originalEventId ?? normalized.eventId;
    normalized.originalLocationId ??=
      meta.originalLocationId ?? normalized.locationId;
    normalized.currentValues ??= {};
  }

  if (normalized.requestType === "delete_event") {
    normalized.originalRegionId ??=
      meta.originalRegionId ?? normalized.regionId;
    normalized.originalEventId ??= meta.originalEventId ?? normalized.eventId;
  }

  if (normalized.requestType === "delete_ao") {
    normalized.originalRegionId ??=
      meta.originalRegionId ?? normalized.regionId;
    normalized.originalAoId ??= meta.originalAoId ?? normalized.aoId;
  }

  if (usesCurrentValues) {
    normalized.currentValues ??= {};
  }

  return normalized;
};

const updateRequestMutationOutput = z.object({
  status: z.enum(UpdateRequestStatus).describe("The status of the request"),
  updateRequest: z.object({
    id: z.string().describe("Request ID"),
  }),
});

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
      const oldEvent = aliasedTable(schema.events, "old_event");
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
        oldWorkoutName: oldEvent.name,
        newWorkoutName: schema.updateRequests.eventName,
        oldRegionName: oldRegionOrg.name,
        newRegionName: newRegionOrg.name,
        oldAoName: oldAoOrg.name,
        newAoName: schema.updateRequests.aoName,
        oldDayOfWeek: oldEvent.dayOfWeek,
        newDayOfWeek: schema.updateRequests.eventDayOfWeek,
        oldStartTime: oldEvent.startTime,
        newStartTime: schema.updateRequests.eventStartTime,
        oldEndTime: oldEvent.endTime,
        newEndTime: schema.updateRequests.eventEndTime,
        oldDescription: oldEvent.description,
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
        .leftJoin(oldEvent, eq(schema.updateRequests.eventId, oldEvent.id))
        .leftJoin(
          oldAoOrg,
          eq(
            oldAoOrg.id,
            sql<number>`COALESCE(${oldEvent.orgId}, ${schema.updateRequests.aoId})`,
          ),
        )
        .leftJoin(oldRegionOrg, eq(oldRegionOrg.id, oldAoOrg.parentId))
        .leftJoin(
          oldLocation,
          eq(
            oldLocation.id,
            sql<number>`COALESCE(${oldEvent.locationId}, ${schema.updateRequests.locationId})`,
          ),
        )
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
            eventName: z.string().nullable().describe("Event name"),
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
      let results: {
        success: boolean;
        mode:
          | "public"
          | "org-admin"
          | "mtndev-override"
          | "direct-permission"
          | "no-permission";
        orgId: number | null;
        roleName: UserRole | null;
      }[] = [];

      const session = ctx.session;
      if (!session) {
        results = input.orgIds.map((orgId) => ({
          success: false,
          mode: "public",
          orgId,
          roleName: "editor" as const,
        }));
      } else {
        results = await Promise.all(
          input.orgIds.map((orgId) =>
            checkHasRoleOnOrg({
              orgId,
              session,
              db: ctx.db,
              roleName: "editor" as const,
            }),
          ),
        );
      }
      return { results };
    }),
  submitCreateAOAndLocationAndEventRequest: protectedProcedure
    .input(CreateAOAndLocationAndEventSchema)
    .route({
      method: "POST",
      path: "/create-ao-and-location-and-event-request",
      tags: ["request"],
      summary: "Submit create ao and location and event request",
      description: "Submit a request to create an ao, location, and event",
    })
    .output(
      z.object({
        status: z
          .enum(UpdateRequestStatus)
          .describe("The status of the request"),
        updateRequest: z.object({
          id: z.string().describe("Request ID"),
        }),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const handler = handleCreateLocationAndEvent;
      return await handleRequest({ ctx, input, handler });
    }),
  submitCreateEventRequest: protectedProcedure
    .input(CreateEventSchema)
    .route({
      method: "POST",
      path: "/create-event-request",
      tags: ["request"],
      summary: "Submit create event request",
      description: "Submit a request to create an event",
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
      const handler = handleCreateEvent;
      return await handleRequest({ ctx, input, handler });
    }),
  submitEditEventRequest: protectedProcedure
    .input(EditEventSchema)
    .handler(async ({ context: ctx, input }) => {
      const handler = handleEditEvent;
      return await handleRequest({ ctx, input, handler });
    }),
  submitEditAOAndLocationRequest: protectedProcedure
    .input(EditAOAndLocationSchema)
    .handler(async ({ context: ctx, input }) => {
      const handler = handleEditAOAndLocation;
      return await handleRequest({ ctx, input, handler });
    }),
  submitMoveAOToDifferentRegionRequest: protectedProcedure
    .input(MoveAOToDifferentRegionSchema)
    .handler(async ({ context: ctx, input }) => {
      const handler = handleMoveAOToDifferentRegion;
      return await handleRequest({ ctx, input, handler });
    }),
  submitMoveAOToDifferentLocationRequest: protectedProcedure
    .input(MoveAOToDifferentLocationSchema)
    .handler(async ({ context: ctx, input }) => {
      const handler = handleMoveAOToDifferentLocation;
      return await handleRequest({ ctx, input, handler });
    }),
  submitMoveAOToNewLocationRequest: protectedProcedure
    .input(MoveAOToNewLocationSchema)
    .handler(async ({ context: ctx, input }) => {
      const handler = handleMoveAOToNewLocation;
      return await handleRequest({ ctx, input, handler });
    }),
  submitMoveEventToDifferentAoRequest: protectedProcedure
    .input(MoveEventToDifferentAOSchema)
    .handler(async ({ context: ctx, input }) => {
      const handler = handleMoveEventToDifferentAO;
      return await handleRequest({ ctx, input, handler });
    }),
  submitMoveEventToNewAoRequest: protectedProcedure
    .input(MoveEventToNewAOSchema)
    .handler(async ({ context: ctx, input }) => {
      const handler = handleMoveEventToNewAO;
      return await handleRequest({ ctx, input, handler });
    }),
  submitMoveEventToNewLocationRequest: protectedProcedure
    .input(MoveEventToNewLocationSchema)
    .handler(async ({ context: ctx, input }) => {
      const handler = handleMoveEventToNewLocation;
      return await handleRequest({ ctx, input, handler });
    }),
  submitDeleteEventRequest: protectedProcedure
    .input(DeleteEventSchema)
    .handler(async ({ context: ctx, input }) => {
      const handler = handleDeleteEvent;
      return await handleRequest({ ctx, input, handler });
    }),
  submitDeleteAORequest: protectedProcedure
    .input(DeleteAOSchema)
    .handler(async ({ context: ctx, input }) => {
      const handler = handleDeleteAO;
      return await handleRequest({ ctx, input, handler });
    }),
  validateSubmissionByAdmin: editorProcedure
    .input(z.record(z.string(), z.unknown()))
    .route({
      method: "POST",
      path: "/validate-submission-by-admin",
      tags: ["request"],
      summary: "Validate request by admin",
      description: "Approve and apply a pending map change request",
    })
    .output(updateRequestMutationOutput)
    .handler(async ({ context: ctx, input }) => {
      const normalizedInput = normalizeAdminRequestInput(input);
      const parsedInput =
        ValidateSubmissionByAdminSchema.parse(normalizedInput);

      switch (parsedInput.requestType) {
        case "create_ao_and_location_and_event":
          return await handleRequest({
            ctx,
            input: parsedInput,
            handler: handleCreateLocationAndEvent,
          });
        case "create_event":
          return await handleRequest({
            ctx,
            input: parsedInput,
            handler: handleCreateEvent,
          });
        case "edit_event":
          return await handleRequest({
            ctx,
            input: parsedInput,
            handler: handleEditEvent,
          });
        case "edit_ao_and_location":
          return await handleRequest({
            ctx,
            input: parsedInput,
            handler: handleEditAOAndLocation,
          });
        case "move_ao_to_different_region":
          return await handleRequest({
            ctx,
            input: parsedInput,
            handler: handleMoveAOToDifferentRegion,
          });
        case "move_ao_to_different_location":
          return await handleRequest({
            ctx,
            input: parsedInput,
            handler: handleMoveAOToDifferentLocation,
          });
        case "move_ao_to_new_location":
          return await handleRequest({
            ctx,
            input: parsedInput,
            handler: handleMoveAOToNewLocation,
          });
        case "move_event_to_different_ao":
          return await handleRequest({
            ctx,
            input: parsedInput,
            handler: handleMoveEventToDifferentAO,
          });
        case "move_event_to_new_ao":
          return await handleRequest({
            ctx,
            input: parsedInput,
            handler: handleMoveEventToNewAO,
          });
        case "move_event_to_new_location":
          return await handleRequest({
            ctx,
            input: parsedInput,
            handler: handleMoveEventToNewLocation,
          });
        case "delete_event":
          return await handleRequest({
            ctx,
            input: parsedInput,
            handler: handleDeleteEvent,
          });
        case "delete_ao":
          return await handleRequest({
            ctx,
            input: parsedInput,
            handler: handleDeleteAO,
          });
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

interface CheckRequestInput {
  originalEventId?: number | null;
  originalLocationId?: number | null;
  newLocationId?: number | null;
  originalRegionId?: number | null;
  newRegionId?: number | null;
  submittedBy: string;
}

const checkRequest = async ({
  input,
  ctx,
}: {
  input: CheckRequestInput;
  ctx: Context;
}) => {
  const regionId = input.newRegionId ?? input.originalRegionId;
  if (!regionId) {
    throw new Error("Region id is required");
  }

  const submittedBy = ctx.session?.user?.email ?? input.submittedBy;
  if (!submittedBy) {
    throw new Error("Submitted by is required");
  }

  const email = ctx.session?.user?.email;
  if (!email) {
    throw new Error("Email is required");
  }

  const permissions = await checkUpdatePermissions({
    input,
    ctx,
  });

  return {
    email,
    permissions,
    regionId,
    submittedBy,
  };
};

const notifyPendingRequest = async ({
  ctx,
  result,
}: {
  ctx: Context;
  result: {
    status: "pending";
    updateRequest: { id: string };
  };
}) => {
  // Notify admins and editors about the new request
  if (result.status === "pending") {
    try {
      await notifyMapChangeRequest({
        db: ctx.db,
        requestId: result.updateRequest.id,
      });
    } catch (error) {
      console.error("Failed to send notification", { error });
      // Don't fail the request if notification fails
    }
  }
};

type HandleableRequestInput = CheckRequestInput & {
  requestType: UpdateRequestData["requestType"];
  submittedBy: string;
  reviewedBy?: string | null;
  meta?: Record<string, unknown> | null;
  eventMeta?: Record<string, unknown> | null;
  eventDayOfWeek?: string | null;
};

interface HandleRequestInput<T extends HandleableRequestInput> {
  ctx: Context;
  input: T;
  handler: (ctx: Context, input: T) => Promise<unknown>;
}

const handleRequest = async <T extends HandleableRequestInput>({
  ctx,
  input,
  handler,
}: HandleRequestInput<T>): Promise<{
  status: "approved" | "pending" | "rejected";
  updateRequest: { id: string };
}> => {
  const { permissions } = await checkRequest({ input, ctx });
  const updateRequestData = {
    ...input,
  } as Pick<UpdateRequestData, "requestType" | "submittedBy"> &
    Record<string, unknown>;
  if (permissions.success) {
    await handler(ctx, input);
    const updateRequest = await recordUpdateRequest({
      ctx,
      updateRequest: updateRequestData,
      status: "approved",
    });
    const result = { status: "approved" as const, updateRequest };
    return result;
  } else {
    const updateRequest = await recordUpdateRequest({
      ctx,
      updateRequest: updateRequestData,
      status: "pending",
    });
    const result = { status: "pending" as const, updateRequest };
    await notifyPendingRequest({ ctx, result });
    return result;
  }
};
