import { ORPCError } from "@orpc/server";
import { z } from "zod";

import {
  and,
  asc,
  count,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  schema,
  sql,
} from "@acme/db";
import { OrgType } from "@acme/shared/app/enums";
import { arrayOrSingle } from "@acme/shared/app/functions";
import {
  AddPositionAssignmentSchema,
  GetAllPositionAssignmentsSchema,
  PositionInsertSchema,
  UpdatePositionAssignmentsSchema,
} from "@acme/validators";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { getDescendantOrgIds } from "../get-descendant-org-ids";
import { getEditableOrgIdsForUser } from "../get-editable-org-ids";
import { editorProcedure, protectedProcedure } from "../shared";

export const positionRouter = {
  /**
   * Get all positions available for an org.
   * Includes:
   * - Nation-wide positions (orgId is null)
   * - Org-specific positions (orgId matches the query orgId)
   *
   * Filters by orgType if provided (ao, region, etc.)
   */
  all: protectedProcedure
    .input(
      z
        .object({
          /** The org to get positions for (includes nation-wide positions) */
          orgId: z.coerce
            .number()
            .optional()
            .describe(
              "The org to get positions for (includes nation-wide positions)",
            ),
          /** Filter by org type level (ao, region, etc.) */
          orgType: z
            .enum(OrgType)
            .optional()
            .describe("Filter by org type level (ao, region, etc.)"),
          /** Only get org-specific positions (exclude nation-wide) */
          ignoreGlobalPositions: z.coerce
            .boolean()
            .optional()
            .describe("Only get org-specific positions (exclude nation-wide)"),
          /** Filter by active status */
          isActive: z.coerce
            .boolean()
            .optional()
            .describe("Filter by active status. Defaults to true"),
          /** Only return positions for orgs the user can manage */
          onlyMine: z.coerce
            .boolean()
            .optional()
            .describe(
              "If true, only return positions in organizations where the requester has editor or admin role.",
            ),
          /** Search by position name, description, or org name */
          searchTerm: z
            .string()
            .optional()
            .describe(
              "Search positions by name, description, or org name. Case-insensitive partial matching.",
            ),
          /** Filter by active status */
          statuses: arrayOrSingle(z.enum(["active", "inactive"]))
            .optional()
            .describe(
              "Filter positions by status. Matches positions with ANY of the given statuses.",
            ),
          /** Zero-based page index for pagination */
          pageIndex: z.coerce
            .number()
            .optional()
            .describe("Zero-based page index for pagination."),
          /** Number of positions per page */
          pageSize: z.coerce
            .number()
            .optional()
            .describe("Number of positions per page. Defaults to 20."),
        })
        .optional()
        .describe(
          "Optional filters for listing positions by org, type, and status",
        ),
    )
    .route({
      method: "GET",
      path: "/",
      tags: ["position"],
      summary: "List all positions",
      description:
        "Get a list of positions with optional filtering by organization and type",
    })
    .output(
      z.object({
        positions: z
          .array(
            z.object({
              id: z.number().describe("Position ID"),
              name: z.string().describe("Position name"),
              description: z
                .string()
                .nullable()
                .describe("Position description"),
              orgId: z.number().nullable().describe("Organization ID"),
              orgName: z
                .string()
                .nullable()
                .describe("Organization name (null for national positions)"),
              orgType: z
                .enum(OrgType)
                .nullable()
                .describe("Organization type level"),
              isActive: z.boolean().describe("Whether the position is active"),
              created: z.string().describe("Date the position was created"),
              updated: z
                .string()
                .describe("Date the position was last updated"),
            }),
          )
          .describe("List of positions"),
        totalCount: z
          .number()
          .describe("Total number of positions matching the filters"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      let editableOrgIds: number[] = [];
      let isNationAdmin = false;

      if (input?.onlyMine) {
        const result = await getEditableOrgIdsForUser(ctx);
        isNationAdmin = result.isNationAdmin;

        if (!isNationAdmin && result.editableOrgs.length > 0) {
          const editableIds = result.editableOrgs.map((o) => o.id);
          const descendantIds = await getDescendantOrgIds(ctx.db, editableIds);
          editableOrgIds = [...new Set([...editableIds, ...descendantIds])];
        }
      }

      const where = and(
        input?.isActive !== undefined
          ? eq(schema.positions.isActive, input.isActive)
          : input?.statuses !== undefined
            ? undefined
            : eq(schema.positions.isActive, true),
        input?.orgId
          ? or(
              eq(schema.positions.orgId, input.orgId),
              input.ignoreGlobalPositions
                ? undefined
                : isNull(schema.positions.orgId),
            )
          : undefined,
        input?.orgType
          ? or(
              eq(schema.positions.orgType, input.orgType),
              isNull(schema.positions.orgType),
            )
          : undefined,
        input?.onlyMine && !isNationAdmin && editableOrgIds.length > 0
          ? or(
              inArray(schema.positions.orgId, editableOrgIds),
              isNull(schema.positions.orgId),
            )
          : undefined,
        input?.searchTerm
          ? or(
              ilike(schema.positions.name, `%${input.searchTerm}%`),
              ilike(schema.positions.description, `%${input.searchTerm}%`),
              ilike(schema.orgs.name, `%${input.searchTerm}%`),
            )
          : undefined,
      );

      const baseQuery = ctx.db
        .select({
          id: schema.positions.id,
          name: schema.positions.name,
          description: schema.positions.description,
          orgId: schema.positions.orgId,
          orgName: schema.orgs.name,
          orgType: schema.positions.orgType,
          isActive: schema.positions.isActive,
          created: schema.positions.created,
          updated: schema.positions.updated,
        })
        .from(schema.positions)
        .leftJoin(schema.orgs, eq(schema.positions.orgId, schema.orgs.id))
        .where(where)
        .orderBy(
          asc(
            sql`CASE WHEN ${schema.positions.orgId} IS NULL THEN 0 ELSE 1 END`,
          ),
          asc(schema.positions.name),
        );

      const usePagination =
        input?.pageIndex !== undefined && input?.pageSize !== undefined;
      const limit = input?.pageSize ?? 20;
      const offset = (input?.pageIndex ?? 0) * limit;

      const positions = usePagination
        ? await baseQuery.limit(limit).offset(offset)
        : await baseQuery;

      const [countResult] = await ctx.db
        .select({ total: count() })
        .from(schema.positions)
        .leftJoin(schema.orgs, eq(schema.positions.orgId, schema.orgs.id))
        .where(where);

      return { positions, totalCount: countResult?.total ?? 0 };
    }),

  /**
   * Get positions for a specific org only (not including global positions)
   */
  byOrgId: protectedProcedure
    .input(
      z.object({
        orgId: z.coerce
          .number()
          .describe("The ID of the organization to get positions for"),
        isActive: z.coerce
          .boolean()
          .optional()
          .describe("Filter by active status. Defaults to true"),
      }),
    )
    .route({
      method: "GET",
      path: "/org/{orgId}",
      tags: ["position"],
      summary: "Get positions by organization",
      description:
        "Retrieve positions specific to an organization (excludes global)",
    })
    .output(
      z.object({
        positions: z
          .array(
            z.object({
              id: z.number().describe("Position ID"),
              name: z.string().describe("Position name"),
              description: z
                .string()
                .nullable()
                .describe("Position description"),
              orgId: z.number().nullable().describe("Organization ID"),
              orgType: z
                .enum(OrgType)
                .nullable()
                .describe("Organization type level"),
              isActive: z.boolean().describe("Whether the position is active"),
              created: z.string().describe("Date the position was created"),
              updated: z
                .string()
                .describe("Date the position was last updated"),
            }),
          )
          .describe("List of positions"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const positions = await ctx.db
        .select()
        .from(schema.positions)
        .where(
          and(
            eq(schema.positions.orgId, input.orgId),
            input.isActive !== undefined
              ? eq(schema.positions.isActive, input.isActive)
              : eq(schema.positions.isActive, true),
          ),
        )
        .orderBy(asc(schema.positions.name));

      return { positions };
    }),

  /**
   * Get a single position by ID
   */
  byId: protectedProcedure
    .input(
      z.object({
        id: z.coerce.number().describe("The ID of the position to retrieve"),
      }),
    )
    .route({
      method: "GET",
      path: "/id/{id}",
      tags: ["position"],
      summary: "Get position by ID",
      description: "Retrieve detailed information about a specific position",
    })
    .output(
      z.object({
        position: z
          .object({
            id: z.number().describe("Position ID"),
            name: z.string().describe("Position name"),
            description: z.string().nullable().describe("Position description"),
            orgId: z.number().nullable().describe("Organization ID"),
            orgName: z
              .string()
              .nullable()
              .describe("Organization name (resolved from orgId)"),
            orgType: z
              .enum(OrgType)
              .nullable()
              .describe("Organization type level"),
            isActive: z.boolean().describe("Whether the position is active"),
            created: z.string().describe("Date the position was created"),
            updated: z.string().describe("Date the position was last updated"),
          })
          .nullable()
          .describe("The position"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const [result] = await ctx.db
        .select({
          id: schema.positions.id,
          name: schema.positions.name,
          description: schema.positions.description,
          orgId: schema.positions.orgId,
          orgName: schema.orgs.name,
          orgType: schema.positions.orgType,
          isActive: schema.positions.isActive,
          created: schema.positions.created,
          updated: schema.positions.updated,
        })
        .from(schema.positions)
        .leftJoin(schema.orgs, eq(schema.orgs.id, schema.positions.orgId))
        .where(eq(schema.positions.id, input.id));

      if (!result) {
        throw new ORPCError("NOT_FOUND", {
          message: "Position not found",
        });
      }

      return { position: result };
    }),

  /**
   * Get position assignments for an org.
   * Returns positions with their assigned users.
   */
  getAssignments: protectedProcedure
    .input(
      z.object({
        /** The org (AO or region) to get assignments for */
        orgId: z.coerce
          .number()
          .describe("The org (AO or region) to get assignments for"),
        /** The region org ID (to determine what positions to show) */
        regionOrgId: z.coerce
          .number()
          .optional()
          .describe(
            "The region org ID (to determine what positions to show). Defaults to orgId",
          ),
      }),
    )
    .route({
      method: "GET",
      path: "/assignments/{orgId}",
      tags: ["position"],
      summary: "Get position assignments for an org",
      description:
        "Get all positions with their assigned users for a specific org",
    })
    .output(
      z.object({
        positions: z
          .array(
            z.object({
              id: z.number().describe("Position ID"),
              name: z.string().describe("Position name"),
              description: z
                .string()
                .nullable()
                .describe("Position description"),
              orgId: z.number().nullable().describe("Organization ID"),
              orgType: z
                .enum(OrgType)
                .nullable()
                .describe("Organization type level"),
              isActive: z.boolean().describe("Whether the position is active"),
              created: z.string().describe("Date the position was created"),
              updated: z
                .string()
                .describe("Date the position was last updated"),
              users: z
                .array(
                  z.object({
                    id: z.number().describe("User ID"),
                    f3Name: z.string().nullable().describe("User's F3 name"),
                    firstName: z
                      .string()
                      .nullable()
                      .describe("User's first name"),
                    lastName: z
                      .string()
                      .nullable()
                      .describe("User's last name"),
                    avatarUrl: z
                      .string()
                      .nullable()
                      .describe("User's avatar URL"),
                  }),
                )
                .describe("Users assigned to the position"),
            }),
          )
          .describe("List of positions"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      // Determine org type level for filtering positions
      const [org] = await ctx.db
        .select()
        .from(schema.orgs)
        .where(eq(schema.orgs.id, input.orgId));

      const orgTypeLevel = org?.orgType ?? "region";
      const regionOrgId = input.regionOrgId ?? input.orgId;

      // Get applicable positions (global + region-specific, matching org type)
      const positions = await ctx.db
        .select()
        .from(schema.positions)
        .where(
          and(
            eq(schema.positions.isActive, true),
            or(
              isNull(schema.positions.orgId),
              eq(schema.positions.orgId, regionOrgId),
            ),
            or(
              isNull(schema.positions.orgType),
              eq(schema.positions.orgType, orgTypeLevel),
            ),
          ),
        )
        .orderBy(
          asc(
            sql`CASE WHEN ${schema.positions.orgId} IS NULL THEN 0 ELSE 1 END`,
          ),
          asc(schema.positions.name),
        );

      // Get assignments for this org with user details
      const assignments = await ctx.db
        .select({
          positionId: schema.positionsXOrgsXUsers.positionId,
          userId: schema.positionsXOrgsXUsers.userId,
          f3Name: schema.users.f3Name,
          firstName: schema.users.firstName,
          lastName: schema.users.lastName,
          avatarUrl: schema.users.avatarUrl,
        })
        .from(schema.positionsXOrgsXUsers)
        .innerJoin(
          schema.users,
          eq(schema.positionsXOrgsXUsers.userId, schema.users.id),
        )
        .where(eq(schema.positionsXOrgsXUsers.orgId, input.orgId));

      // Group assignments by position
      const assignmentsByPosition = assignments.reduce(
        (acc, a) => {
          acc[a.positionId] ??= [];
          acc[a.positionId]!.push({
            id: a.userId,
            f3Name: a.f3Name,
            firstName: a.firstName,
            lastName: a.lastName,
            avatarUrl: a.avatarUrl,
          });
          return acc;
        },
        {} as Record<
          number,
          {
            id: number;
            f3Name: string | null;
            firstName: string | null;
            lastName: string | null;
            avatarUrl: string | null;
          }[]
        >,
      );

      // Combine positions with their assignments
      const positionsWithAssignments = positions.map((p) => ({
        ...p,
        users: assignmentsByPosition[p.id] ?? [],
      }));

      return { positions: positionsWithAssignments };
    }),

  /**
   * Create or update a position
   */
  crupdate: editorProcedure
    .input(PositionInsertSchema)
    .route({
      method: "POST",
      path: "/",
      tags: ["position"],
      summary: "Create or update position",
      description: "Create a new position or update an existing one",
    })
    .output(
      z.object({
        position: z
          .object({
            id: z.number().describe("Position ID"),
            name: z.string().describe("Position name"),
            description: z.string().nullable().describe("Position description"),
            orgId: z.number().nullable().describe("Organization ID"),
            orgType: z
              .enum(OrgType)
              .nullable()
              .describe("Organization type level"),
            isActive: z.boolean().describe("Whether the position is active"),
            created: z.string().describe("Date the position was created"),
            updated: z.string().describe("Date the position was last updated"),
          })
          .nullable()
          .describe("The created or updated position"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      // When editing, verify the caller can modify the position's *current* org
      // before we ever look at where they want to move it.
      if (input.id !== undefined) {
        const [existingPosition] = await ctx.db
          .select({ orgId: schema.positions.orgId })
          .from(schema.positions)
          .where(eq(schema.positions.id, input.id));

        if (!existingPosition) {
          throw new ORPCError("NOT_FOUND", {
            message: "Position not found",
          });
        }

        // Assume only one nation org will exist
        if (!existingPosition.orgId) {
          const [nationOrg] = await ctx.db
            .select({ id: schema.orgs.id })
            .from(schema.orgs)
            .where(eq(schema.orgs.orgType, "nation"));

          if (!nationOrg) {
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message:
                "Position has no associated org, which means it belongs to the nation, but the nation could not be located.",
            });
          }

          const roleCheckResult = await checkHasRoleOnOrg({
            orgId: nationOrg.id,
            session: ctx.session,
            db: ctx.db,
            roleName: "editor",
          });

          if (!roleCheckResult.success) {
            throw new ORPCError("UNAUTHORIZED", {
              message: "You are not authorized to edit global positions",
            });
          }
        } else {
          const roleCheckResult = await checkHasRoleOnOrg({
            orgId: existingPosition.orgId,
            session: ctx.session,
            db: ctx.db,
            roleName: "editor",
          });

          if (!roleCheckResult.success) {
            throw new ORPCError("UNAUTHORIZED", {
              message: "You are not authorized to edit this position",
            });
          }
        }
      }

      // Check permission on the target org when creating, or when explicitly
      // rescoping. Pure field edits (orgId absent from payload) skip this —
      // the current-org check above already authorized the caller.
      if (input.id === undefined || input.orgId !== undefined) {
        const targetOrgId = input.orgId;

        if (!targetOrgId) {
          // Creating a global position requires nation-level permissions
          const [nationOrg] = await ctx.db
            .select({ id: schema.orgs.id })
            .from(schema.orgs)
            .where(eq(schema.orgs.orgType, "nation"));

          if (!nationOrg) {
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: "Nation organization not found",
            });
          }

          const roleCheckResult = await checkHasRoleOnOrg({
            orgId: nationOrg.id,
            session: ctx.session,
            db: ctx.db,
            roleName: "editor",
          });

          if (!roleCheckResult.success) {
            throw new ORPCError("UNAUTHORIZED", {
              message: "You are not authorized to create global positions",
            });
          }
        } else {
          const roleCheckResult = await checkHasRoleOnOrg({
            orgId: targetOrgId,
            session: ctx.session,
            db: ctx.db,
            roleName: "editor",
          });

          if (!roleCheckResult.success) {
            throw new ORPCError("UNAUTHORIZED", {
              message:
                "You are not authorized to manage positions for this org",
            });
          }
        }
      }

      const result = await ctx.db
        .insert(schema.positions)
        .values(input)
        .onConflictDoUpdate({
          target: schema.positions.id,
          set: input,
        })
        .returning();

      return { position: result[0] ?? null };
    }),

  /**
   * Soft delete a position (set isActive to false)
   */
  delete: editorProcedure
    .input(
      z.object({
        id: z.coerce.number().describe("The ID of the position to delete"),
      }),
    )
    .route({
      method: "DELETE",
      path: "/id/{id}",
      tags: ["position"],
      summary: "Delete position",
      description: "Soft delete a position by marking it as inactive",
    })
    .output(
      z.object({
        positionId: z.number().describe("Position ID"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const [existingPosition] = await ctx.db
        .select()
        .from(schema.positions)
        .where(eq(schema.positions.id, input.id));

      if (!existingPosition) {
        throw new ORPCError("NOT_FOUND", {
          message: "Position not found",
        });
      }

      // Only org-specific positions can be deleted
      if (!existingPosition.orgId) {
        throw new ORPCError("FORBIDDEN", {
          message: "Global positions cannot be deleted",
        });
      }

      const roleCheckResult = await checkHasRoleOnOrg({
        orgId: existingPosition.orgId,
        session: ctx.session,
        db: ctx.db,
        roleName: "editor",
      });

      if (!roleCheckResult.success) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "You are not authorized to delete this position",
        });
      }

      // Delete assignments for this position
      await ctx.db
        .delete(schema.positionsXOrgsXUsers)
        .where(eq(schema.positionsXOrgsXUsers.positionId, input.id));

      // Soft delete the position
      await ctx.db
        .update(schema.positions)
        .set({ isActive: false })
        .where(eq(schema.positions.id, input.id));

      return { positionId: input.id };
    }),

  /**
   * Update position assignments for an org.
   * Replaces all existing assignments for the specified org.
   * @deprecated Kept for backward compatibility. The admin UI should not use this endpoint.
   */
  updateAssignments: editorProcedure
    .input(UpdatePositionAssignmentsSchema)
    .route({
      method: "PUT",
      path: "/assignments",
      tags: ["position"],
      summary: "Update position assignments",
      description:
        "Deprecated: Use individual assignment endpoints instead. Replace all position assignments for an org with new assignments. Kept for backward compatibility.",
      deprecated: true,
    })
    .output(
      z.object({
        success: z
          .boolean()
          .describe(
            "Whether the position assignments were updated successfully",
          ),
        assignmentCount: z
          .number()
          .describe("The number of assignments updated"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const roleCheckResult = await checkHasRoleOnOrg({
        orgId: input.orgId,
        session: ctx.session,
        db: ctx.db,
        roleName: "editor",
      });

      if (!roleCheckResult.success) {
        throw new ORPCError("UNAUTHORIZED", {
          message:
            "You are not authorized to manage position assignments for this org",
        });
      }

      // Get all position IDs being updated
      const positionIds = input.assignments.map((a) => a.positionId);

      // Delete existing assignments for these positions in this org
      if (positionIds.length > 0) {
        await ctx.db
          .delete(schema.positionsXOrgsXUsers)
          .where(
            and(
              eq(schema.positionsXOrgsXUsers.orgId, input.orgId),
              inArray(schema.positionsXOrgsXUsers.positionId, positionIds),
            ),
          );
      }

      // Build new assignments
      const newAssignments: {
        positionId: number;
        orgId: number;
        userId: number;
      }[] = [];

      for (const assignment of input.assignments) {
        for (const userId of assignment.userIds) {
          newAssignments.push({
            positionId: assignment.positionId,
            orgId: input.orgId,
            userId,
          });
        }
      }

      // Insert new assignments
      if (newAssignments.length > 0) {
        await ctx.db.insert(schema.positionsXOrgsXUsers).values(newAssignments);
      }

      return { success: true, assignmentCount: newAssignments.length };
    }),

  addAssignment: editorProcedure
    .input(AddPositionAssignmentSchema)
    .route({
      method: "POST",
      path: "/assignments",
      tags: ["position"],
      summary: "Add a single position assignment",
      description:
        "Assign a user to a position at an org. Idempotent — returns success if the assignment already exists.",
    })
    .output(
      z.object({
        success: z
          .boolean()
          .describe("Whether the operation completed successfully"),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const roleCheckResult = await checkHasRoleOnOrg({
        orgId: input.orgId,
        session: ctx.session,
        db: ctx.db,
        roleName: "editor",
      });

      if (!roleCheckResult.success) {
        throw new ORPCError("UNAUTHORIZED", {
          message:
            "You are not authorized to manage position assignments for this org",
        });
      }

      await ctx.db
        .insert(schema.positionsXOrgsXUsers)
        .values({
          positionId: input.positionId,
          orgId: input.orgId,
          userId: input.userId,
        })
        .onConflictDoNothing();

      return { success: true };
    }),

  /**
   * Delete a single position assignment.
   * Removes a specific user from a specific position at a specific org.
   */
  deleteAssignment: editorProcedure
    .input(
      z.object({
        positionId: z.coerce
          .number()
          .describe("The ID of the position to unassign"),
        orgId: z.coerce
          .number()
          .describe("The ID of the organization the assignment belongs to"),
        userId: z.coerce
          .number()
          .describe("The ID of the user to remove from the position"),
      }),
    )
    .route({
      method: "DELETE",
      path: "/assignments/org/{orgId}/position/{positionId}/user/{userId}",
      tags: ["position"],
      summary: "Delete a single position assignment",
      description:
        "Remove a specific user from a specific position at a specific org. Returns success even if the assignment did not exist.",
    })
    .handler(async ({ context: ctx, input }) => {
      const roleCheckResult = await checkHasRoleOnOrg({
        orgId: input.orgId,
        session: ctx.session,
        db: ctx.db,
        roleName: "editor",
      });

      if (!roleCheckResult.success) {
        throw new ORPCError("UNAUTHORIZED", {
          message:
            "You are not authorized to manage position assignments for this org",
        });
      }

      const result = await ctx.db
        .delete(schema.positionsXOrgsXUsers)
        .where(
          and(
            eq(schema.positionsXOrgsXUsers.positionId, input.positionId),
            eq(schema.positionsXOrgsXUsers.orgId, input.orgId),
            eq(schema.positionsXOrgsXUsers.userId, input.userId),
          ),
        )
        .returning({ positionId: schema.positionsXOrgsXUsers.positionId });

      return {
        success: true,
        found: result.length > 0,
        message:
          result.length > 0
            ? "Assignment deleted"
            : "No matching assignment found",
      };
    }),

  /**
   * Get position assignments for a specific user.
   * Returns all position assignments across all orgs for the given user,
   * including position and org details.
   */
  getAssignmentsByUserId: protectedProcedure
    .input(
      z.object({
        userId: z.coerce
          .number()
          .describe("The ID of the user to get position assignments for"),
        includeInactive: z.coerce
          .boolean()
          .default(false)
          .describe(
            "Include assignments where the position or user is inactive. Defaults to false",
          ),
      }),
    )
    .route({
      method: "GET",
      path: "/assignments/user/{userId}",
      tags: ["position"],
      summary: "Get position assignments by user",
      description:
        "Get all position assignments for a specific user across all orgs, including position name and org name. By default only returns assignments where both the position and user are active.",
    })
    .handler(async ({ context: ctx, input }) => {
      const assignments = await ctx.db
        .select({
          positionId: schema.positionsXOrgsXUsers.positionId,
          positionName: schema.positions.name,
          orgId: schema.positionsXOrgsXUsers.orgId,
          orgName: schema.orgs.name,
          orgType: schema.positions.orgType,
        })
        .from(schema.positionsXOrgsXUsers)
        .innerJoin(
          schema.positions,
          eq(schema.positions.id, schema.positionsXOrgsXUsers.positionId),
        )
        .innerJoin(
          schema.orgs,
          eq(schema.orgs.id, schema.positionsXOrgsXUsers.orgId),
        )
        .innerJoin(
          schema.users,
          eq(schema.users.id, schema.positionsXOrgsXUsers.userId),
        )
        .where(
          and(
            eq(schema.positionsXOrgsXUsers.userId, input.userId),
            input.includeInactive
              ? undefined
              : eq(schema.positions.isActive, true),
            input.includeInactive
              ? undefined
              : eq(schema.users.status, "active"),
          ),
        )
        .orderBy(asc(schema.orgs.name), asc(schema.positions.name));

      return { assignments };
    }),

  getAllAssignments: protectedProcedure
    .input(GetAllPositionAssignmentsSchema)
    .route({
      method: "GET",
      path: "/assignments/all",
      tags: ["position"],
      summary: "Get all position assignments",
      description:
        "Get all position assignments with display data, scoped to the caller's editable orgs. Supports optional filters by orgId, positionId, userId, and includeInactive.",
    })
    .output(
      z.object({
        assignments: z.array(
          z.object({
            positionId: z.number().describe("Position ID"),
            orgId: z.number().describe("Organization ID"),
            userId: z.number().describe("User ID"),
            positionName: z.string().describe("Position name"),
            orgName: z.string().describe("Organization name"),
            f3Name: z.string().nullable().describe("User's F3 name"),
            firstName: z.string().nullable().describe("User's first name"),
            lastName: z.string().nullable().describe("User's last name"),
          }),
        ),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const { editableOrgs, isNationAdmin } =
        await getEditableOrgIdsForUser(ctx);

      if (!isNationAdmin && editableOrgs.length === 0) {
        return { assignments: [] };
      }

      const conditions = [];

      // Scope to editable orgs (unless nation admin)
      if (!isNationAdmin) {
        const editableOrgIds = editableOrgs.map((o) => o.id);
        const descendantOrgIds = await getDescendantOrgIds(
          ctx.db,
          editableOrgIds,
        );
        const allOrgIds = [
          ...new Set([...editableOrgIds, ...descendantOrgIds]),
        ];
        conditions.push(inArray(schema.positionsXOrgsXUsers.orgId, allOrgIds));
      }

      if (input.orgId !== undefined) {
        conditions.push(eq(schema.positionsXOrgsXUsers.orgId, input.orgId));
      }
      if (input.positionId !== undefined) {
        conditions.push(
          eq(schema.positionsXOrgsXUsers.positionId, input.positionId),
        );
      }
      if (input.userId !== undefined) {
        conditions.push(eq(schema.positionsXOrgsXUsers.userId, input.userId));
      }
      if (!input.includeInactive) {
        conditions.push(eq(schema.positions.isActive, true));
        conditions.push(eq(schema.orgs.isActive, true));
      }

      const assignments = await ctx.db
        .select({
          positionId: schema.positionsXOrgsXUsers.positionId,
          orgId: schema.positionsXOrgsXUsers.orgId,
          userId: schema.positionsXOrgsXUsers.userId,
          positionName: schema.positions.name,
          orgName: schema.orgs.name,
          f3Name: schema.users.f3Name,
          firstName: schema.users.firstName,
          lastName: schema.users.lastName,
        })
        .from(schema.positionsXOrgsXUsers)
        .innerJoin(
          schema.positions,
          eq(schema.positionsXOrgsXUsers.positionId, schema.positions.id),
        )
        .innerJoin(
          schema.orgs,
          eq(schema.positionsXOrgsXUsers.orgId, schema.orgs.id),
        )
        .innerJoin(
          schema.users,
          eq(schema.positionsXOrgsXUsers.userId, schema.users.id),
        )
        .where(and(...conditions))
        .orderBy(asc(schema.orgs.name), asc(schema.positions.name));

      return { assignments };
    }),
};
