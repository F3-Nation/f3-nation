import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { and, asc, eq, inArray, isNull, or, schema, sql } from "@acme/db";
import {
  PositionInsertSchema,
  UpdatePositionAssignmentsSchema,
} from "@acme/validators";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
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
            .enum(["ao", "region", "area", "sector", "nation"])
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
    .handler(async ({ context: ctx, input }) => {
      const where = and(
        input?.isActive !== undefined
          ? eq(schema.positions.isActive, input.isActive)
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
      );

      const positions = await ctx.db
        .select()
        .from(schema.positions)
        .where(where)
        .orderBy(
          // Global positions first, then alphabetically
          asc(
            sql`CASE WHEN ${schema.positions.orgId} IS NULL THEN 0 ELSE 1 END`,
          ),
          asc(schema.positions.name),
        );

      return { positions };
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
    .handler(async ({ context: ctx, input }) => {
      const [result] = await ctx.db
        .select()
        .from(schema.positions)
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

      // Get assignments for this org
      const assignments = await ctx.db
        .select({
          positionId: schema.positionsXOrgsXUsers.positionId,
          userId: schema.positionsXOrgsXUsers.userId,
        })
        .from(schema.positionsXOrgsXUsers)
        .where(eq(schema.positionsXOrgsXUsers.orgId, input.orgId));

      // Group assignments by position
      const assignmentsByPosition = assignments.reduce(
        (acc, a) => {
          if (!acc[a.positionId]) {
            acc[a.positionId] = [];
          }
          acc[a.positionId]!.push(a.userId);
          return acc;
        },
        {} as Record<number, number[]>,
      );

      // Combine positions with their assignments
      const positionsWithAssignments = positions.map((p) => ({
        ...p,
        userIds: assignmentsByPosition[p.id] ?? [],
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
    .handler(async ({ context: ctx, input }) => {
      // For editing, check permission on the position's org
      // For creating, check permission on the target org
      const targetOrgId = input.orgId;

      if (!targetOrgId) {
        // Creating a global position requires nation-level permissions
        const [nationOrg] = await ctx.db
          .select({ id: schema.orgs.id })
          .from(schema.orgs)
          .where(eq(schema.orgs.orgType, "nation"));

        if (!nationOrg) {
          throw new ORPCError("NOT_FOUND", {
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
            message: "You are not authorized to manage positions for this org",
          });
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
   */
  updateAssignments: editorProcedure
    .input(UpdatePositionAssignmentsSchema)
    .route({
      method: "PUT",
      path: "/assignments",
      tags: ["position"],
      summary: "Update position assignments",
      description:
        "Replace all position assignments for an org with new assignments",
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
      path: "/assignments",
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
};
