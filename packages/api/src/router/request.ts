import { ORPCError } from "@orpc/server";
import dayjs from "dayjs";
import omit from "lodash/omit";
import { z } from "zod";

import type { DayOfWeek, OrgType } from "@acme/shared/app/enums";
import type { EventMeta, UpdateRequestMeta } from "@acme/shared/app/types";
import type {
  DeleteRequestResponse,
  UpdateRequestResponse,
} from "@acme/validators";
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
import { UpdateRequestStatus } from "@acme/shared/app/enums";
import { arrayOrSingle, parseSorting } from "@acme/shared/app/functions";
import { DeleteRequestSchema, RequestInsertSchema } from "@acme/validators";

import type { Context } from "../shared";
import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { getEditableOrgIdsForUser } from "../get-editable-org-ids";
import { getSortingColumns } from "../get-sorting-columns";
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
      return request;
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
      return !!request;
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
      const session = ctx.session;
      if (!session) {
        return input.orgIds.map((orgId) => ({
          success: false,
          mode: "public",
          orgId,
          roleName: "editor",
        }));
      }

      const results = await Promise.all(
        input.orgIds.map((orgId) =>
          checkHasRoleOnOrg({
            orgId,
            session,
            db: ctx.db,
            roleName: "editor",
          }),
        ),
      );
      return results;
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
        return result;
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
          console.error("Failed to send notification", { error });
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
        return result;
      }

      const updateRequest: typeof schema.updateRequests.$inferInsert = {
        ...input,
        submittedBy,
        submitterValidated: false,
        reviewedBy: null,
        reviewedAt: null,
        eventMeta: input.eventMeta as EventMeta,
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
          console.error("Failed to send notification", { error });
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
    .handler(async ({ context: ctx, input }) => {
      const result = await applyDeleteRequest(ctx, {
        ...input,
        reviewedBy: ctx.session?.user?.email,
      });
      return result;
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

export const applyDeleteRequest = async (
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

export const applyUpdateRequest = async (
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
    console.log("inserting ao", updateRequest);
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
    console.log("inserting event", updateRequest);
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
    updateRequest.eventTypeIds?.map((id) => ({
      eventId,
      eventTypeId: id,
    })) ?? [],
  );

  return {
    status: "approved",
    updateRequest: omit(updated, ["token"]),
  };
};
