/**
 * Tests for First Event Service
 *
 * These tests require:
 * - TEST_DATABASE_URL environment variable to be set
 * - Test database to be seeded with test data
 */

import { vi } from "vitest";

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return {
      limit: vi.fn().mockResolvedValue({
        success: true,
        limit: 10,
        remaining: 9,
        reset: Date.now() + 60000,
      }),
    };
  }),
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

import { eq, schema, sql } from "@acme/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { logDebug, logWarn } from "../logger";
import { db, getOrCreateF3NationOrg, uniqueId } from "../__tests__/test-utils";
import {
  maybeNotifyFirstEventForRegion,
  maybeNotifyRegionInABox,
} from "./first-event-service";

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

  const createTestEvent = async (
    aoId: number,
    opts?: { isActive?: boolean; dayOfWeek?: "monday" | null },
  ) => {
    const [event] = await db
      .insert(schema.events)
      .values({
        name: `FES Event ${uniqueId()}`,
        orgId: aoId,
        locationId: null,
        dayOfWeek: opts?.dayOfWeek === undefined ? "monday" : opts.dayOfWeek,
        startDate: "2026-01-01",
        isActive: opts?.isActive ?? true,
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

  describe("maybeNotifyRegionInABox", () => {
    const mailMock = async () => {
      const { mail } = await import("@acme/mail");
      // eslint-disable-next-line @typescript-eslint/unbound-method
      return mail.sendTemplateMessages as ReturnType<typeof vi.fn>;
    };

    it("notifies eligible regions and preserves unrelated metadata", async () => {
      const region = await createTestRegion({ meta: { keep: "value" } });
      const ao = await createTestAO(region.id);
      await createTestEvent(ao.id);

      await maybeNotifyRegionInABox(db, region.id);

      const [updated] = await db
        .select({ meta: schema.orgs.meta })
        .from(schema.orgs)
        .where(eq(schema.orgs.id, region.id));
      expect(updated?.meta).toMatchObject({
        keep: "value",
        firstEventNotificationSent: true,
      });
      expect(await mailMock()).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["inactive", { isActive: false, dayOfWeek: "monday" as const }],
      ["non-recurring", { isActive: true, dayOfWeek: null }],
    ])(
      "leaves the flag unset when the only event is %s",
      async (_label, opts) => {
        const region = await createTestRegion();
        const ao = await createTestAO(region.id);
        await createTestEvent(ao.id, opts);

        await maybeNotifyRegionInABox(db, region.id);

        const [updated] = await db
          .select({ meta: schema.orgs.meta })
          .from(schema.orgs)
          .where(eq(schema.orgs.id, region.id));
        expect(
          (updated?.meta as Record<string, unknown> | null)
            ?.firstEventNotificationSent,
        ).not.toBe(true);
        expect(await mailMock()).not.toHaveBeenCalled();
      },
    );

    it("leaves the flag unset for an empty region", async () => {
      const region = await createTestRegion();
      await maybeNotifyRegionInABox(db, region.id);
      const [updated] = await db
        .select({ meta: schema.orgs.meta })
        .from(schema.orgs)
        .where(eq(schema.orgs.id, region.id));
      expect(
        (updated?.meta as Record<string, unknown> | null)
          ?.firstEventNotificationSent,
      ).not.toBe(true);
      expect(await mailMock()).not.toHaveBeenCalled();
    });

    it("can claim a region whose old metadata is JSON null", async () => {
      const region = await createTestRegion();
      const ao = await createTestAO(region.id);
      await createTestEvent(ao.id);
      await db
        .update(schema.orgs)
        .set({ meta: sql`'null'::jsonb` })
        .where(eq(schema.orgs.id, region.id));

      await maybeNotifyRegionInABox(db, region.id);

      const [updated] = await db
        .select({ meta: schema.orgs.meta })
        .from(schema.orgs)
        .where(eq(schema.orgs.id, region.id));
      expect(updated?.meta).toMatchObject({ firstEventNotificationSent: true });
      expect(await mailMock()).toHaveBeenCalledTimes(1);
    });

    it("sends independently for a distinct region", async () => {
      const first = await createTestRegion();
      const second = await createTestRegion();
      await createTestEvent(await createTestAO(first.id).then((ao) => ao.id));
      await createTestEvent(await createTestAO(second.id).then((ao) => ao.id));
      await maybeNotifyRegionInABox(db, first.id);
      await maybeNotifyRegionInABox(db, second.id);
      expect(await mailMock()).toHaveBeenCalledTimes(2);
    });

    it("releases a failed claim so a later trigger can retry", async () => {
      const region = await createTestRegion({ meta: { keep: 1 } });
      const ao = await createTestAO(region.id);
      await createTestEvent(ao.id);
      const mockedMail = await mailMock();
      mockedMail.mockRejectedValueOnce(new Error("send failed"));

      await expect(maybeNotifyRegionInABox(db, region.id)).rejects.toThrow(
        "send failed",
      );
      const [afterFailure] = await db
        .select({ meta: schema.orgs.meta })
        .from(schema.orgs)
        .where(eq(schema.orgs.id, region.id));
      expect(afterFailure?.meta).toMatchObject({ keep: 1 });
      expect(
        (afterFailure?.meta as Record<string, unknown> | null)
          ?.firstEventNotificationSent,
      ).not.toBe(true);

      await maybeNotifyRegionInABox(db, region.id);
      expect(mockedMail).toHaveBeenCalledTimes(2);
    });

    it("atomically allows only one concurrent sender for a region", async () => {
      const region = await createTestRegion();
      const ao = await createTestAO(region.id);
      await createTestEvent(ao.id);
      await Promise.all([
        maybeNotifyRegionInABox(db, region.id),
        maybeNotifyRegionInABox(db, region.id),
      ]);
      expect(await mailMock()).toHaveBeenCalledTimes(1);
    });
  });
});
