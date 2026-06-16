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

vi.mock("../logger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
}));

import { eq, schema } from "@acme/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { logDebug, logWarn } from "../logger";
import { db, getOrCreateF3NationOrg, uniqueId } from "../__tests__/test-utils";
import { maybeNotifyFirstEventForRegion } from "./first-event-service";

describe("First Event Service", () => {
  // Track created entities for cleanup
  const createdEventIds: number[] = [];
  const createdOrgIds: number[] = [];

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

  const createTestRegion = async (opts?: {
    meta?: Record<string, unknown>;
    email?: string | null;
  }) => {
    const nationOrg = await getOrCreateF3NationOrg();
    const [region] = await db
      .insert(schema.orgs)
      .values({
        name: `FES Region ${uniqueId()}`,
        orgType: "region",
        parentId: nationOrg.id,
        isActive: true,
        email:
          opts?.email !== undefined
            ? opts.email
            : `fes-region-${uniqueId()}@example.com`,
        meta: opts?.meta ?? null,
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

      expect(logDebug).toHaveBeenCalledWith(
        "api.first_event.email_sent",
        expect.objectContaining({ regionName: region.name }),
      );
    });

    it("sends notification even when multiple events exist, as long as flag is not set", async () => {
      const region = await createTestRegion();
      const ao = await createTestAO(region.id);
      // Two events under the same AO — count no longer gates the notification
      await createTestEvent(ao.id);
      await createTestEvent(ao.id);

      await maybeNotifyFirstEventForRegion(db, ao.id);

      // Flag SHOULD be set because the region has a contact email and no prior
      // notification has been sent.
      const [updatedRegion] = await db
        .select({ meta: schema.orgs.meta })
        .from(schema.orgs)
        .where(eq(schema.orgs.id, region.id));

      expect(
        (updatedRegion?.meta as Record<string, unknown> | null)
          ?.firstEventNotificationSent,
      ).toBe(true);
    });

    it("sends notification for the region regardless of which AO the event belongs to", async () => {
      const region = await createTestRegion();
      const ao1 = await createTestAO(region.id);
      const ao2 = await createTestAO(region.id);
      await createTestEvent(ao1.id);
      await createTestEvent(ao2.id);

      await maybeNotifyFirstEventForRegion(db, ao2.id);

      // Flag SHOULD be set — event count across AOs no longer blocks notification.
      const [updatedRegion] = await db
        .select({ meta: schema.orgs.meta })
        .from(schema.orgs)
        .where(eq(schema.orgs.id, region.id));

      expect(
        (updatedRegion?.meta as Record<string, unknown> | null)
          ?.firstEventNotificationSent,
      ).toBe(true);
    });

    it("skips when the flag is already set on the region (deduplication)", async () => {
      // Region already has the flag set from a prior notification
      const region = await createTestRegion({
        meta: { firstEventNotificationSent: true },
      });
      const ao = await createTestAO(region.id);
      await createTestEvent(ao.id);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const mailMock = (await import("@acme/mail")).mail
        .sendTemplateMessages as ReturnType<typeof vi.fn>;

      await maybeNotifyFirstEventForRegion(db, ao.id);

      // An "already notified" debug message should appear
      const skippedLogs = (
        logDebug as ReturnType<typeof vi.fn>
      ).mock.calls.filter(
        (args) => args[0] === "api.first_event.already_notified",
      );
      expect(skippedLogs.length).toBeGreaterThan(0);

      // Mail should not be called since we skip early
      expect(mailMock).not.toHaveBeenCalled();
    });

    it("defers notification (leaves flag unset) when region has no contact email and no admins", async () => {
      // Region with no contact email and no admin users assigned
      const region = await createTestRegion({ email: null });
      const ao = await createTestAO(region.id);
      await createTestEvent(ao.id);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      const mailMock = (await import("@acme/mail")).mail
        .sendTemplateMessages as ReturnType<typeof vi.fn>;

      await maybeNotifyFirstEventForRegion(db, ao.id);

      // Flag must remain unset so a future event creation can retry.
      const [updatedRegion] = await db
        .select({ meta: schema.orgs.meta })
        .from(schema.orgs)
        .where(eq(schema.orgs.id, region.id));

      expect(
        (updatedRegion?.meta as Record<string, unknown> | null)
          ?.firstEventNotificationSent,
      ).not.toBe(true);

      expect(mailMock).not.toHaveBeenCalled();

      // A deferral warning should have been logged.
      expect(logWarn).toHaveBeenCalledWith(
        "api.first_event.no_recipients",
        expect.objectContaining({ regionName: region.name }),
      );
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
