/**
 * Framework-agnostic test fixtures for @acme/api.
 *
 * Deliberately free of any `vitest` import so non-vitest consumers can reuse
 * them — notably the apps/api characterization suite, which runs under its own
 * config. Vitest-coupled helpers stay in src/__tests__/test-utils.ts, which
 * re-exports everything here.
 */

import type { Session } from "@acme/auth";
import { eq, schema } from "@acme/db";
import { db } from "@acme/db/client";

/**
 * Generates a unique identifier for test data to avoid race conditions
 */
export const uniqueId = (): string =>
  `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The roles getOrCreateRoles() seeds. Single source of truth: fixture role
 * unions derive from this, so widening the seed set is the only edit needed.
 */
export const SEEDED_ROLE_NAMES = ["editor", "admin"] as const;
export type SeededRoleName = (typeof SEEDED_ROLE_NAMES)[number];

/**
 * Ensures required roles (editor, admin) exist in the roles table.
 * Many tests depend on these roles being present for role assignment to work.
 */
export const getOrCreateRoles = async (): Promise<void> => {
  const existing = await db.select().from(schema.roles);
  const existingNames = new Set(existing.map((r) => r.name));

  for (const roleName of SEEDED_ROLE_NAMES) {
    if (!existingNames.has(roleName)) {
      await db
        .insert(schema.roles)
        .values({ name: roleName, description: `${roleName} role` });
    }
  }
};

export interface FixtureOrg {
  id: number;
  name: string | null;
}

/**
 * Gets or creates the F3 Nation org (required for admin operations)
 * This uses the same query pattern as the routers do to find the nation org.
 *
 * Constraint for auth fixtures: in the seeded test DB this returns the existing
 * nation org `{ id: 1, name: "Test Nation" }`. isNationAdminFromSession
 * (packages/shared/src/app/role-checks.ts) requires both orgId === 1 AND
 * orgName?.toLowerCase().includes("f3 nation"). The id matches; the NAME does
 * not — so a JWT or API-key fixture (orgName read from this row) structurally
 * cannot produce a nation-admin session, while a cookie fixture (orgName passed
 * as a literal) can. A nation-admin case needs an org seeded/renamed to satisfy
 * that name check.
 */
export const getOrCreateF3NationOrg = async (): Promise<FixtureOrg> => {
  // First check for any nation org (matching how routers find the nation)
  const [nationOrg] = await db
    .select({ id: schema.orgs.id, name: schema.orgs.name })
    .from(schema.orgs)
    .where(eq(schema.orgs.orgType, "nation"))
    .limit(1);

  if (nationOrg) {
    return nationOrg;
  }

  // If no nation org exists, create one named "F3 Nation"
  const [created] = await db
    .insert(schema.orgs)
    .values({
      name: "F3 Nation",
      orgType: "nation",
      isActive: true,
    })
    .returning({ id: schema.orgs.id, name: schema.orgs.name });

  if (!created) {
    throw new Error("Failed to create F3 Nation org");
  }

  return created;
};

/**
 * Creates a mock session with admin role for the nation org
 */
export const createAdminSession = async (): Promise<Session> => {
  const nationOrg = await getOrCreateF3NationOrg();
  const orgName = nationOrg.name ?? "F3 Nation";
  return {
    id: 1,
    email: "admin@example.com",
    user: {
      id: "1",
      email: "admin@example.com",
      name: "Admin",
      roles: [{ orgId: nationOrg.id, orgName, roleName: "admin" }],
    },
    roles: [{ orgId: nationOrg.id, orgName, roleName: "admin" }],
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  };
};

/**
 * Creates a mock session with editor role for a specific org
 */
export const createEditorSession = (params: {
  orgId: number;
  orgName: string;
}): Session => {
  return {
    id: 1,
    email: "editor@example.com",
    user: {
      id: "1",
      email: "editor@example.com",
      name: "Editor",
      roles: [
        { orgId: params.orgId, orgName: params.orgName, roleName: "editor" },
      ],
    },
    roles: [
      { orgId: params.orgId, orgName: params.orgName, roleName: "editor" },
    ],
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  };
};

/**
 * Creates a mock session for a regular user with no org roles
 */
export const createUserSession = (params: {
  userId: number;
  email: string;
  f3Name?: string;
}): Session => {
  const email = params.email;
  return {
    id: params.userId,
    email,
    user: {
      id: String(params.userId),
      email,
      name: params.f3Name ?? "Test User",
      roles: [],
    },
    roles: [],
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  };
};

/**
 * Creates a session with no permissions (for testing unauthorized access)
 */
export const createNoPermissionSession = (): Session => {
  return {
    id: 999,
    email: "noperm@example.com",
    user: {
      id: "999",
      email: "noperm@example.com",
      name: "No Permission User",
      roles: [],
    },
    roles: [],
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  };
};

/** Cleanup helpers keyed by entity — each deletes a row and its FK dependents. */
export interface Cleanup {
  user(userId: number): Promise<void>;
  event(eventId: number): Promise<void>;
  eventType(eventTypeId: number): Promise<void>;
  location(locationId: number): Promise<void>;
  org(orgId: number): Promise<void>;
  apiKey(apiKeyId: number): Promise<void>;
  updateRequest(requestId: string): Promise<void>;
}

/**
 * Cleanup helpers - delete in the correct order to respect FK constraints
 */
export const cleanup: Cleanup = {
  /**
   * Delete a user and all their roles
   */
  async user(userId: number) {
    await db
      .delete(schema.rolesXUsersXOrg)
      .where(eq(schema.rolesXUsersXOrg.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  },

  /**
   * Delete an event and its type associations
   */
  async event(eventId: number) {
    await db
      .delete(schema.eventsXEventTypes)
      .where(eq(schema.eventsXEventTypes.eventId, eventId));
    await db.delete(schema.events).where(eq(schema.events.id, eventId));
  },

  /**
   * Delete an event type and its event associations
   */
  async eventType(eventTypeId: number) {
    await db
      .delete(schema.eventsXEventTypes)
      .where(eq(schema.eventsXEventTypes.eventTypeId, eventTypeId));
    await db
      .delete(schema.eventTypes)
      .where(eq(schema.eventTypes.id, eventTypeId));
  },

  /**
   * Delete a location
   */
  async location(locationId: number) {
    // First update any events that reference this location
    await db
      .update(schema.events)
      .set({ locationId: null })
      .where(eq(schema.events.locationId, locationId));
    // Update any orgs that have this as default location
    await db
      .update(schema.orgs)
      .set({ defaultLocationId: null })
      .where(eq(schema.orgs.defaultLocationId, locationId));
    await db
      .delete(schema.locations)
      .where(eq(schema.locations.id, locationId));
  },

  /**
   * Delete an org and its role associations
   */
  async org(orgId: number) {
    await db
      .delete(schema.rolesXUsersXOrg)
      .where(eq(schema.rolesXUsersXOrg.orgId, orgId));
    await db
      .delete(schema.rolesXApiKeysXOrg)
      .where(eq(schema.rolesXApiKeysXOrg.orgId, orgId));
    await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
  },

  /**
   * Delete an API key and its role associations
   */
  async apiKey(apiKeyId: number) {
    await db
      .delete(schema.rolesXApiKeysXOrg)
      .where(eq(schema.rolesXApiKeysXOrg.apiKeyId, apiKeyId));
    await db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, apiKeyId));
  },

  /**
   * Delete an update request
   */
  async updateRequest(requestId: string) {
    await db
      .delete(schema.updateRequests)
      .where(eq(schema.updateRequests.id, requestId));
  },
};

export { db };
