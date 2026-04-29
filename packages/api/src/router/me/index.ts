import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { and, asc, eq, ilike, schema, sql } from "@acme/db";
import type { AppDb } from "@acme/db/client";

import { protectedProcedure } from "../../shared";

/**
 * /me router — self-service endpoints for authenticated users.
 *
 * Unlike the /user router (which requires editor/admin roles and manages
 * other users), these endpoints let an authenticated user manage their own
 * profile, positions, and roles with only protectedProcedure auth.
 */

/**
 * avatarUrl values written through this router must point at the canonical
 * F3 public-image GCS bucket (prod or staging). The avatar-upload route
 * builds the URL server-side, so the only legitimate value is a GCS URL
 * under f3-public-images / f3-public-images-staging. Restricting the host
 * here prevents an authenticated user from PATCHing avatarUrl to an
 * arbitrary host and using the field for tracking pixels or SSRF when
 * other consumers pre-fetch the URL server-side.
 */
const ALLOWED_AVATAR_HOST_PATTERN =
  /^https:\/\/storage\.googleapis\.com\/f3-public-images(-staging)?\//;
const isAllowedAvatarUrl = (url: string): boolean =>
  ALLOWED_AVATAR_HOST_PATTERN.test(url);

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
      .refine(isAllowedAvatarUrl, "avatarUrl must be a GCS public-image URL")
      .nullable()
      .optional()
      .describe(
        "URL of the user's avatar image. Must be a GCS public-image URL " +
          "(storage.googleapis.com/f3-public-images[-staging]/...).",
      ),
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

const meRoleSchema = z.object({
  roleId: z.number().int().min(1),
  orgId: z.number().int().min(1),
  orgName: z.string(),
  roleName: z.enum(["user", "editor", "admin"]),
});

const mePositionSchema = z.object({
  positionId: z.number().int().min(1),
  orgId: z.number().int().min(1),
  positionName: z.string(),
  orgName: z.string(),
});

const meProfileSchema = z.object({
  id: z.number().int().min(1),
  f3Name: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string(),
  emailVerified: z.string().nullable(),
  phone: z.string().nullable(),
  homeRegionId: z.number().int().min(1).nullable(),
  avatarUrl: z.string().nullable(),
  meta: z.union([z.record(z.unknown()), z.string()]).nullable(),
  emergencyContact: z.string().nullable(),
  emergencyPhone: z.string().nullable(),
  emergencyNotes: z.string().nullable(),
  status: z.enum(["active", "inactive"]),
  created: z.string(),
  updated: z.string(),
  roles: z.array(meRoleSchema),
  positions: z.array(mePositionSchema),
});

const meUsersListItemSchema = z.object({
  id: z.number().int().min(1),
  f3Name: z.string().nullable(),
  homeRegionId: z.number().int().min(1).nullable(),
  homeRegionName: z.string().nullable(),
  status: z.enum(["active", "inactive"]),
});

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
  profile: protectedProcedure
    .route({
      method: "GET",
      path: "/profile",
      tags: ["Me"],
      summary: "Get own profile",
      description:
        "Return the authenticated user's full profile including PII, roles, and position assignments in a single call.",
    })
    .output(
      z.object({
        user: meProfileSchema,
      }),
    )
    .handler(async ({ context: ctx }) => {
      const user = await fetchFullProfile(ctx.db, ctx.session!.id);
      return { user };
    }),

  /**
   * Update the authenticated user's own profile.
   * Only whitelisted fields can be changed. Roles cannot be self-assigned.
   */
  updateProfile: protectedProcedure
    .input(profileUpdateSchema)
    .route({
      method: "PATCH",
      path: "/profile",
      tags: ["Me"],
      summary: "Update own profile",
      description:
        "Update the authenticated user's profile fields. Only whitelisted fields are accepted. Returns the full updated profile.",
    })
    .output(
      z.object({
        user: meProfileSchema,
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const userId = ctx.session!.id;

      // Build the update set from provided fields
      const { meta: metaInput, ...directFields } = input;

      const updateSet: Record<string, unknown> = { ...directFields };

      // Merge meta atomically at the SQL layer to avoid lost-update races
      // between concurrent PATCH /profile calls (e.g. avatar upload + form
      // submit). Read-modify-write would let the second writer overwrite the
      // first writer's merge. Postgres `jsonb ||` is a single-statement
      // shallow merge that matches the JS `{ ...existing, ...input }`
      // semantics the tests assert on. The `users.meta` column is `json`
      // (not `jsonb`), so we cast both sides to jsonb for the merge — the
      // resulting jsonb value is implicitly cast back to json on assignment.
      if (metaInput !== undefined) {
        updateSet.meta = sql`(COALESCE(${schema.users.meta}::jsonb, '{}'::jsonb) || ${JSON.stringify(metaInput)}::jsonb)`;
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
    .output(
      z.object({
        orgs: z.array(
          z.object({
            id: z.number().int().min(1),
            name: z.string(),
            isActive: z.boolean(),
          }),
        ),
      }),
    )
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
  deletePosition: protectedProcedure
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
    .output(
      z.object({
        success: z.boolean(),
        found: z.boolean(),
      }),
    )
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
  deleteRole: protectedProcedure
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
    .output(
      z.object({
        success: z.boolean(),
        found: z.boolean(),
      }),
    )
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
   * Requires either userId (to resolve a specific user) or searchTerm (≥2 chars) to filter results.
   */
  users: protectedProcedure
    .input(
      z
        .object({
          userId: z.coerce
            .number()
            .int()
            .min(1)
            .optional()
            .describe("When provided, returns only the matching user ID."),
          searchTerm: z
            .string()
            .min(2)
            .optional()
            .describe(
              "Search term for filtering users by f3Name. Case-insensitive partial match.",
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
        "Pass userId to resolve a specific user, or searchTerm (≥2 chars) to search all users.",
    })
    .output(
      z.object({
        users: z.array(meUsersListItemSchema),
      }),
    )
    .handler(async ({ context: ctx, input }) => {
      const userId = input?.userId;
      const searchTerm = input?.searchTerm;

      const conditions = [];
      if (userId) {
        conditions.push(eq(schema.users.id, userId));
      }
      if (searchTerm) {
        conditions.push(ilike(schema.users.f3Name, `%${searchTerm}%`));
      }

      const rows = await ctx.db
        .select({
          id: schema.users.id,
          f3Name: schema.users.f3Name,
          homeRegionId: schema.users.homeRegionId,
          homeRegionName: sql<string | null>`${schema.orgs.name}`,
          status: schema.users.status,
        })
        .from(schema.users)
        .leftJoin(schema.orgs, eq(schema.orgs.id, schema.users.homeRegionId))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(asc(schema.users.f3Name), asc(schema.users.id));

      return { users: rows };
    }),
};
