/**
 * Tests for assertValidParentType
 *
 * These tests require:
 * - TEST_DATABASE_URL environment variable to be set
 * - Test database to be seeded with test data
 */

import {
  TEST_AO_1_ORG_ID,
  TEST_NATION_ORG_ID,
  TEST_REGION_1_ORG_ID,
  TEST_SECTOR_ORG_ID,
} from "@acme/shared/app/constants";
import { OrgType } from "@acme/shared/app/enums";
import {
  isValidOrgTypeParent,
  orgTypeRank,
} from "@acme/shared/app/org-hierarchy";
import { describe, expect, it } from "vitest";

import { assertValidParentType } from "./assert-valid-parent-type";
import { db } from "./__tests__/test-utils";

const NONEXISTENT_ORG_ID = 999999999;

describe("isValidOrgTypeParent (ordinal property)", () => {
  it("matches a strict rank comparison for every possible (parent, child) pair", () => {
    for (const parent of OrgType) {
      for (const child of OrgType) {
        expect(isValidOrgTypeParent(parent, child)).toBe(
          orgTypeRank(parent) > orgTypeRank(child),
        );
      }
    }
  });

  it("accepts the un-migrated case: an area parented directly to a sector", () => {
    expect(isValidOrgTypeParent("sector", "area")).toBe(true);
  });

  it("accepts a skip-level parent, standing in for a future territory tier", () => {
    // area's only ordinal ancestors today are sector and nation. Accepting
    // nation despite skipping past sector proves the check is rank-based, not
    // adjacency-based -- which is exactly what lets a future "territory" tier
    // slot into OrgType without any change to this validation logic.
    expect(isValidOrgTypeParent("nation", "area")).toBe(true);
  });

  it("rejects a region parented to an ao", () => {
    expect(isValidOrgTypeParent("ao", "region")).toBe(false);
  });

  it("rejects same-type parenting", () => {
    for (const type of OrgType) {
      expect(isValidOrgTypeParent(type, type)).toBe(false);
    }
  });
});

describe("assertValidParentType", () => {
  it("rejects assigning a parent to nation, without even looking up the parent", async () => {
    await expect(
      assertValidParentType(db, NONEXISTENT_ORG_ID, "nation"),
    ).rejects.toThrow("Nation cannot have a parent organization");
  });

  it("throws NOT_FOUND when the parent org does not exist", async () => {
    await expect(
      assertValidParentType(db, NONEXISTENT_ORG_ID, "region"),
    ).rejects.toThrow("Parent org not found");
  });

  it("throws BAD_REQUEST naming both types when the parent's rank is too low", async () => {
    await expect(
      assertValidParentType(db, TEST_AO_1_ORG_ID, "region"),
    ).rejects.toThrow(/Region.*AO/);
  });

  it("resolves for the un-migrated case: an area parented to a sector", async () => {
    await expect(
      assertValidParentType(db, TEST_SECTOR_ORG_ID, "area"),
    ).resolves.toBeUndefined();
  });

  it("resolves for a skip-level parent above the immediate rank", async () => {
    await expect(
      assertValidParentType(db, TEST_NATION_ORG_ID, "area"),
    ).resolves.toBeUndefined();
  });

  it("rejects a skip-level parent for an ao, unlike other org types", async () => {
    // moveAOLocsToNewRegion and the map's region joins both assume an ao's
    // parent is specifically a region, so ao is the one type that must NOT
    // accept a higher-ranked skip-level parent.
    await expect(
      assertValidParentType(db, TEST_SECTOR_ORG_ID, "ao"),
    ).rejects.toThrow(/AO.*Sector/);
  });

  it("resolves for an ao parented to an adjacent region", async () => {
    await expect(
      assertValidParentType(db, TEST_REGION_1_ORG_ID, "ao"),
    ).resolves.toBeUndefined();
  });
});
