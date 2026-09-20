/**
 * Tests for createAO / updateAO parent-type validation
 *
 * These tests require:
 * - TEST_DATABASE_URL environment variable to be set
 * - Test database to be seeded with test data
 */

import { eq, schema } from "@acme/db";
import { db } from "@acme/db/client";
import { TEST_SECTOR_ORG_ID } from "@acme/shared/app/constants";
import { afterAll, describe, expect, it } from "vitest";

import type { Context } from "../shared";
import { cleanup, uniqueId } from "../testing";
import { createAO, updateAO } from "./ao-handlers";

const ctx: Context = { session: null, db };

describe("createAO / updateAO parent-type validation", () => {
  const createdOrgIds: number[] = [];

  afterAll(async () => {
    for (const orgId of createdOrgIds.reverse()) {
      try {
        await cleanup.org(orgId);
      } catch {
        // Ignore errors during cleanup
      }
    }
  });

  it("createAO rejects a regionId that isn't actually a region", async () => {
    await expect(
      createAO(ctx, {
        regionId: TEST_SECTOR_ORG_ID,
        aoName: `Bad Region AO ${uniqueId()}`,
      }),
    ).rejects.toThrow(/AO.*Sector/);
  });

  it("createAO succeeds with a valid region parent", async () => {
    const [region] = await db
      .insert(schema.orgs)
      .values({
        name: `Ao Handler Region ${uniqueId()}`,
        orgType: "region",
        parentId: TEST_SECTOR_ORG_ID,
        isActive: true,
      })
      .returning();
    if (!region) throw new Error("Failed to create test region");
    createdOrgIds.push(region.id);

    const aoId = await createAO(ctx, {
      regionId: region.id,
      aoName: `Good Region AO ${uniqueId()}`,
    });
    createdOrgIds.push(aoId);

    const [ao] = await db
      .select()
      .from(schema.orgs)
      .where(eq(schema.orgs.id, aoId));
    expect(ao?.parentId).toBe(region.id);
  });

  it("updateAO rejects moving to a parent that isn't a region", async () => {
    const [region] = await db
      .insert(schema.orgs)
      .values({
        name: `Ao Handler Update Region ${uniqueId()}`,
        orgType: "region",
        parentId: TEST_SECTOR_ORG_ID,
        isActive: true,
      })
      .returning();
    if (!region) throw new Error("Failed to create test region");
    createdOrgIds.push(region.id);

    const aoId = await createAO(ctx, {
      regionId: region.id,
      aoName: `Move Reject AO ${uniqueId()}`,
    });
    createdOrgIds.push(aoId);

    await expect(
      updateAO(ctx, { id: aoId, parentId: TEST_SECTOR_ORG_ID }),
    ).rejects.toThrow(/AO.*Sector/);
  });
});
