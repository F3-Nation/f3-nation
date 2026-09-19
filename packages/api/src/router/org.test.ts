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

import { and, eq, gte, schema } from "@acme/db";
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

    it("counts AOs beneath an Area under a Territory in the Area, Territory, and Sector, and follows the Area between parents", async () => {
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
