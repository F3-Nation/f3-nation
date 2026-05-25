/**
 * Tests for First Event Service
 *
 * These tests require:
 * - TEST_DATABASE_URL environment variable to be set
 * - Test database to be seeded with test data
 */

import { vi } from "vitest";

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn().mockImplementation(() => ({
    limit: vi.fn().mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60000,
    }),
  })),
}));

vi.mock("@acme/mail", async (importOriginal) => {
  // eslint-disable-next-line
  const actual = await importOriginal<typeof import("@acme/mail")>();
  return {
    ...actual,
    mail: {
      sendTemplateMessages: vi.fn().mockResolvedValue(undefined),
    },
  };
});

import { execSync } from "child_process";
import path from "path";

import { eq, schema } from "@acme/db";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi as vitest,
} from "vitest";
import { db, getOrCreateF3NationOrg, uniqueId } from "../__tests__/test-utils";
import { maybeNotifyFirstEventForRegion } from "./first-event-service";

describe("First Event Service", () => {
  // Track created entities for cleanup
  const createdEventIds: number[] = [];
  const createdOrgIds: number[] = [];

  beforeAll(() => {
    // Reset the test DB before any tests run to ensure a clean state and
    // prevent order-dependent flakiness from prior runs.
    const repoRoot = path.resolve(__dirname, "../../../..");
    execSync("pnpm -C packages/db reset-test-db", {
      cwd: repoRoot,
      stdio: "inherit",
    });
  }, 60000);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    // Delete events
    for (const eventId of createdEventIds.reverse()) {
      try {
        await db.delete(schema.events).where(eq(schema.events.id, eventId));
      } catch {
        // ignore
      }
    }
    // Delete orgs (children before parents)
    for (const orgId of createdOrgIds.reverse()) {
      try {
        await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
      } catch {
        // ignore
      }
    }
  }, 30000);

  // --- Helpers ---

  const createTestRegion = async (metaOverrides?: Record<string, unknown>) => {
    const nationOrg = await getOrCreateF3NationOrg();
    const [region] = await db
      .insert(schema.orgs)
      .values({
        name: `FES Region ${uniqueId()}`,
        orgType: "region",
        parentId: nationOrg.id,
        isActive: true,
        email: `fes-region-${uniqueId()}@example.com`,
        meta: metaOverrides ?? null,
      })
      .returning();
    if (region) createdOrgIds.push(region.id);
    return region!;
  };

  const createTestAO = async (regionId: number) => {
    const [ao] = await db
      .insert(schema.orgs)
      .values({
        name: `FES AO ${uniqueId()}`,
        orgType: "ao",
        parentId: regionId,
        isActive: true,
      })
      .returning();
    if (ao) createdOrgIds.push(ao.id);
    return ao!;
  };

  const createTestEvent = async (aoId: number) => {
    const [event] = await db
      .insert(schema.events)
      .values({
        name: `FES Event ${uniqueId()}`,
        orgId: aoId,
        locationId: null,
        dayOfWeek: "monday",
        startDate: "2026-01-01",
        isActive: true,
        highlight: false,
        isPrivate: false,
        recurrencePattern: "weekly",
        recurrenceInterval: 1,
        indexWithinInterval: 1,
      })
      .returning();
    if (event) createdEventIds.push(event.id);
    return event!;
  };

  // --- Tests ---

  describe("maybeNotifyFirstEventForRegion", () => {
    it("sets flag and logs when first event is created for a region", async () => {
      const debugSpy = vitest
        .spyOn(console, "debug")
        .mockImplementation(() => undefined);

      const region = await createTestRegion();
      const ao = await createTestAO(region.id);
      await createTestEvent(ao.id);

      await maybeNotifyFirstEventForRegion(db, ao.id);

      const [updatedRegion] = await db
        .select({ meta: schema.orgs.meta })
        .from(schema.orgs)
        .where(eq(schema.orgs.id, region.id));

      expect(
        (updatedRegion?.meta as Record<string, unknown> | null)
          ?.firstEventNotificationSent,
      ).toBe(true);

      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining(region.name),
      );

      debugSpy.mockRestore();
    });

    it("does nothing when a second event exists for the region", async () => {
      const debugSpy = vitest
        .spyOn(console, "debug")
        .mockImplementation(() => undefined);

      const region = await createTestRegion();
      const ao = await createTestAO(region.id);
      // Two events under the same AO
      await createTestEvent(ao.id);
      await createTestEvent(ao.id);

      await maybeNotifyFirstEventForRegion(db, ao.id);

      // Flag should NOT be set because there are already 2 events
      const [updatedRegion] = await db
        .select({ meta: schema.orgs.meta })
        .from(schema.orgs)
        .where(eq(schema.orgs.id, region.id));

      expect(
        (updatedRegion?.meta as Record<string, unknown> | null)
          ?.firstEventNotificationSent,
      ).not.toBe(true);

      // No region-name debug log should have been emitted
      const regionLogCalls = debugSpy.mock.calls.filter((args) =>
        String(args[0]).includes(region.name),
      );
      expect(regionLogCalls).toHaveLength(0);

      debugSpy.mockRestore();
    });

    it("does nothing when events exist across two different AOs in the region", async () => {
      const region = await createTestRegion();
      const ao1 = await createTestAO(region.id);
      const ao2 = await createTestAO(region.id);
      await createTestEvent(ao1.id);
      await createTestEvent(ao2.id);

      await maybeNotifyFirstEventForRegion(db, ao2.id);

      const [updatedRegion] = await db
        .select({ meta: schema.orgs.meta })
        .from(schema.orgs)
        .where(eq(schema.orgs.id, region.id));

      expect(
        (updatedRegion?.meta as Record<string, unknown> | null)
          ?.firstEventNotificationSent,
      ).not.toBe(true);
    });

    it("skips when the flag is already set on the region (deduplication)", async () => {
      const debugSpy = vitest
        .spyOn(console, "debug")
        .mockImplementation(() => undefined);

      // Region already has the flag set from a prior notification
      const region = await createTestRegion({
        firstEventNotificationSent: true,
      });
      const ao = await createTestAO(region.id);
      await createTestEvent(ao.id);

      await maybeNotifyFirstEventForRegion(db, ao.id);

      // Flag should still be true (untouched) but no "first event" log
      const regionNameLogs = debugSpy.mock.calls.filter((args) =>
        String(args[0]).includes("First recurring"),
      );
      expect(regionNameLogs).toHaveLength(0);

      // A "already notified" debug message should appear instead
      const skippedLogs = debugSpy.mock.calls.filter((args) =>
        String(args[0]).includes("already notified"),
      );
      expect(skippedLogs.length).toBeGreaterThan(0);

      debugSpy.mockRestore();
    });

    it("counts soft-deleted events to prevent re-notification after delete+recreate", async () => {
      const region = await createTestRegion();
      const ao = await createTestAO(region.id);

      // Create and then soft-delete the first event
      const firstEvent = await createTestEvent(ao.id);
      await db
        .update(schema.events)
        .set({ isActive: false })
        .where(eq(schema.events.id, firstEvent.id));

      // Create a second event — total count is now 2 (one inactive, one active)
      await createTestEvent(ao.id);

      await maybeNotifyFirstEventForRegion(db, ao.id);

      // Because count=2, flag should NOT be set
      const [updatedRegion] = await db
        .select({ meta: schema.orgs.meta })
        .from(schema.orgs)
        .where(eq(schema.orgs.id, region.id));

      expect(
        (updatedRegion?.meta as Record<string, unknown> | null)
          ?.firstEventNotificationSent,
      ).not.toBe(true);
    });

    it("handles an AO with no parent gracefully without throwing", async () => {
      // Create an AO with no parentId
      const [orphanAo] = await db
        .insert(schema.orgs)
        .values({
          name: `FES Orphan AO ${uniqueId()}`,
          orgType: "ao",
          parentId: null,
          isActive: true,
        })
        .returning();
      createdOrgIds.push(orphanAo!.id);

      await expect(
        maybeNotifyFirstEventForRegion(db, orphanAo!.id),
      ).resolves.toBeUndefined();
    });

    it("handles a parent that is not a region type without throwing", async () => {
      // AO whose direct parent is a nation (not a region)
      const nationOrg = await getOrCreateF3NationOrg();
      const [ao] = await db
        .insert(schema.orgs)
        .values({
          name: `FES Nation-child AO ${uniqueId()}`,
          orgType: "ao",
          parentId: nationOrg.id,
          isActive: true,
        })
        .returning();
      createdOrgIds.push(ao!.id);
      await createTestEvent(ao!.id);

      await expect(
        maybeNotifyFirstEventForRegion(db, ao!.id),
      ).resolves.toBeUndefined();
    });

    it("handles a non-existent AO ID gracefully without throwing", async () => {
      await expect(
        maybeNotifyFirstEventForRegion(db, 999_999_999),
      ).resolves.toBeUndefined();
    });
  });
});
