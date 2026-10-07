/**
 * Tests for Org Router endpoints
 *
 * These tests require:
 * - TEST_DATABASE_URL environment variable to be set
 * - Test database to be seeded with test data
 */

import { vi } from "vitest";

// Use vi.hoisted to ensure mockLimit is available when vi.mock runs (mocks are hoisted)
const mockLimit = vi.hoisted(() => vi.fn());

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mockLimit };
  }),
}));

import { and, count, eq, gte, schema } from "@acme/db";
import type { OrgType } from "@acme/shared/app/enums";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  createAdminSession,
  createEditorSession,
  createTestClient,
  db,
  getOrCreateF3NationOrg,
  mockAuthWithSession,
  uniqueId,
} from "../__tests__/test-utils";
/** Returns the YYYY-MM-DD date string for the nth upcoming Monday (UTC). n=1 is next Monday. */
const nextFutureMonday = (n: number): string => {
  const d = new Date();
  const daysUntilNextMonday = (1 - d.getUTCDay() + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysUntilNextMonday + (n - 1) * 7);
  return d.toISOString().split("T")[0]!;
};
describe("Org Router", () => {
  // Track created orgs for cleanup
  const createdOrgIds: number[] = [];
  // Track created users for cleanup (only the accessible/non-nation-admin
  // tests need a real DB-backed user — everything else uses a purely mocked
  // session)
  const createdUserIds: number[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset rate limiter to allow requests
    mockLimit.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60000,
    });
  });

  afterAll(async () => {
    // Users first — roles_x_users_x_org rows on the orgs below reference
    // them, and cleanup.user already deletes its own role rows, but doing
    // it in this order avoids relying on that ordering being safe both ways.
    for (const userId of createdUserIds.reverse()) {
      try {
        await cleanup.user(userId);
      } catch {
        // Ignore errors during cleanup
      }
    }
    // Clean up all created orgs in reverse order
    for (const orgId of createdOrgIds.reverse()) {
      try {
        await cleanup.org(orgId);
      } catch {
        // Ignore errors during cleanup
      }
    }
  });

  describe("all", () => {
    it("should return a list of orgs with required orgTypes", async () => {
      const client = createTestClient();
      const result = await client.org.all({
        orgTypes: ["region"],
        pageIndex: 0,
        pageSize: 10,
      });

      expect(result).toHaveProperty("orgs");
      expect(result).toHaveProperty("total");
      expect(Array.isArray(result.orgs)).toBe(true);
    });

    it("should paginate without overlapping org ids between pages", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const prefix = `PaginateTest-${uniqueId()}`;
      const insertedIds: number[] = [];
      for (let i = 0; i < 3; i++) {
        const [org] = await db
          .insert(schema.orgs)
          .values({
            name: `${prefix} Region ${i}`,
            orgType: "region",
            parentId: f3Nation.id,
            isActive: true,
          })
          .returning();
        if (org) {
          createdOrgIds.push(org.id);
          insertedIds.push(org.id);
        }
      }

      const client = createTestClient();

      // Use searchTerm to scope queries to only our test orgs
      const all = await client.org.all({
        orgTypes: ["region"],
        searchTerm: prefix,
        pageIndex: 0,
        pageSize: 100,
      });

      expect(all.total).toBeGreaterThanOrEqual(3);

      const page1 = await client.org.all({
        orgTypes: ["region"],
        searchTerm: prefix,
        pageIndex: 0,
        pageSize: 2,
      });

      expect(page1.orgs.length).toBe(2);
      expect(page1.total).toBe(all.total);

      const page2 = await client.org.all({
        orgTypes: ["region"],
        searchTerm: prefix,
        pageIndex: 1,
        pageSize: 2,
      });

      expect(page1.total).toBe(3);
      expect(page1.orgs).toHaveLength(2);
      expect(page2.orgs).toHaveLength(1);

      const page1Ids = new Set(page1.orgs.map((o) => o.id));
      const page2Ids = new Set(page2.orgs.map((o) => o.id));
      // Consecutive pages must be disjoint — same org must not appear twice
      expect([...page2Ids].every((id) => !page1Ids.has(id))).toBe(true);

      const seen = new Set([...page1Ids, ...page2Ids]);
      expect(seen.size).toBe(insertedIds.length);
      for (const id of insertedIds) {
        expect(seen.has(id)).toBe(true);
      }
    });

    it("should filter by status", async () => {
      const client = createTestClient();
      const activeOrgs = await client.org.all({
        orgTypes: ["region"],
        statuses: ["active"],
        pageIndex: 0,
        pageSize: 10,
      });

      expect(activeOrgs.orgs.every((o) => o.isActive === true)).toBe(true);
    });

    it("should search by name", async () => {
      const client = createTestClient();
      const result = await client.org.all({
        orgTypes: ["region", "ao", "nation"],
        searchTerm: "F3",
        pageIndex: 0,
        pageSize: 10,
      });

      // Results should match search term in name or description
      result.orgs.forEach((org) => {
        const searchLower = "f3".toLowerCase();
        const matches =
          org.name?.toLowerCase().includes(searchLower) ||
          org.description?.toLowerCase().includes(searchLower);
        expect(matches).toBe(true);
      });
    });

    it("does not duplicate or skip rows across pages when many orgs share a name", async () => {
      // asc(id) is appended unconditionally after the caller's sort (see the
      // `.concat(asc(org.id))` in this router) specifically so a non-unique
      // sort key like `name` still gets a deterministic order. Without it,
      // Postgres doesn't guarantee tie order is stable across the separate
      // requests a paging client (e.g. useFetchAllPages) makes.
      const f3Nation = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const prefix = `TieBreakTest-${uniqueId()}`;
      const sharedName = `${prefix} Shared Region`;
      const insertedIds: number[] = [];
      for (let i = 0; i < 5; i++) {
        const [org] = await db
          .insert(schema.orgs)
          .values({
            name: sharedName,
            orgType: "region",
            parentId: f3Nation.id,
            isActive: true,
          })
          .returning();
        if (!org) throw new Error("Failed to create test org");
        createdOrgIds.push(org.id);
        insertedIds.push(org.id);
      }

      const client = createTestClient();
      const seenIds: number[] = [];
      for (let pageIndex = 0; pageIndex < 3; pageIndex++) {
        const page = await client.org.all({
          orgTypes: ["region"],
          searchTerm: prefix,
          sorting: [{ id: "name", desc: false }],
          pageIndex,
          pageSize: 2,
        });
        seenIds.push(...page.orgs.map((o) => o.id));
      }

      expect(seenIds).toHaveLength(5);
      expect(new Set(seenIds).size).toBe(5);
      // Every id inserted must be seen exactly once, and (since all 5 rows
      // share a name) they must come back in ascending id order -- that's
      // what would break if the asc(id) tiebreaker were removed.
      const sortedByIdAsc = insertedIds.slice().sort((a, b) => a - b);
      expect(seenIds).toEqual(sortedByIdAsc);
    });
  });

  describe("accessible", () => {
    /**
     * Sets up a real (DB-backed, not just a mocked session) editor user with
     * a role on every org in `orgIds` — org.accessible's non-nation-admin
     * branch reads roles_x_users_x_org straight from the DB via
     * ctx.session.id (see getEditableOrgIdsForUser), so a purely mocked
     * session like createEditorSession isn't enough to exercise it.
     */
    const createDbBackedEditorSession = async (orgIds: number[]) => {
      const [user] = await db
        .insert(schema.users)
        .values({
          email: `test-editor-${uniqueId()}@example.com`,
          f3Name: `TestEditor ${uniqueId()}`,
        })
        .returning();
      if (!user) throw new Error("Failed to create test user");
      createdUserIds.push(user.id);

      const [editorRole] = await db
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .where(eq(schema.roles.name, "editor"));
      if (!editorRole) throw new Error("Editor role not found in DB");

      for (const orgId of orgIds) {
        await db.insert(schema.rolesXUsersXOrg).values({
          roleId: editorRole.id,
          userId: user.id,
          orgId,
        });
      }

      return {
        id: user.id,
        email: user.email,
        user: {
          id: String(user.id),
          email: user.email,
          name: user.f3Name,
          roles: [],
        },
        roles: [],
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      };
    };

    /**
     * org.accessible's nation-admin branch checks `roles_x_users_x_org`
     * directly for (userId, F3 Nation orgId) via a raw DB query -- unlike
     * createAdminSession's mocked `session.roles` claims (which other
     * routers read instead), that check isn't satisfied unless a real row
     * exists, so this inserts one for a fresh DB-backed user.
     */
    const createDbBackedNationAdminSession = async (f3NationOrgId: number) => {
      const [user] = await db
        .insert(schema.users)
        .values({
          email: `test-nation-admin-${uniqueId()}@example.com`,
          f3Name: `TestNationAdmin ${uniqueId()}`,
        })
        .returning();
      if (!user) throw new Error("Failed to create test user");
      createdUserIds.push(user.id);

      const [anyRole] = await db
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .limit(1);
      if (!anyRole) throw new Error("No roles found in DB");

      await db.insert(schema.rolesXUsersXOrg).values({
        roleId: anyRole.id,
        userId: user.id,
        orgId: f3NationOrgId,
      });

      return {
        id: user.id,
        email: user.email,
        user: {
          id: String(user.id),
          email: user.email,
          name: user.f3Name,
          roles: [],
        },
        roles: [],
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      };
    };

    it("paginates the non-nation-admin branch when only pageSize is sent", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const prefix = `AccessibleTest-${uniqueId()}`;
      const orgIds: number[] = [];
      for (let i = 0; i < 3; i++) {
        const [org] = await db
          .insert(schema.orgs)
          .values({
            name: `${prefix} Region ${i}`,
            orgType: "region",
            parentId: f3Nation.id,
            isActive: true,
          })
          .returning();
        if (!org) throw new Error("Failed to create test org");
        createdOrgIds.push(org.id);
        orgIds.push(org.id);
      }

      // A direct editor role on each of the 3 orgs — this user is not a
      // nation admin, so org.accessible resolves them through
      // getEditableOrgIdsForUser, a distinct code path from the "all" tests
      // above (which only exercise the nation-admin branch). Both branches
      // paginate via SQL LIMIT/OFFSET.
      const session = await createDbBackedEditorSession(orgIds);
      await mockAuthWithSession(session);

      const client = createTestClient();

      // The regression this whole PR fixes: sending pageSize ALONE (no
      // pageIndex) must still paginate, not silently return every row.
      const page = await client.org.accessible({ pageSize: 2 });

      expect(page.total).toBe(3);
      expect(page.orgs).toHaveLength(2);
      expect(orgIds).toEqual(
        expect.arrayContaining(page.orgs.map((o) => o.id)),
      );
    });

    it("returns every editable org exactly once when paging through with pageIndex", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const prefix = `AccessiblePagingTest-${uniqueId()}`;
      const orgIds: number[] = [];
      for (let i = 0; i < 5; i++) {
        const [org] = await db
          .insert(schema.orgs)
          .values({
            name: `${prefix} Region ${i}`,
            orgType: "region",
            parentId: f3Nation.id,
            isActive: true,
          })
          .returning();
        if (!org) throw new Error("Failed to create test org");
        createdOrgIds.push(org.id);
        orgIds.push(org.id);
      }

      const session = await createDbBackedEditorSession(orgIds);
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Pages of 2 across 5 orgs: 3 requests, last one partial. Sorting
      // pushed into SQL (this PR) still needs the asc(id) tiebreaker to
      // guarantee this — with a non-unique sort key and no tiebreaker, a
      // caller paging through separate requests (e.g. useFetchAllPages)
      // could see the same org twice or skip one entirely.
      const seenIds: number[] = [];
      for (let pageIndex = 0; pageIndex < 3; pageIndex++) {
        const page = await client.org.accessible({ pageIndex, pageSize: 2 });
        expect(page.total).toBe(5);
        seenIds.push(...page.orgs.map((o) => o.id));
      }

      expect(seenIds).toHaveLength(5);
      expect(new Set(seenIds).size).toBe(5);
      expect(seenIds.sort()).toEqual(orgIds.slice().sort());
    });

    it("does not duplicate or skip rows for a non-nation-admin editor when many orgs share a name", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const prefix = `AccessibleTieBreakTest-${uniqueId()}`;
      const sharedName = `${prefix} Shared Region`;
      const orgIds: number[] = [];
      for (let i = 0; i < 5; i++) {
        const [org] = await db
          .insert(schema.orgs)
          .values({
            name: sharedName,
            orgType: "region",
            parentId: f3Nation.id,
            isActive: true,
          })
          .returning();
        if (!org) throw new Error("Failed to create test org");
        createdOrgIds.push(org.id);
        orgIds.push(org.id);
      }

      const session = await createDbBackedEditorSession(orgIds);
      await mockAuthWithSession(session);

      const client = createTestClient();
      const seenIds: number[] = [];
      for (let pageIndex = 0; pageIndex < 3; pageIndex++) {
        const page = await client.org.accessible({
          sorting: [{ id: "name", desc: false }],
          pageIndex,
          pageSize: 2,
        });
        expect(page.total).toBe(5);
        seenIds.push(...page.orgs.map((o) => o.id));
      }

      expect(seenIds).toHaveLength(5);
      expect(new Set(seenIds).size).toBe(5);
      // All 5 share a name, so only the asc(id) tiebreaker keeps their
      // order stable across these separate paged requests.
      expect(seenIds).toEqual(orgIds.slice().sort((a, b) => a - b));
    });

    it("does not duplicate or skip rows for a nation admin when many orgs share a name", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const session = await createDbBackedNationAdminSession(f3Nation.id);
      await mockAuthWithSession(session);

      const prefix = `AccessibleNationTieBreakTest-${uniqueId()}`;
      const sharedName = `${prefix} Shared Region`;
      const insertedIds: number[] = [];
      for (let i = 0; i < 5; i++) {
        const [org] = await db
          .insert(schema.orgs)
          .values({
            name: sharedName,
            orgType: "region",
            parentId: f3Nation.id,
            isActive: true,
          })
          .returning();
        if (!org) throw new Error("Failed to create test org");
        createdOrgIds.push(org.id);
        insertedIds.push(org.id);
      }

      const [regionCountRow] = await db
        .select({ value: count(schema.orgs.id) })
        .from(schema.orgs)
        .where(eq(schema.orgs.orgType, "region"));
      const regionCount = regionCountRow?.value ?? 0;

      const client = createTestClient();
      const pageSize = 2;
      const pageCount = Math.ceil(regionCount / pageSize);
      const seenIds: number[] = [];
      let total = 0;
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
        const page = await client.org.accessible({
          orgTypes: ["region"],
          sorting: [{ id: "name", desc: false }],
          pageIndex,
          pageSize,
        });
        total = page.total;
        for (const org of page.orgs) {
          expect(org.orgType).toBe("region");
          expect(org.roles).toEqual([]);
        }
        seenIds.push(...page.orgs.map((o) => o.id));
      }

      expect(total).toBe(regionCount);
      expect(seenIds).toHaveLength(regionCount);
      expect(new Set(seenIds).size).toBe(regionCount);

      // Within the equal-name group, ties must come back in a stable
      // ascending id order across these separate page requests -- Postgres
      // doesn't guarantee tie order on its own, so this is what the
      // asc(id) tiebreaker in the nation branch's getSortingColumns call is
      // actually for.
      const seenSharedIds = seenIds.filter((id) => insertedIds.includes(id));
      expect(seenSharedIds).toEqual(insertedIds.slice().sort((a, b) => a - b));
    });
  });

  describe("byId", () => {
    it("should return an org by ID", async () => {
      const client = createTestClient();

      // Get a test org ID
      const [testOrg] = await db
        .select({ id: schema.orgs.id })
        .from(schema.orgs)
        .limit(1);

      if (testOrg) {
        const result = await client.org.byId({
          id: testOrg.id,
        });

        expect(result).toHaveProperty("org");
        expect(result.org).not.toBeNull();
        expect(result.org?.id).toBe(testOrg.id);
      }
    });

    it("should return null for non-existent org", async () => {
      const client = createTestClient();
      const result = await client.org.byId({
        id: 999999,
      });

      expect(result.org).toBeNull();
    });
  });

  describe("crupdate", () => {
    it("should create a new region org", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const orgName = `Test Region ${uniqueId()}`;

      const result = await client.org.crupdate({
        name: orgName,
        orgType: "region",
        parentId: f3Nation.id,
        isActive: true,
        email: "test@example.com",
        phone: null,
        description: null,
        website: null,
        twitter: null,
        facebook: null,
        instagram: null,
      });

      expect(result).toHaveProperty("org");
      expect(result.org).not.toBeNull();
      expect(result.org?.name).toBe(orgName);
      expect(result.org?.orgType).toBe("region");

      if (result.org) {
        createdOrgIds.push(result.org.id);
      }
    });

    it("should require parentId or id", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.org.crupdate({
          name: "Test Org",
          orgType: "region",
          isActive: true,
          email: "test@example.com",
          phone: null,
          description: null,
          website: null,
          twitter: null,
          facebook: null,
          instagram: null,
        }),
      ).rejects.toThrow("Parent ID or ID is required");
    });

    it("should update an existing org", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Create an org first
      const [testOrg] = await db
        .insert(schema.orgs)
        .values({
          name: `Original Region ${uniqueId()}`,
          orgType: "region",
          parentId: f3Nation.id,
          isActive: true,
        })
        .returning();

      if (!testOrg) {
        return;
      }
      createdOrgIds.push(testOrg.id);

      // Update it
      const updatedName = `Updated Region ${uniqueId()}`;
      const result = await client.org.crupdate({
        id: testOrg.id,
        name: updatedName,
        orgType: "region",
        parentId: f3Nation.id,
        isActive: true,
        email: "test@example.com",
        phone: null,
        description: null,
        website: null,
        twitter: null,
        facebook: null,
        instagram: null,
      });

      expect(result.org?.id).toBe(testOrg.id);
      expect(result.org?.name).toBe(updatedName);
    });

    it("should enforce editor permissions", async () => {
      const f3Nation = await getOrCreateF3NationOrg();

      // Create a session with editor role on a different org
      const session = createEditorSession({
        orgId: 99999,
        orgName: "Other Org",
      });
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.org.crupdate({
          name: "Unauthorized Org",
          orgType: "region",
          parentId: f3Nation.id,
          isActive: true,
          email: "test@example.com",
          phone: null,
          description: null,
          website: null,
          twitter: null,
          facebook: null,
          instagram: null,
        }),
      ).rejects.toThrow();
    });

    it("should require editor permission on the destination region when moving an AO", async () => {
      const f3Nation = await getOrCreateF3NationOrg();

      const [sourceRegion] = await db
        .insert(schema.orgs)
        .values({
          name: `Source Region ${uniqueId()}`,
          orgType: "region",
          parentId: f3Nation.id,
          isActive: true,
        })
        .returning();

      const [destinationRegion] = await db
        .insert(schema.orgs)
        .values({
          name: `Destination Region ${uniqueId()}`,
          orgType: "region",
          parentId: f3Nation.id,
          isActive: true,
        })
        .returning();

      if (!sourceRegion || !destinationRegion) {
        throw new Error("Failed to create test regions");
      }

      createdOrgIds.push(sourceRegion.id, destinationRegion.id);

      const [ao] = await db
        .insert(schema.orgs)
        .values({
          name: `AO Move Permission ${uniqueId()}`,
          orgType: "ao",
          parentId: sourceRegion.id,
          isActive: true,
        })
        .returning();

      if (!ao) {
        throw new Error("Failed to create test AO");
      }

      createdOrgIds.push(ao.id);

      const session = createEditorSession({
        orgId: sourceRegion.id,
        orgName: sourceRegion.name,
      });
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.org.crupdate({
          id: ao.id,
          name: ao.name,
          orgType: "ao",
          parentId: destinationRegion.id,
          isActive: true,
          email: null,
          phone: null,
          description: null,
          website: null,
          twitter: null,
          facebook: null,
          instagram: null,
        }),
      ).rejects.toThrow("destination parent");
    });

    it("should require editor permission on the destination parent when moving a region", async () => {
      const f3Nation = await getOrCreateF3NationOrg();

      const [sourceSector] = await db
        .insert(schema.orgs)
        .values({
          name: `Source Sector ${uniqueId()}`,
          orgType: "sector",
          parentId: f3Nation.id,
          isActive: true,
        })
        .returning();

      const [destinationSector] = await db
        .insert(schema.orgs)
        .values({
          name: `Destination Sector ${uniqueId()}`,
          orgType: "sector",
          parentId: f3Nation.id,
          isActive: true,
        })
        .returning();

      if (!sourceSector || !destinationSector) {
        throw new Error("Failed to create test sectors");
      }

      createdOrgIds.push(sourceSector.id, destinationSector.id);

      const [region] = await db
        .insert(schema.orgs)
        .values({
          name: `Region Move Permission ${uniqueId()}`,
          orgType: "region",
          parentId: sourceSector.id,
          isActive: true,
        })
        .returning();

      if (!region) {
        throw new Error("Failed to create test region");
      }

      createdOrgIds.push(region.id);

      const session = createEditorSession({
        orgId: sourceSector.id,
        orgName: sourceSector.name,
      });
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.org.crupdate({
          id: region.id,
          name: region.name,
          orgType: "region",
          parentId: destinationSector.id,
          isActive: true,
          email: null,
          phone: null,
          description: null,
          website: null,
          twitter: null,
          facebook: null,
          instagram: null,
        }),
      ).rejects.toThrow("destination parent");
    });

    it("should not bypass destination permission checks for parentId zero", async () => {
      const f3Nation = await getOrCreateF3NationOrg();

      const [sourceRegion] = await db
        .insert(schema.orgs)
        .values({
          name: `Zero Source Region ${uniqueId()}`,
          orgType: "region",
          parentId: f3Nation.id,
          isActive: true,
        })
        .returning();

      if (!sourceRegion) {
        throw new Error("Failed to create source region");
      }

      createdOrgIds.push(sourceRegion.id);

      const [existingZeroRegion] = await db
        .select()
        .from(schema.orgs)
        .where(eq(schema.orgs.id, 0));

      const zeroRegion =
        existingZeroRegion ??
        (
          await db
            .insert(schema.orgs)
            .values({
              id: 0,
              name: `Zero Region ${uniqueId()}`,
              orgType: "region",
              parentId: f3Nation.id,
              isActive: true,
            })
            .returning()
        )[0];

      if (!zeroRegion) {
        throw new Error("Failed to create zero region");
      }

      if (!existingZeroRegion) {
        createdOrgIds.push(zeroRegion.id);
      }

      const [ao] = await db
        .insert(schema.orgs)
        .values({
          name: `AO Zero Move ${uniqueId()}`,
          orgType: "ao",
          parentId: sourceRegion.id,
          isActive: true,
        })
        .returning();

      if (!ao) {
        throw new Error("Failed to create test AO");
      }

      createdOrgIds.push(ao.id);

      const session = createEditorSession({
        orgId: sourceRegion.id,
        orgName: sourceRegion.name,
      });
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.org.crupdate({
          id: ao.id,
          name: ao.name,
          orgType: "ao",
          parentId: zeroRegion.id,
          isActive: true,
          email: null,
          phone: null,
          description: null,
          website: null,
          twitter: null,
          facebook: null,
          instagram: null,
        }),
      ).rejects.toThrow("destination parent");
    });

    it("should reject creating a region parented directly to an ao", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const [ao] = await db
        .insert(schema.orgs)
        .values({
          name: `Ao Parent Attempt ${uniqueId()}`,
          orgType: "ao",
          parentId: f3Nation.id,
          isActive: true,
        })
        .returning();

      if (!ao) {
        throw new Error("Failed to create test ao");
      }

      createdOrgIds.push(ao.id);

      const client = createTestClient();

      await expect(
        client.org.crupdate({
          name: "Region Under Ao",
          orgType: "region",
          parentId: ao.id,
          isActive: true,
          email: null,
          phone: null,
          description: null,
          website: null,
          twitter: null,
          facebook: null,
          instagram: null,
        }),
      ).rejects.toThrow(/Region.*AO/);
    });

    it("should reject moving a region to be parented by an ao", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const [sourceSector] = await db
        .insert(schema.orgs)
        .values({
          name: `Move Reject Sector ${uniqueId()}`,
          orgType: "sector",
          parentId: f3Nation.id,
          isActive: true,
        })
        .returning();

      if (!sourceSector) {
        throw new Error("Failed to create source sector");
      }

      createdOrgIds.push(sourceSector.id);

      const [destinationAo] = await db
        .insert(schema.orgs)
        .values({
          name: `Move Reject Ao ${uniqueId()}`,
          orgType: "ao",
          parentId: sourceSector.id,
          isActive: true,
        })
        .returning();

      if (!destinationAo) {
        throw new Error("Failed to create destination ao");
      }

      createdOrgIds.push(destinationAo.id);

      const [region] = await db
        .insert(schema.orgs)
        .values({
          name: `Move Reject Region ${uniqueId()}`,
          orgType: "region",
          parentId: sourceSector.id,
          isActive: true,
        })
        .returning();

      if (!region) {
        throw new Error("Failed to create test region");
      }

      createdOrgIds.push(region.id);

      const client = createTestClient();

      await expect(
        client.org.crupdate({
          id: region.id,
          name: region.name,
          orgType: "region",
          parentId: destinationAo.id,
          isActive: true,
          email: null,
          phone: null,
          description: null,
          website: null,
          twitter: null,
          facebook: null,
          instagram: null,
        }),
      ).rejects.toThrow(/Region.*AO/);
    });

    const blankFields = {
      isActive: true,
      email: null,
      phone: null,
      description: null,
      website: null,
      twitter: null,
      facebook: null,
      instagram: null,
    };

    const createSectorAndTerritory = async (
      client: ReturnType<typeof createTestClient>,
    ) => {
      const nation = await getOrCreateF3NationOrg();
      const sector = await client.org.crupdate({
        ...blankFields,
        name: `Territory Sector ${uniqueId()}`,
        orgType: "sector",
        parentId: nation.id,
      });
      expect(sector.org).not.toBeNull();
      createdOrgIds.push(sector.org!.id);
      const territory = await client.org.crupdate({
        ...blankFields,
        name: `Territory ${uniqueId()}`,
        orgType: "territory",
        parentId: sector.org!.id,
      });
      expect(territory.org?.orgType).toBe("territory");
      createdOrgIds.push(territory.org!.id);
      return { sector: sector.org!, territory: territory.org! };
    };

    it("persists and lists Territory, allows Areas beneath it, and rejects a Territory beneath an Area", async () => {
      await mockAuthWithSession(await createAdminSession());
      const client = createTestClient();
      const { sector, territory } = await createSectorAndTerritory(client);
      const parentOf = async (id: number) =>
        (await db.query.orgs.findFirst({ where: eq(schema.orgs.id, id) }))
          ?.parentId;

      const areaUnderTerritory = await client.org.crupdate({
        ...blankFields,
        name: `Territory Area ${uniqueId()}`,
        orgType: "area",
        parentId: territory.id,
      });
      expect(areaUnderTerritory.org?.parentId).toBe(territory.id);
      createdOrgIds.push(areaUnderTerritory.org!.id);

      const area = await client.org.crupdate({
        ...blankFields,
        name: `Sector Area ${uniqueId()}`,
        orgType: "area",
        parentId: sector.id,
      });
      expect(area.org?.parentId).toBe(sector.id);
      createdOrgIds.push(area.org!.id);

      const moveArea = (parentId: number) =>
        client.org.crupdate({
          ...blankFields,
          id: area.org!.id,
          name: area.org!.name,
          orgType: "area",
          parentId,
        });
      await moveArea(territory.id);
      expect(await parentOf(area.org!.id)).toBe(territory.id);
      await moveArea(sector.id);
      expect(await parentOf(area.org!.id)).toBe(sector.id);

      await expect(
        client.org.crupdate({
          ...blankFields,
          name: `Invalid Territory ${uniqueId()}`,
          orgType: "territory",
          parentId: area.org!.id,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const listed = await client.org.all({
        orgTypes: ["territory"],
        sorting: [{ id: "orgType", desc: false }],
        searchTerm: territory.name,
      });
      expect(listed.orgs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: territory.id, orgType: "territory" }),
        ]),
      );
    });

    it("counts an Area's AOs in its Territory and Sector, following the Area between parents", async () => {
      await mockAuthWithSession(await createAdminSession());
      const client = createTestClient();
      const { sector, territory } = await createSectorAndTerritory(client);
      const create = async (
        orgType: "area" | "region" | "ao",
        parentId: number,
      ) => {
        const result = await client.org.crupdate({
          ...blankFields,
          name: `Count ${orgType} ${uniqueId()}`,
          orgType,
          parentId,
        });
        createdOrgIds.push(result.org!.id);
        return result.org!;
      };
      const area = await create("area", territory.id);
      const region = await create("region", area.id);
      await create("ao", region.id);
      const aoCountOf = async (
        org: { id: number; name: string },
        orgType: "sector" | "territory" | "area",
      ) => {
        const listed = await client.org.all({
          orgTypes: [orgType],
          searchTerm: org.name,
        });
        return listed.orgs.find((candidate) => candidate.id === org.id)
          ?.aoCount;
      };

      expect(await aoCountOf(area, "area")).toBe(1);
      expect(await aoCountOf(territory, "territory")).toBe(1);
      expect(await aoCountOf(sector, "sector")).toBe(1);

      await client.org.crupdate({
        ...blankFields,
        id: area.id,
        name: area.name,
        orgType: "area",
        parentId: sector.id,
      });

      expect(await aoCountOf(territory, "territory")).toBe(0);
      expect(await aoCountOf(sector, "sector")).toBe(1);
    });

    describe("Region Area and Territory parents", () => {
      const createOrg = async (
        client: ReturnType<typeof createTestClient>,
        orgType: "area" | "region" | "ao",
        parentId: number,
        isActive = true,
      ) => {
        const result = await client.org.crupdate({
          ...blankFields,
          name: `Region parent ${orgType} ${uniqueId()}`,
          orgType,
          parentId,
          isActive,
        });
        if (!result.org) throw new Error(`Failed to create ${orgType}`);
        createdOrgIds.push(result.org.id);
        return result.org;
      };
      const saveRegion = (
        client: ReturnType<typeof createTestClient>,
        region: { id: number; name: string },
        parentId: number,
      ) =>
        client.org.crupdate({
          ...blankFields,
          id: region.id,
          name: region.name,
          orgType: "region",
          parentId,
        });
      const listedCounts = async (
        client: ReturnType<typeof createTestClient>,
        named: Record<string, { id: number; name: string; orgType: OrgType }>,
      ) =>
        Object.fromEntries(
          await Promise.all(
            Object.entries(named).map(async ([label, org]) => {
              const result = await client.org.all({
                orgTypes: [org.orgType],
                searchTerm: org.name,
              });
              return [
                label,
                result.orgs.find((candidate) => candidate.id === org.id)
                  ?.aoCount,
              ] as const;
            }),
          ),
        );

      it("persists both Region parent types, unchanged saves, and both move directions with mixed counts", async () => {
        await mockAuthWithSession(await createAdminSession());
        const client = createTestClient();
        const source = await createSectorAndTerritory(client);
        const destination = await createSectorAndTerritory(client);
        const sourceArea = await createOrg(client, "area", source.territory.id);
        const destinationArea = await createOrg(
          client,
          "area",
          destination.territory.id,
        );
        const areaRegion = await createOrg(client, "region", sourceArea.id);
        const directRegion = await createOrg(
          client,
          "region",
          source.territory.id,
        );
        await createOrg(client, "ao", areaRegion.id);
        await createOrg(client, "ao", directRegion.id);
        await createOrg(client, "ao", directRegion.id, false);
        const named = {
          sourceSector: source.sector,
          sourceTerritory: source.territory,
          sourceArea,
          destinationSector: destination.sector,
          destinationTerritory: destination.territory,
          destinationArea,
          areaRegion,
          directRegion,
        };
        const before = {
          sourceSector: 2,
          sourceTerritory: 2,
          sourceArea: 1,
          destinationSector: 0,
          destinationTerritory: 0,
          destinationArea: 0,
          areaRegion: 1,
          directRegion: 1,
        };
        expect(await listedCounts(client, named)).toEqual(before);

        for (const [region, parentId] of [
          [areaRegion, sourceArea.id],
          [directRegion, source.territory.id],
        ] as const) {
          const saved = await saveRegion(client, region, parentId);
          expect(saved.org?.parentId).toBe(parentId);
          expect((await client.org.byId({ id: region.id })).org?.parentId).toBe(
            parentId,
          );
        }
        expect(await listedCounts(client, named)).toEqual(before);

        const moved = await saveRegion(
          client,
          directRegion,
          destinationArea.id,
        );
        expect(moved.org?.parentId).toBe(destinationArea.id);
        expect(
          (await client.org.byId({ id: directRegion.id })).org?.parentId,
        ).toBe(destinationArea.id);
        expect(await listedCounts(client, named)).toEqual({
          ...before,
          sourceSector: 1,
          sourceTerritory: 1,
          destinationSector: 1,
          destinationTerritory: 1,
          destinationArea: 1,
        });

        const restored = await saveRegion(
          client,
          directRegion,
          source.territory.id,
        );
        expect(restored.org?.parentId).toBe(source.territory.id);
        expect(
          (await client.org.byId({ id: directRegion.id })).org?.parentId,
        ).toBe(source.territory.id);
        expect(await listedCounts(client, named)).toEqual(before);
      });

      it("allows a Region-only editor to change ordinary fields but denies moves to an Area or Territory", async () => {
        await mockAuthWithSession(await createAdminSession());
        const client = createTestClient();
        const source = await createSectorAndTerritory(client);
        const destination = await createSectorAndTerritory(client);
        const sourceArea = await createOrg(client, "area", source.territory.id);
        const destinationArea = await createOrg(
          client,
          "area",
          destination.territory.id,
        );
        const region = await createOrg(client, "region", sourceArea.id);
        await createOrg(client, "ao", region.id);
        const editedRegion = {
          ...region,
          name: `Region-only edit ${uniqueId()}`,
        };
        const named = {
          sourceSector: source.sector,
          sourceTerritory: source.territory,
          sourceArea,
          destinationSector: destination.sector,
          destinationTerritory: destination.territory,
          destinationArea,
          region: editedRegion,
        };

        await mockAuthWithSession(
          createEditorSession({ orgId: region.id, orgName: region.name }),
        );
        const saved = await saveRegion(client, editedRegion, sourceArea.id);
        expect(saved.org).toMatchObject({
          id: region.id,
          name: editedRegion.name,
          parentId: sourceArea.id,
        });

        const snapshot = async () => {
          const persisted = (await client.org.byId({ id: region.id })).org;
          return {
            name: persisted?.name,
            parentId: persisted?.parentId,
            counts: await listedCounts(client, named),
          };
        };
        const unchanged = {
          name: editedRegion.name,
          parentId: sourceArea.id,
          counts: {
            sourceSector: 1,
            sourceTerritory: 1,
            sourceArea: 1,
            destinationSector: 0,
            destinationTerritory: 0,
            destinationArea: 0,
            region: 1,
          },
        };
        expect(await snapshot()).toEqual(unchanged);

        for (const parent of [destinationArea, destination.territory]) {
          await expect(
            saveRegion(
              client,
              { ...editedRegion, name: `Rejected Region edit ${uniqueId()}` },
              parent.id,
            ),
          ).rejects.toMatchObject({
            code: "UNAUTHORIZED",
            message:
              "You are not authorized to move this org to the destination parent organization",
          });
          expect(await snapshot()).toEqual(unchanged);
        }
      });

      it.each([
        { sourceType: "area", destinationType: "territory" },
        { sourceType: "territory", destinationType: "area" },
      ] as const)(
        "requires both permissions for a Region move from $sourceType to $destinationType",
        async ({ sourceType, destinationType }) => {
          await mockAuthWithSession(await createAdminSession());
          const client = createTestClient();
          const sourceHierarchy = await createSectorAndTerritory(client);
          const destinationHierarchy = await createSectorAndTerritory(client);
          const source =
            sourceType === "area"
              ? await createOrg(client, "area", sourceHierarchy.territory.id)
              : sourceHierarchy.territory;
          const destination =
            destinationType === "area"
              ? await createOrg(
                  client,
                  "area",
                  destinationHierarchy.territory.id,
                )
              : destinationHierarchy.territory;
          const region = await createOrg(client, "region", source.id);
          await createOrg(client, "ao", region.id);
          const named = {
            sourceSector: sourceHierarchy.sector,
            sourceTerritory: sourceHierarchy.territory,
            sourceParent: source,
            destinationSector: destinationHierarchy.sector,
            destinationTerritory: destinationHierarchy.territory,
            destinationParent: destination,
            region,
          };
          const snapshot = async () => ({
            parentId: (await client.org.byId({ id: region.id })).org?.parentId,
            counts: await listedCounts(client, named),
          });
          const before = await snapshot();
          expect(before).toEqual({
            parentId: source.id,
            counts: {
              sourceSector: 1,
              sourceTerritory: 1,
              sourceParent: 1,
              destinationSector: 0,
              destinationTerritory: 0,
              destinationParent: 0,
              region: 1,
            },
          });
          const sourceSession = createEditorSession({
            orgId: source.id,
            orgName: source.name,
          });
          const destinationSession = createEditorSession({
            orgId: destination.id,
            orgName: destination.name,
          });
          for (const session of [sourceSession, destinationSession]) {
            await mockAuthWithSession(session);
            await expect(
              saveRegion(client, region, destination.id),
            ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
            expect(await snapshot()).toEqual(before);
          }

          sourceSession.roles = [
            ...(sourceSession.roles ?? []),
            ...(destinationSession.roles ?? []),
          ];
          if (sourceSession.user)
            sourceSession.user.roles = sourceSession.roles;
          await mockAuthWithSession(sourceSession);
          const moved = await saveRegion(client, region, destination.id);
          expect(moved.org?.parentId).toBe(destination.id);
          expect(await snapshot()).toEqual({
            parentId: destination.id,
            counts: {
              sourceSector: 0,
              sourceTerritory: 0,
              sourceParent: 0,
              destinationSector: 1,
              destinationTerritory: 1,
              destinationParent: 1,
              region: 1,
            },
          });
        },
      );
    });

    it("should accept creating an area parented directly to a sector (un-migrated case)", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const [sector] = await db
        .insert(schema.orgs)
        .values({
          name: `Area Parent Sector ${uniqueId()}`,
          orgType: "sector",
          parentId: f3Nation.id,
          isActive: true,
        })
        .returning();

      if (!sector) {
        throw new Error("Failed to create test sector");
      }

      createdOrgIds.push(sector.id);

      const client = createTestClient();

      const result = await client.org.crupdate({
        name: `Area Under Sector ${uniqueId()}`,
        orgType: "area",
        parentId: sector.id,
        isActive: true,
        email: null,
        phone: null,
        description: null,
        website: null,
        twitter: null,
        facebook: null,
        instagram: null,
      });

      expect(result.org).not.toBeNull();
      expect(result.org?.orgType).toBe("area");

      if (result.org) {
        createdOrgIds.push(result.org.id);
      }
    });

    it("should reject moving a region to be parented by another region (same-tier)", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const [sourceSector] = await db
        .insert(schema.orgs)
        .values({
          name: `Same Tier Sector ${uniqueId()}`,
          orgType: "sector",
          parentId: f3Nation.id,
          isActive: true,
        })
        .returning();

      if (!sourceSector) {
        throw new Error("Failed to create source sector");
      }

      createdOrgIds.push(sourceSector.id);

      const [targetRegion] = await db
        .insert(schema.orgs)
        .values({
          name: `Target Region ${uniqueId()}`,
          orgType: "region",
          parentId: sourceSector.id,
          isActive: true,
        })
        .returning();

      if (!targetRegion) {
        throw new Error("Failed to create target region");
      }

      createdOrgIds.push(targetRegion.id);

      const [region] = await db
        .insert(schema.orgs)
        .values({
          name: `Region To Move ${uniqueId()}`,
          orgType: "region",
          parentId: sourceSector.id,
          isActive: true,
        })
        .returning();

      if (!region) {
        throw new Error("Failed to create test region");
      }

      createdOrgIds.push(region.id);

      const client = createTestClient();

      await expect(
        client.org.crupdate({
          id: region.id,
          name: region.name,
          orgType: "region",
          parentId: targetRegion.id,
          isActive: true,
          email: null,
          phone: null,
          description: null,
          website: null,
          twitter: null,
          facebook: null,
          instagram: null,
        }),
      ).rejects.toThrow(/Region.*Region/);
    });

    it("should reject creating a nation parented to another org", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.org.crupdate({
          name: "Sub Nation Attempt",
          orgType: "nation",
          parentId: f3Nation.id,
          isActive: true,
          email: null,
          phone: null,
          description: null,
          website: null,
          twitter: null,
          facebook: null,
          instagram: null,
        }),
      ).rejects.toThrow("Nation cannot have a parent organization");
    });

    it("should reject creating an ao parented directly to a sector (skip-level)", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const [sector] = await db
        .insert(schema.orgs)
        .values({
          name: `Ao Skip Level Sector ${uniqueId()}`,
          orgType: "sector",
          parentId: f3Nation.id,
          isActive: true,
        })
        .returning();

      if (!sector) {
        throw new Error("Failed to create test sector");
      }

      createdOrgIds.push(sector.id);

      const client = createTestClient();

      await expect(
        client.org.crupdate({
          name: "Ao Under Sector",
          orgType: "ao",
          parentId: sector.id,
          isActive: true,
          email: null,
          phone: null,
          description: null,
          website: null,
          twitter: null,
          facebook: null,
          instagram: null,
        }),
      ).rejects.toThrow(/AO.*Sector/);
    });

    it("should return NOT_FOUND when creating an org under a nonexistent parent", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.org.crupdate({
          name: "Org Under Missing Parent",
          orgType: "region",
          parentId: 999999999,
          isActive: true,
          email: null,
          phone: null,
          description: null,
          website: null,
          twitter: null,
          facebook: null,
          instagram: null,
        }),
      ).rejects.toThrow("Parent org not found");
    });

    it("should return NOT_FOUND when moving an org to a nonexistent destination parent", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const [sourceSector] = await db
        .insert(schema.orgs)
        .values({
          name: `Missing Destination Sector ${uniqueId()}`,
          orgType: "sector",
          parentId: f3Nation.id,
          isActive: true,
        })
        .returning();

      if (!sourceSector) {
        throw new Error("Failed to create source sector");
      }

      createdOrgIds.push(sourceSector.id);

      const [region] = await db
        .insert(schema.orgs)
        .values({
          name: `Missing Destination Region ${uniqueId()}`,
          orgType: "region",
          parentId: sourceSector.id,
          isActive: true,
        })
        .returning();

      if (!region) {
        throw new Error("Failed to create test region");
      }

      createdOrgIds.push(region.id);

      const client = createTestClient();

      await expect(
        client.org.crupdate({
          id: region.id,
          name: region.name,
          orgType: "region",
          parentId: 999999999,
          isActive: true,
          email: null,
          phone: null,
          description: null,
          website: null,
          twitter: null,
          facebook: null,
          instagram: null,
        }),
      ).rejects.toThrow("Parent org not found");
    });

    it("should successfully move an org to a different, hierarchy-valid parent", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const [sourceSector] = await db
        .insert(schema.orgs)
        .values({
          name: `Move Success Source Sector ${uniqueId()}`,
          orgType: "sector",
          parentId: f3Nation.id,
          isActive: true,
        })
        .returning();

      const [destinationSector] = await db
        .insert(schema.orgs)
        .values({
          name: `Move Success Destination Sector ${uniqueId()}`,
          orgType: "sector",
          parentId: f3Nation.id,
          isActive: true,
        })
        .returning();

      if (!sourceSector || !destinationSector) {
        throw new Error("Failed to create test sectors");
      }

      createdOrgIds.push(sourceSector.id, destinationSector.id);

      const [region] = await db
        .insert(schema.orgs)
        .values({
          name: `Move Success Region ${uniqueId()}`,
          orgType: "region",
          parentId: sourceSector.id,
          isActive: true,
        })
        .returning();

      if (!region) {
        throw new Error("Failed to create test region");
      }

      createdOrgIds.push(region.id);

      const client = createTestClient();

      const result = await client.org.crupdate({
        id: region.id,
        name: region.name,
        orgType: "region",
        parentId: destinationSector.id,
        isActive: true,
        email: null,
        phone: null,
        description: null,
        website: null,
        twitter: null,
        facebook: null,
        instagram: null,
      });

      expect(result.org).not.toBeNull();
      expect(result.org?.parentId).toBe(destinationSector.id);
    });
  });

  describe("mine", () => {
    it("should return empty array when user has no orgs", async () => {
      const session = await createAdminSession();
      // Override with a user that has no roles assigned in the DB
      session.id = 999999;
      await mockAuthWithSession(session);

      const client = createTestClient();
      const result = await client.org.mine();

      expect(result).toHaveProperty("orgs");
      expect(Array.isArray(result.orgs)).toBe(true);
    });
  });

  describe("delete", () => {
    it("should soft delete an org (mark as inactive)", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Create an org to delete
      const [testOrg] = await db
        .insert(schema.orgs)
        .values({
          name: `Delete Test Region ${uniqueId()}`,
          orgType: "region",
          parentId: f3Nation.id,
          isActive: true,
        })
        .returning();

      if (!testOrg) {
        return;
      }
      createdOrgIds.push(testOrg.id);

      // Delete it
      const result = await client.org.delete({
        id: testOrg.id,
      });

      expect(result.orgId).toBe(testOrg.id);

      // Verify it's marked as inactive
      const [deletedOrg] = await db
        .select()
        .from(schema.orgs)
        .where(eq(schema.orgs.id, testOrg.id));

      expect(deletedOrg?.isActive).toBe(false);
    });

    it("should require admin permission to delete", async () => {
      const f3Nation = await getOrCreateF3NationOrg();

      // Create a session with no admin role
      const session = createEditorSession({
        orgId: 99999,
        orgName: "Other Org",
      });
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Try to delete F3 Nation (should fail)
      await expect(
        client.org.delete({
          id: f3Nation.id,
        }),
      ).rejects.toThrow();
    });

    it("should cascade soft delete series and future instances when deleting an AO", async () => {
      const f3Nation = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      // Create region → AO hierarchy
      const [region] = await db
        .insert(schema.orgs)
        .values({
          name: `CascadeRegion ${uniqueId()}`,
          orgType: "region",
          parentId: f3Nation.id,
          isActive: true,
        })
        .returning();
      if (!region) return;
      createdOrgIds.push(region.id);

      const [ao] = await db
        .insert(schema.orgs)
        .values({
          name: `CascadeAO ${uniqueId()}`,
          orgType: "ao",
          parentId: region.id,
          isActive: true,
        })
        .returning();
      if (!ao) return;
      createdOrgIds.push(ao.id);

      // Create a recurring series (event with recurrence pattern)
      const [series] = await db
        .insert(schema.events)
        .values({
          name: `CascadeSeries ${uniqueId()}`,
          orgId: ao.id,
          locationId: null,
          dayOfWeek: "monday",
          startTime: "0530",
          recurrencePattern: "weekly",
          recurrenceInterval: 1,
          startDate: "2026-01-01",
          isActive: true,
          highlight: false,
          isPrivate: false,
        })
        .returning();
      if (!series) return;

      // Create a past instance (should NOT be soft-deleted)
      const [pastInstance] = await db
        .insert(schema.eventInstances)
        .values({
          name: series.name,
          orgId: ao.id,
          seriesId: series.id,
          startDate: "2025-01-06",
          isActive: true,
          highlight: false,
          isPrivate: false,
        })
        .returning();

      // Create future instances (should be soft-deleted)
      const futureInstanceIds: number[] = [];
      for (const date of [
        nextFutureMonday(2),
        nextFutureMonday(3),
        nextFutureMonday(4),
      ]) {
        const [inst] = await db
          .insert(schema.eventInstances)
          .values({
            name: series.name,
            orgId: ao.id,
            seriesId: series.id,
            startDate: date,
            isActive: true,
            highlight: false,
            isPrivate: false,
          })
          .returning();
        if (inst) futureInstanceIds.push(inst.id);
      }

      expect(futureInstanceIds).toHaveLength(3);

      // Delete the AO via the router
      const client = createTestClient();
      const result = await client.org.delete({ id: ao.id });
      expect(result.orgId).toBe(ao.id);

      // Assert the AO itself is inactive
      const [deletedAo] = await db
        .select()
        .from(schema.orgs)
        .where(eq(schema.orgs.id, ao.id));
      expect(deletedAo?.isActive).toBe(false);

      // Assert the series is soft-deleted
      const [deletedSeries] = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, series.id));
      expect(deletedSeries?.isActive).toBe(false);

      // Assert future instances are soft-deleted
      const futureInstances = await db
        .select()
        .from(schema.eventInstances)
        .where(
          and(
            eq(schema.eventInstances.orgId, ao.id),
            gte(
              schema.eventInstances.startDate,
              new Date().toISOString().split("T")[0]!,
            ),
          ),
        );
      expect(futureInstances.length).toBeGreaterThanOrEqual(3);
      expect(futureInstances.every((i) => i.isActive === false)).toBe(true);

      // Assert past instance is NOT soft-deleted
      if (pastInstance) {
        const [past] = await db
          .select()
          .from(schema.eventInstances)
          .where(eq(schema.eventInstances.id, pastInstance.id));
        expect(past?.isActive).toBe(true);
      }

      // Cleanup: hard-delete test event instances, series, and orgs
      await db
        .delete(schema.eventInstances)
        .where(eq(schema.eventInstances.orgId, ao.id));
      await db.delete(schema.events).where(eq(schema.events.id, series.id));
    });
  });
});
