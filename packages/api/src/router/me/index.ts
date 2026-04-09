import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { and, asc, eq, schema, sql } from "@acme/db";
import type { AppDb } from "@acme/db/client";
import { Header } from "@acme/shared/common/enums";

import { protectedProcedure } from "../../shared";

/**
 * Extract the raw bearer token from the Authorization header.
 */
function extractBearerToken(headers?: Headers): string | null {
  const auth = headers?.get(Header.Authorization as string);
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return null;
}

/**
 * Scoped procedure for /me endpoints that need to act on behalf of
 * a specific user.
 *
 * - BFF requests (bearer token matches ME_BFF_API_KEY env var): MUST
 *   include X-User-Id header. The BFF reads the signed session cookie
 *   and forwards the userId.
 * - All other callers (Scalar, mobile, direct API key): use the
 *   session identity from the API key. X-User-Id is ignored.
 *
 * The bearer token is compared against a server-side secret, so
 * this cannot be spoofed via headers.
 */
const meProtectedProcedure = protectedProcedure.use(({ context, next }) => {
  const reqHeaders = (context as unknown as { reqHeaders?: Headers })
    .reqHeaders;

  // Only the BFF bearer token is trusted to set X-User-Id
  const bffKey = process.env.ME_BFF_API_KEY;
  const bearerToken = extractBearerToken(reqHeaders);
  const isBff = bffKey && bearerToken === bffKey;

  if (isBff) {
    const userIdHeader = reqHeaders?.get(Header.UserId as string);
    if (!userIdHeader) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "X-User-Id header is required for /me endpoints",
      });
    }
    const overrideId = Number(userIdHeader);
    if (!Number.isInteger(overrideId) || overrideId <= 0) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "X-User-Id header must be a positive integer",
      });
    }
    return next({
      context: {
        ...context,
        session: { ...context.session!, id: overrideId },
      },
    });
  }

  // Non-BFF callers: use their own session identity
  return next({ context });
});

/**
 * /me router — self-service endpoints for authenticated users.
 *
 * Unlike the /user router (which requires editor/admin roles and manages
 * other users), these endpoints let an authenticated user manage their own
 * profile, positions, and roles with only protectedProcedure auth.
 */

const profileUpdateSchema = z
  .object({
    f3Name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("The user's F3 name (alias)."),
    firstName: z
      .string()
      .max(200)
      .nullable()
      .optional()
      .describe("The user's legal first name."),
    lastName: z
      .string()
      .max(200)
      .optional()
      .describe("The user's legal last name."),
    phone: z
      .string()
      .max(50)
      .nullable()
      .optional()
      .describe("The user's phone number."),
    homeRegionId: z
      .number()
      .int()
      .min(1)
      .nullable()
      .optional()
      .describe("ID of the user's home region org."),
    avatarUrl: z
      .string()
      .url()
      .nullable()
      .optional()
      .describe("URL of the user's avatar image."),
    emergencyContact: z
      .string()
      .max(200)
      .nullable()
      .optional()
      .describe("Name of emergency contact."),
    emergencyPhone: z
      .string()
      .max(50)
      .nullable()
      .optional()
      .describe("Phone number for emergency contact."),
    emergencyNotes: z
      .string()
      .max(1000)
      .nullable()
      .optional()
      .describe("Additional emergency notes (allergies, medical conditions)."),
    meta: z
      .record(z.unknown())
      .optional()
      .describe(
        "JSON meta fields to merge with existing meta (e.g. f3_name_origin, my_f3_why).",
      ),
  })
  .strict()
  .describe("Whitelisted profile fields the user can update.");

/** Fetch the full profile (user + roles + positions) for the given userId. */
async function fetchFullProfile(db: AppDb, userId: number) {
  const [user] = await db
    .select({
      id: schema.users.id,
      f3Name: schema.users.f3Name,
      firstName: schema.users.firstName,
      lastName: schema.users.lastName,
      email: schema.users.email,
      emailVerified: schema.users.emailVerified,
      phone: schema.users.phone,
      homeRegionId: schema.users.homeRegionId,
      avatarUrl: schema.users.avatarUrl,
      meta: schema.users.meta,
      emergencyContact: schema.users.emergencyContact,
      emergencyPhone: schema.users.emergencyPhone,
      emergencyNotes: schema.users.emergencyNotes,
      status: schema.users.status,
      created: schema.users.created,
      updated: schema.users.updated,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId));

  if (!user) {
    throw new ORPCError("NOT_FOUND", { message: "User not found" });
  }

  const roles = await db
    .select({
      roleId: schema.rolesXUsersXOrg.roleId,
      orgId: schema.rolesXUsersXOrg.orgId,
      orgName: schema.orgs.name,
      roleName: schema.roles.name,
    })
    .from(schema.rolesXUsersXOrg)
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.rolesXUsersXOrg.orgId))
    .innerJoin(schema.roles, eq(schema.roles.id, schema.rolesXUsersXOrg.roleId))
    .where(eq(schema.rolesXUsersXOrg.userId, userId))
    .orderBy(asc(schema.orgs.name), asc(schema.roles.name));

  const positions = await db
    .select({
      positionId: schema.positionsXOrgsXUsers.positionId,
      orgId: schema.positionsXOrgsXUsers.orgId,
      positionName: schema.positions.name,
      orgName: schema.orgs.name,
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
      schema.orgs,
      eq(schema.orgs.id, schema.positionsXOrgsXUsers.orgId),
    )
    .where(eq(schema.positionsXOrgsXUsers.userId, userId))
    .orderBy(asc(schema.orgs.name), asc(schema.positions.name));

  return { ...user, roles, positions };
}

export const meRouter = {
  /**
   * Get the authenticated user's own profile with PII, roles, and positions.
   */
  profile: meProtectedProcedure
    .route({
      method: "GET",
      path: "/profile",
      tags: ["Me"],
      summary: "Get own profile",
      description:
        "Return the authenticated user's full profile including PII, roles, and position assignments in a single call.",
    })
    .handler(async ({ context: ctx }) => {
      const user = await fetchFullProfile(ctx.db, ctx.session!.id);
      return { user };
    }),

  /**
   * Update the authenticated user's own profile.
   * Only whitelisted fields can be changed. Roles cannot be self-assigned.
   */
  updateProfile: meProtectedProcedure
    .input(profileUpdateSchema)
    .route({
      method: "PATCH",
      path: "/profile",
      tags: ["Me"],
      summary: "Update own profile",
      description:
        "Update the authenticated user's profile fields. Only whitelisted fields are accepted. Returns the full updated profile.",
    })
    .handler(async ({ context: ctx, input }) => {
      const userId = ctx.session!.id;

      // Build the update set from provided fields
      const { meta: metaInput, ...directFields } = input;

      // Merge meta if provided
      let metaUpdate: Record<string, unknown> | undefined;
      if (metaInput) {
        const [currentUser] = await ctx.db
          .select({ meta: schema.users.meta })
          .from(schema.users)
          .where(eq(schema.users.id, userId));

        if (!currentUser) {
          throw new ORPCError("NOT_FOUND", { message: "User not found" });
        }

        let existingMeta: Record<string, unknown> = {};
        if (currentUser.meta) {
          if (typeof currentUser.meta === "object") {
            existingMeta = currentUser.meta as Record<string, unknown>;
          } else if (typeof currentUser.meta === "string") {
            try {
              existingMeta = JSON.parse(currentUser.meta) as Record<
                string,
                unknown
              >;
            } catch {
              existingMeta = {};
            }
          }
        }
        metaUpdate = { ...existingMeta, ...metaInput };
      }

      const updateSet: Record<string, unknown> = { ...directFields };
      if (metaUpdate !== undefined) {
        updateSet.meta = metaUpdate;
      }

      // Only update if there's something to set
      if (Object.keys(updateSet).length > 0) {
        const result = await ctx.db
          .update(schema.users)
          .set(updateSet)
          .where(eq(schema.users.id, userId))
          .returning({ id: schema.users.id });

        if (result.length === 0) {
          throw new ORPCError("NOT_FOUND", { message: "User not found" });
        }
      }

      const user = await fetchFullProfile(ctx.db, userId);
      return { user };
    }),

  /**
   * List all regions for the region-select dropdown.
   * Returns both active and inactive so the dropdown isn't broken if
   * the user's current homeRegionId points to an inactive region.
   * The isActive flag lets the UI restrict new selections to active regions.
   */
  regions: protectedProcedure
    .route({
      method: "GET",
      path: "/regions",
      tags: ["Me"],
      summary: "List regions",
      description:
        "Return all regions (active and inactive) for the region dropdown. Each region includes an isActive flag so the UI can restrict new selections to active ones.",
    })
    .handler(async ({ context: ctx }) => {
      const regions = await ctx.db
        .select({
          id: schema.orgs.id,
          name: schema.orgs.name,
          isActive: schema.orgs.isActive,
        })
        .from(schema.orgs)
        .where(eq(schema.orgs.orgType, "region"))
        .orderBy(asc(schema.orgs.name));

      return { orgs: regions };
    }),

  /**
   * Remove the authenticated user from a specific position assignment.
   */
  deletePosition: meProtectedProcedure
    .input(
      z
        .object({
          orgId: z
            .number()
            .int()
            .min(1)
            .describe("The org ID of the position assignment to remove."),
          positionId: z
            .number()
            .int()
            .min(1)
            .describe("The position ID to remove the user from."),
        })
        .describe("Identifies which position assignment to delete."),
    )
    .route({
      method: "DELETE",
      path: "/positions",
      tags: ["Me"],
      summary: "Remove own position assignment",
      description:
        "Remove the authenticated user from a specific position at a specific org.",
    })
    .handler(async ({ context: ctx, input }) => {
      const userId = ctx.session!.id;

      const deleted = await ctx.db
        .delete(schema.positionsXOrgsXUsers)
        .where(
          and(
            eq(schema.positionsXOrgsXUsers.positionId, input.positionId),
            eq(schema.positionsXOrgsXUsers.orgId, input.orgId),
            eq(schema.positionsXOrgsXUsers.userId, userId),
          ),
        )
        .returning({
          positionId: schema.positionsXOrgsXUsers.positionId,
        });

      return { success: true, found: deleted.length > 0 };
    }),

  /**
   * Remove the authenticated user from a specific role at an org.
   */
  deleteRole: meProtectedProcedure
    .input(
      z
        .object({
          orgId: z
            .number()
            .int()
            .min(1)
            .describe("The org ID of the role assignment to remove."),
          roleId: z
            .number()
            .int()
            .min(1)
            .describe("The role ID to remove the user from."),
        })
        .describe("Identifies which role assignment to delete."),
    )
    .route({
      method: "DELETE",
      path: "/roles",
      tags: ["Me"],
      summary: "Remove own role assignment",
      description:
        "Remove the authenticated user from a specific role at a specific org.",
    })
    .handler(async ({ context: ctx, input }) => {
      const userId = ctx.session!.id;

      const deleted = await ctx.db
        .delete(schema.rolesXUsersXOrg)
        .where(
          and(
            eq(schema.rolesXUsersXOrg.userId, userId),
            eq(schema.rolesXUsersXOrg.orgId, input.orgId),
            eq(schema.rolesXUsersXOrg.roleId, input.roleId),
          ),
        )
        .returning({ userId: schema.rolesXUsersXOrg.userId });

      return { success: true, found: deleted.length > 0 };
    }),

  /**
   * List users for the "Who Brought You?" dropdown.
   * Optionally filter by homeRegionId to reduce payload size.
   */
  users: protectedProcedure
    .input(
      z
        .object({
          homeRegionId: z.coerce
            .number()
            .int()
            .min(1)
            .optional()
            .describe(
              "When provided, returns only users whose home region matches. Omit to get all users.",
            ),
        })
        .optional(),
    )
    .route({
      method: "GET",
      path: "/users",
      tags: ["Me"],
      summary: "List users for dropdown",
      description:
        "Return a lightweight user list for the 'Who Brought You?' dropdown. " +
        "Optionally filter by homeRegionId to limit results to the same region.",
    })
    .handler(async ({ context: ctx, input }) => {
      const homeRegionId = input?.homeRegionId;

      const conditions = [];
      if (homeRegionId) {
        conditions.push(eq(schema.users.homeRegionId, homeRegionId));
      }

      const rows = await ctx.db
        .select({
          id: schema.users.id,
          f3Name: schema.users.f3Name,
          firstName: schema.users.firstName,
          lastName: schema.users.lastName,
          homeRegionId: schema.users.homeRegionId,
          homeRegionName: sql<string | null>`${schema.orgs.name}`,
          status: schema.users.status,
        })
        .from(schema.users)
        .leftJoin(schema.orgs, eq(schema.orgs.id, schema.users.homeRegionId))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(asc(schema.users.f3Name), asc(schema.users.lastName));

      return { users: rows };
    }),

  /**
   * Look up a user's ID by email address.
   * Used during OAuth callback to resolve email → numeric user ID.
   */
  lookupByEmail: protectedProcedure
    .input(
      z.object({
        email: z.string().email().describe("The email address to look up."),
      }),
    )
    .route({
      method: "GET",
      path: "/lookup-by-email",
      tags: ["Me"],
      summary: "Look up user ID by email",
      description:
        "Resolve an email address to a numeric user ID. Used during login to populate the session.",
    })
    .handler(async ({ context: ctx, input }) => {
      const [user] = await ctx.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, input.email))
        .limit(1);

      if (!user) {
        throw new ORPCError("NOT_FOUND", {
          message: "No user found for this email",
        });
      }

      return { userId: user.id };
    }),
};
