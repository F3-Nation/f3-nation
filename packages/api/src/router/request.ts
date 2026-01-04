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
} from "@acme/db";
import type { OrgType, UserRole } from "@acme/shared/app/enums";
import { UpdateRequestStatus } from "@acme/shared/app/enums";
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

import type { CheckUpdatePermissionsInput } from "../lib/check-update-permissions";
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

export const requestRouter = {
  all: editorProcedure
    .input(
      z
        .object({
          pageIndex: z.coerce.number().optional(),
          pageSize: z.coerce.number().optional(),
          sorting: parseSorting(),
          searchTerm: z.string().optional(),
          onlyMine: z.coerce.boolean().optional(),
          statuses: arrayOrSingle(z.enum(UpdateRequestStatus)).optional(),
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
        .leftJoin(oldAoOrg, eq(oldAoOrg.id, oldEvent.orgId))
        .leftJoin(oldRegionOrg, eq(oldRegionOrg.id, oldAoOrg.parentId))
        .leftJoin(oldLocation, eq(oldLocation.id, oldEvent.locationId))
        .where(where);

      const requests = usePagination
        ? await withPagination(query.$dynamic(), sortedColumns, offset, limit)
        : await query.orderBy(...sortedColumns);

      return { requests, totalCount: totalCount?.count ?? 0 };
    }),
  byId: editorProcedure
    .input(z.object({ id: z.string() }))
    .route({
      method: "GET",
      path: "/id/{id}",
      tags: ["request"],
      summary: "Get request by ID",
      description:
        "Retrieve detailed information about a specific map change request",
    })
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
  rejectSubmission: editorProcedure
    .input(z.object({ id: z.string() }))
    .route({
      method: "POST",
      path: "/reject-submission",
      tags: ["request"],
      summary: "Reject request",
      description: "Reject a pending map change request",
    })
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
    }),
};

interface CheckRequestInput extends CheckUpdatePermissionsInput {
  submittedBy: string;
}

const checkRequest = async ({
  input,
  ctx,
}: {
  input: CheckUpdatePermissionsInput & {
    submittedBy: string;
  };
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

interface HandleRequestInput<T extends UpdateRequestData & CheckRequestInput> {
  ctx: Context;
  input: T;
  handler: (ctx: Context, input: T) => Promise<unknown>;
}

const handleRequest = async <T extends UpdateRequestData & CheckRequestInput>({
  ctx,
  input,
  handler,
}: HandleRequestInput<T>): Promise<{
  status: "approved" | "pending" | "rejected";
  updateRequest: { id: string };
}> => {
  const { permissions } = await checkRequest({ input, ctx });
  if (permissions.success) {
    await handler(ctx, input);
    const updateRequest = await recordUpdateRequest({
      ctx,
      updateRequest: input,
      status: "approved",
    });
    const result = { status: "approved" as const, updateRequest };
    return result;
  } else {
    const updateRequest = await recordUpdateRequest({
      ctx,
      updateRequest: input,
      status: "pending",
    });
    const result = { status: "pending" as const, updateRequest };
    await notifyPendingRequest({ ctx, result });
    return result;
  }
};
