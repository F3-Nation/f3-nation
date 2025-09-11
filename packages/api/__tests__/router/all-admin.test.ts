import { initTRPC } from "@trpc/server";
import dayjs from "dayjs";
import { describe, expect, it } from "vitest";

import type { DayOfWeek, OrgType } from "@acme/shared/app/enums";
import { db } from "@acme/db/client";
import {
  TEST_ADMIN_USER_ID,
  TEST_EDITOR_USER_ID,
  TEST_NATION_ORG_ID,
  TEST_REGION_2_ORG_ID,
  TEST_SECTOR_ORG_ID,
} from "@acme/shared/app/constants";
import { onlyUnique } from "@acme/shared/common/functions";

import { appRouter } from "../../src/index";

interface User {
  id: number;
  email: string;
  roles: { orgId: number; orgName: string; roleName: string }[];
}

const adminUser: User = {
  id: TEST_ADMIN_USER_ID,
  email: "admin@test.com",
  roles: [
    { orgId: TEST_NATION_ORG_ID, orgName: "Test Nation", roleName: "admin" },
  ],
};

describe("all admin routers", () => {
  const createTRPCContext = (user: User) => {
    return {
      db,
      session: {
        user,
        roles: user.roles,
        expires: dayjs().add(1, "day").toISOString(),
      },
    };
  };
  const t = initTRPC.context<typeof createTRPCContext>().create();
  // @ts-expect-error, we skip typechecking due to testing context only
  const createCaller = t.createCallerFactory(appRouter);
  const caller = createCaller(createTRPCContext(adminUser));

  // Auth Router Tests
  describe("auth router", () => {
    it("should get session", async () => {
      const result = await caller.auth.getSession();
      expect(result).toBeDefined();
    });

    it("should get secret message", async () => {
      const result = await caller.auth.getSecretMessage();
      expect(result).toBe("you can see this secret message!");
    });
  });

  // AO Router Tests
  describe("ao router", () => {
    it("should get all aos", async () => {
      const result = await caller.org.all({
        orgTypes: ["ao"],
      });
      expect(result).toBeDefined();
    });

    let createdAoId: number | undefined;
    it("should create and get ao by id", async () => {
      const aoData = {
        name: "Test AO",
        orgType: "ao" as OrgType,
        isActive: true,
        parentId: TEST_REGION_2_ORG_ID,
        email: "test@ao.com",
        description: "Test AO Description",
        logoUrl: "https://example.com/logo.png",
        website: "https://example.com",
        twitter: "@testao",
        facebook: "testao",
        instagram: "@testao",
        lastAnnualReview: dayjs().toISOString(),
        meta: { key: "value" },
      };
      const aoResult = await caller.org.crupdate(aoData);
      expect(aoResult).toBeDefined();
      if (!aoResult) {
        throw new Error("AO result is undefined");
      }
      createdAoId = aoResult.id;
      const result = await caller.org.byId({ id: aoResult.id, orgType: "ao" });
      expect(result).toBeDefined();
    });

    it("should delete ao", async () => {
      if (!createdAoId) {
        throw new Error("Created AO ID is undefined");
      }
      await caller.org.delete({ id: createdAoId, orgType: "ao" });
      const result = await caller.org.byId({ id: createdAoId, orgType: "ao" });
      expect(result?.isActive).toBe(false);
    });
  });

  // Area Router Tests
  describe("area router", () => {
    it("should get all areas", async () => {
      const result = await caller.org.all({ orgTypes: ["area"] });
      expect(result).toBeDefined();
      const resultTypes = result.orgs
        .map((org) => org.orgType)
        .filter(onlyUnique);
      expect(resultTypes).toContain("area");
      expect(resultTypes.length).toBe(1);
    });

    let createdAreaId: number | undefined;
    it("should create and get area by id", async () => {
      const areaData = {
        name: "Test Area",
        orgType: "area" as OrgType,
        isActive: true,
        parentId: TEST_NATION_ORG_ID,
        email: "test@area.com",
        description: "Test Area Description",
        logoUrl: "https://example.com/logo.png",
        website: "https://example.com",
        twitter: "@testarea",
        facebook: "testarea",
        instagram: "@testarea",
        lastAnnualReview: dayjs().toISOString(),
        meta: { key: "value" },
      };
      const areaResult = await caller.org.crupdate(areaData);
      expect(areaResult).toBeDefined();
      if (!areaResult) {
        throw new Error("Area result is undefined");
      }
      console.log("areaResult", areaResult);
      createdAreaId = areaResult.id;
      const result = await caller.org.byId({
        id: areaResult.id,
        orgType: "area",
      });
      expect(result).toBeDefined();
    });

    it("should delete area", async () => {
      if (!createdAreaId) {
        throw new Error("Created area ID is undefined");
      }
      await caller.org.delete({ id: createdAreaId, orgType: "area" });
      const result = await caller.org.byId({
        id: createdAreaId,
        orgType: "area",
      });
      expect(result?.isActive).toBe(false);
    });
  });

  // Event Router Tests
  describe("event router", () => {
    it("should get all events", async () => {
      const result = await caller.event.all();
      expect(result).toBeDefined();
    });

    let eventId: number | undefined;

    it("should create and get event by id", async () => {
      const aoData = {
        name: "Test AO",
        orgType: "ao" as OrgType,
        isActive: true,
        parentId: TEST_REGION_2_ORG_ID,
        email: "test@ao.com",
        description: "Test AO Description",
        logoUrl: "https://example.com/logo.png",
        website: "https://example.com",
        twitter: "@testao",
        facebook: "testao",
        instagram: "@testao",
        lastAnnualReview: dayjs().toISOString(),
        meta: { key: "value" },
      };
      const aoResult = await caller.org.crupdate(aoData);
      expect(aoResult).toBeDefined();

      if (!aoResult) {
        throw new Error("AO result is undefined");
      }

      const locationData = {
        name: "Test Location",
        isActive: true,
        orgId: aoResult.id,
        aoName: "Test AO",
        email: "test@location.com",
        description: "Test Location Description",
      };
      const locationResult = await caller.location.crupdate(locationData);
      expect(locationResult).toBeDefined();
      if (!locationResult) {
        throw new Error("Location result is undefined");
      }

      const eventData = {
        name: "Test Event",
        isActive: true,
        aoId: aoResult.id,
        locationId: locationResult?.id,
        regionId: TEST_REGION_2_ORG_ID,
        highlight: false,
        startDate: dayjs().format("YYYY-MM-DD"),
        startTime: "0600",
        endTime: "0700",
        email: "test@event.com",
        description: "Test Event Description",
        dayOfWeek: "monday" as DayOfWeek,
        qSource: "QSource",
        q: "Q",
        coq: "COQ",
        fng: "FNG",
        backblast: "Backblast",
        backblastTs: dayjs().unix(),
        meta: { key: "value" },
        eventTypeIds: [1],
      };
      const eventResult = await caller.event.crupdate(eventData);
      expect(eventResult).toBeDefined();
      if (!eventResult) {
        throw new Error("Event result is undefined");
      }
      eventId = eventResult.id;
    });

    it("should add event types", async () => {
      const result = await caller.eventType.crupdate({
        name: "Test Event Type",
        specificOrgId: TEST_REGION_2_ORG_ID,
        eventCategory: "first_f",
      });
      expect(result).toBeDefined();
    });

    it("should get event types", async () => {
      const result = await caller.eventType.all({
        pageSize: 200,
        orgIds: [TEST_REGION_2_ORG_ID],
      });
      expect(result).toBeDefined();
      expect(result.eventTypes.length).toBeGreaterThan(0);
    });

    it("should delete event", async () => {
      if (!eventId) {
        throw new Error("Event ID is undefined");
      }
      await caller.event.delete({ id: eventId });
      const result = await caller.event.byId({ id: eventId });
      expect(result?.isActive).toBe(false);
    });
  });

  // Location Router Tests
  describe("location router", () => {
    it("should get all locations", async () => {
      const result = await caller.location.all();
      expect(result).toBeDefined();
    });

    it("should get map event and location data", async () => {
      const result = await caller.location.getMapEventAndLocationData();
      expect(result).toBeDefined();
    });

    it("should get regions with location", async () => {
      const result = await caller.location.getRegionsWithLocation();
      expect(result).toBeDefined();
    });

    it("should get workout count", async () => {
      const result = await caller.location.getWorkoutCount();
      expect(result).toBeDefined();
    });

    it("should create and get location by id", async () => {
      const locationData = {
        name: "Test Location",
        isActive: true,
        orgId: TEST_REGION_2_ORG_ID,
        aoName: "Test AO",
        email: "test@location.com",
        description: "Test Location Description",
        latitude: 40.7128,
        longitude: -74.006,
        addressStreet: "123 Test St",
        addressStreet2: "Apt 4B",
        addressCity: "Test City",
        addressState: "TS",
        addressZip: "12345",
        addressCountry: "Test Country",
        meta: { key: "value" },
      };
      const locationResult = await caller.location.crupdate(locationData);
      expect(locationResult).toBeDefined();
      if (!locationResult) {
        throw new Error("Location result is undefined");
      }
      const result = await caller.location.byId({ id: locationResult.id });
      expect(result).toBeDefined();
    });
  });

  // Nation Router Tests
  describe("nation router", () => {
    it("should get all nations", async () => {
      const result = await caller.org.all({ orgTypes: ["nation"] });
      expect(result).toBeDefined();
    });

    const randomNumber = Math.floor(Math.random() * 1000000);
    const name = `Test Nation ${randomNumber}`;
    it("should update and get nation by id", async () => {
      const nationData = {
        id: TEST_NATION_ORG_ID,
        name,
        orgType: "nation" as OrgType,
        isActive: true,
        email: "test@nation.com",
        description: "Test Nation Description",
        logoUrl: "https://example.com/logo.png",
        website: "https://example.com",
        twitter: "@testnation",
        facebook: "testnation",
        instagram: "@testnation",
        lastAnnualReview: dayjs().toISOString(),
        meta: { key: "value" },
      };
      const result = await caller.org.crupdate(nationData);
      expect(result).toBeDefined();
      if (!result) {
        throw new Error("Nation result is undefined");
      }
      const result2 = await caller.org.byId({
        id: result.id,
        orgType: "nation",
      });
      expect(result2).toBeDefined();
      expect(result2?.name).toBe(name);
      console.log("nation", result2);
      const nations = await caller.org.all({ orgTypes: ["nation"] });
      console.log("nations", nations);
    });

    it("should get all orgs", async () => {
      const result = await caller.org.all({
        pageSize: 999999,
        orgTypes: ["region", "area", "sector", "nation"], // not ao
      });
      expect(result).toBeDefined();
      expect(result.orgs.length).toBeGreaterThan(0);
      expect(result.orgs.some((org) => org.orgType === "ao")).toBe(false);
      expect(result.orgs.some((org) => org.orgType === "region")).toBe(true);
      expect(result.orgs.some((org) => org.orgType === "area")).toBe(true);
      expect(result.orgs.some((org) => org.orgType === "sector")).toBe(true);
      expect(result.orgs.some((org) => org.orgType === "nation")).toBe(true);
    });

    it("should delete nation", async () => {
      await caller.org.delete({ id: TEST_NATION_ORG_ID, orgType: "nation" });
      const result = await caller.org.byId({
        id: TEST_NATION_ORG_ID,
        orgType: "nation",
      });
      expect(result?.isActive).toBe(false);
    });
  });

  // Ping Router Tests
  describe("ping router", () => {
    it("should ping", async () => {
      const result = await caller.ping();
      expect(result).toBeDefined();
    });
  });

  // Region Router Tests
  describe("region router", () => {
    it("should get all regions", async () => {
      const result = await caller.org.all({ orgTypes: ["region"] });
      expect(result).toBeDefined();
    });

    let createdRegionId: number | undefined;
    it("should create and get region by id", async () => {
      const regionData = {
        name: "Test Region",
        orgType: "region" as OrgType,
        isActive: true,
        parentId: TEST_SECTOR_ORG_ID,
        email: "test@region.com",
        description: "Test Region Description",
        logoUrl: "https://example.com/logo.png",
        website: "https://example.com",
        twitter: "@testregion",
        facebook: "testregion",
        instagram: "@testregion",
        lastAnnualReview: dayjs().toISOString(),
        meta: { key: "value" },
      };
      const regionResult = await caller.org.crupdate(regionData);
      expect(regionResult).toBeDefined();
      if (!regionResult) {
        throw new Error("Region result is undefined");
      }
      createdRegionId = regionResult.id;
      const result = await caller.org.byId({
        id: regionResult.id,
        orgType: "region",
      });
      expect(result).toBeDefined();
    });

    it("should delete region", async () => {
      if (!createdRegionId) {
        throw new Error("Created region ID is undefined");
      }
      await caller.org.delete({ id: createdRegionId, orgType: "region" });
      const result = await caller.org.byId({
        id: createdRegionId,
        orgType: "region",
      });
      expect(result?.isActive).toBe(false);
    });
  });

  // Request Router Tests
  describe("request router", () => {
    it("should get all requests", async () => {
      const result = await caller.request.all();
      expect(result).toBeDefined();
    });

    it("should check can edit region", async () => {
      const result = await caller.request.canEditRegions({
        orgIds: [TEST_NATION_ORG_ID],
      });
      expect(result).toBeDefined();
    });
  });

  // Sector Router Tests
  describe("sector router", () => {
    let createdSectorId: number | undefined;

    it("should create and get sector by id", async () => {
      const sectorData = {
        name: "Test Sector",
        orgType: "sector" as OrgType,
        isActive: true,
        email: "test@sector.com",
        description: "Test Sector Description",
        logoUrl: "https://example.com/logo.png",
        website: "https://example.com",
        twitter: "@testsector",
        facebook: "testsector",
        instagram: "@testsector",
        parentId: TEST_NATION_ORG_ID,
      };
      const sectorResult = await caller.org.crupdate(sectorData);
      expect(sectorResult).toBeDefined();
      if (!sectorResult) {
        throw new Error("Sector result is undefined");
      }
      createdSectorId = sectorResult.id;
      const result = await caller.org.byId({
        id: sectorResult.id,
        orgType: "sector",
      });
      expect(result).toBeDefined();
    });

    it("should update and get sector by id", async () => {
      const sectorData = {
        id: TEST_SECTOR_ORG_ID,
        name: "Test Sector",
        orgType: "sector" as OrgType,
        isActive: true,
        email: "test@sector.com",
        description: "Test Sector Description",
        logoUrl: "https://example.com/logo.png",
        website: "https://example.com",
        twitter: "@testsector",
        facebook: "testsector",
        instagram: "@testsector",
        lastAnnualReview: dayjs().toISOString(),
        meta: { key: "value" },
        parentId: TEST_NATION_ORG_ID,
      };
      const sectorResult = await caller.org.crupdate(sectorData);
      expect(sectorResult).toBeDefined();
      if (!sectorResult) {
        throw new Error("Sector result is undefined");
      }
      createdSectorId = sectorResult.id;
      const result = await caller.org.byId({
        id: sectorResult.id,
        orgType: "sector",
      });
      expect(result).toBeDefined();
    });

    it("should delete sector", async () => {
      if (!createdSectorId) {
        throw new Error("Created sector ID is undefined");
      }
      await caller.org.delete({ id: createdSectorId, orgType: "sector" });
      const result = await caller.org.byId({
        id: createdSectorId,
        orgType: "sector",
      });
      console.log("result", result);
      expect(result?.isActive).toBe(false);
    });

    it("should get all sectors (active and inactive)", async () => {
      const result = await caller.org.all({
        orgTypes: ["sector"],
        statuses: ["active", "inactive"],
      });
      expect(result).toBeDefined();
      // Verify deleted sector is not included
      expect(
        result.orgs.find((sector) => sector.id === createdSectorId)?.isActive,
      ).toBe(false);
    });

    it("should get all sectors (active only)", async () => {
      const result = await caller.org.all({
        orgTypes: ["sector"],
      });
      expect(result).toBeDefined();
      // Verify deleted sector is not included
      expect(result.orgs.find((sector) => sector.id === createdSectorId)).toBe(
        undefined,
      );
    });
  });

  // User Router Tests
  describe("user router", () => {
    it("should get all users", async () => {
      const result = await caller.user.all();
      expect(result).toBeDefined();
    });

    it("should get user by id", async () => {
      const result = await caller.user.byId({ id: TEST_ADMIN_USER_ID });
      expect(result).toBeDefined();

      const result2 = await caller.user.byId({ id: TEST_EDITOR_USER_ID });
      expect(result2).toBeDefined();
    });
  });
});
