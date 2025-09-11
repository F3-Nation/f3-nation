import { initTRPC } from "@trpc/server";
import dayjs from "dayjs";
import { describe, expect, it, vi } from "vitest";

import type { DayOfWeek, OrgType } from "@acme/shared/app/enums";
import { schema } from "@acme/db";
import { db } from "@acme/db/client";
import {
  TEST_ADMIN_USER_ID,
  TEST_AREA_ORG_ID,
  TEST_EDITOR_USER_ID,
  TEST_NATION_ORG_ID,
  TEST_REGION_1_ORG_ID,
  TEST_REGION_2_ORG_ID,
  TEST_REGION_3_ORG_ID,
  TEST_SECTOR_ORG_ID,
} from "@acme/shared/app/constants";

import { appRouter } from "../../src/index";

// Mock the revalidatePath function
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

interface User {
  id: number;
  email: string;
  roles: { orgId: number; orgName: string; roleName: string }[];
}

const MY_REGION_ID = TEST_REGION_2_ORG_ID;

const editorUser = {
  id: TEST_EDITOR_USER_ID,
  email: "editor@test.com",
  roles: [
    {
      orgId: MY_REGION_ID,
      orgName: "Test Region 2",
      roleName: "editor",
    },
  ],
};

describe("all editor routers", () => {
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
  const caller = createCaller(createTRPCContext(editorUser));

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
    let createdAoId: number | undefined;

    it("should create and get ao by id", async () => {
      const aoData = {
        name: "Test AO",
        orgType: "ao" as OrgType,
        isActive: true,
        parentId: MY_REGION_ID,
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
      await expect(
        caller.org.delete({ id: createdAoId, orgType: "ao" }),
      ).rejects.toThrow();
    });

    it("should fail to delete ao due to insufficient permissions", async () => {
      if (!createdAoId) {
        throw new Error("Created AO ID is undefined");
      }
      await expect(
        caller.org.delete({ id: createdAoId, orgType: "ao" }),
      ).rejects.toThrow();
    });

    it("should get all aos", async () => {
      const result = await caller.org.all({ orgTypes: ["ao"] });
      expect(result).toBeDefined();
    });
  });

  // Area Router Tests
  describe("area router", () => {
    it("should get all areas", async () => {
      const result = await caller.org.all({ orgTypes: ["area"] });
      expect(result).toBeDefined();
    });

    it("should create and get area by id", async () => {
      const areaData = {
        name: "Test Area",
        orgType: "area" as OrgType,
        isActive: true,
        parentId: TEST_SECTOR_ORG_ID,
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
      await expect(caller.org.crupdate(areaData)).rejects.toThrow();
    });

    it("should delete area", async () => {
      await expect(
        caller.org.delete({ id: TEST_AREA_ORG_ID, orgType: "area" }),
      ).rejects.toThrow();
    });
  });

  // Event Router Tests
  describe("event router", () => {
    it("should get all events", async () => {
      const result = await caller.event.all();
      expect(result).toBeDefined();
    });

    let eventId: number | undefined;
    let aoId: number | undefined;
    let locationId: number | undefined;

    it("should create and get event by id", async () => {
      const aoData = {
        name: "Test AO",
        orgType: "ao" as OrgType,
        isActive: true,
        parentId: MY_REGION_ID,
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
      aoId = aoResult.id;

      const locationData = {
        name: "Test Location",
        isActive: true,
        orgId: aoId,
        aoName: "Test AO",
        email: "test@location.com",
        description: "Test Location Description",
      };
      const locationResult = await caller.location.crupdate(locationData);
      expect(locationResult).toBeDefined();
      if (!locationResult?.id) {
        throw new Error("Location result is undefined");
      }
      locationId = locationResult.id;

      const eventData = {
        name: "Test Event",
        isActive: true,
        aoId,
        locationId,
        regionId: MY_REGION_ID,
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

    it("should fail to create event with poorly formatted time", async () => {
      if (!aoId || !locationId) {
        throw new Error("AO ID and location ID is undefined");
      }

      const eventData = {
        name: "Test Event",
        isActive: true,
        aoId,
        locationId,
        regionId: MY_REGION_ID,
        highlight: false,
        startDate: dayjs().format("YYYY-MM-DD"),
        startTime: "06:00", // HH:mm
        endTime: "07:00", // HH:mm
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
      await expect(caller.event.crupdate(eventData)).rejects.toThrow();
    });

    it("should get event types", async () => {
      const result = await caller.eventType.all();
      expect(result).toBeDefined();
    });

    it("should delete workout", async () => {
      if (!eventId) {
        throw new Error("Event ID is undefined");
      }
      await expect(caller.event.delete({ id: eventId })).rejects.toThrow();
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

    let createdLocationId: number | undefined;
    it("should create and get location by id", async () => {
      const locationData = {
        name: "Test Location",
        isActive: true,
        orgId: MY_REGION_ID,
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
      createdLocationId = locationResult.id;
      const result = await caller.location.byId({ id: locationResult.id });
      expect(result).toBeDefined();
    });

    it("should fail to delete location due to insufficient permissions", async () => {
      if (!createdLocationId) {
        throw new Error("Created location ID is undefined");
      }
      await expect(
        caller.location.delete({ id: createdLocationId }),
      ).rejects.toThrow();
    });

    it("should fail to get location due to missing events", async () => {
      if (!createdLocationId) {
        throw new Error("Created location ID is undefined");
      }
      await expect(
        caller.location.getLocationWorkoutData({
          locationId: createdLocationId,
        }),
      ).rejects.toThrow();
    });

    it("should get ao workout data after adding events", async () => {
      if (!createdLocationId) {
        throw new Error("Created location ID is undefined");
      }

      const eventData = {
        name: "Test Event",
        isActive: true,
        aoId: MY_REGION_ID,
        locationId: createdLocationId,
        dayOfWeek: "monday" as DayOfWeek,
        highlight: false,
        startDate: dayjs().format("YYYY-MM-DD"),
        startTime: "0600",
        endTime: "0700",
        email: "test@event.com",
        description: "Test Event Description",
        eventTypeIds: [1],
        regionId: MY_REGION_ID,
      };
      const eventResult = await caller.event.crupdate(eventData);
      expect(eventResult).toBeDefined();
      if (!eventResult) {
        throw new Error("Event result is undefined");
      }

      const result = await caller.location.getLocationWorkoutData({
        locationId: createdLocationId,
      });

      expect(result).toBeDefined();

      // Check the structure of the result
      if (result) {
        // Check location object
        expect(result.location).toBeDefined();
        expect(result.location.id).toBe(createdLocationId);
        expect(typeof result.location.lat).toBe("number");
        expect(typeof result.location.lon).toBe("number");
        expect(result.location.locationMeta).toEqual({ key: "value" });
        expect(result.location.locationAddress).toBe("123 Test St");
        expect(result.location.locationAddress2).toBe("Apt 4B");
        expect(result.location.locationCity).toBe("Test City");
        expect(result.location.locationState).toBe("TS");
        expect(result.location.locationZip).toBe("12345");
        expect(result.location.locationCountry).toBe("Test Country");
        expect(result.location.isActive).toBe(true);
        expect(result.location.created).toBeDefined();
        expect(result.location.updated).toBeDefined();
        expect(result.location.locationDescription).toBe(
          "Test Location Description",
        );
        expect(result.location.orgId).toBe(MY_REGION_ID);

        // Check Region fields
        expect(result.location.regionId).toBe(MY_REGION_ID);
        expect(result.location.regionLogo).toBeDefined();
        expect(result.location.regionWebsite).toBeDefined();
        expect(result.location.regionName).toBeDefined();

        // Check computed field
        expect(result.location.fullAddress).toBeDefined();
        expect(typeof result.location.fullAddress).toBe("string");
        expect(result.location.fullAddress).toContain("123 Test St");
        expect(result.location.fullAddress).toContain("Test City");
        expect(result.location.fullAddress).toContain("TS");
        // We've removed the zip code from the full address
        // expect(result.location.fullAddress).toContain("12345");

        // Check top-level events array
        expect(Array.isArray(result.location.events)).toBe(true);

        // If there are events, check their structure
        if (result.location.events.length > 0) {
          const event = result.location.events[0]!; // Use non-null assertion to fix linter error
          expect(event.id).toBeDefined();
          expect(event.name).toBe("Test Event");
          expect(event.dayOfWeek).toBe("monday");
          expect(event.startTime).toBe("0600");
          expect(event.endTime).toBe("0700");
          expect(event.description).toBe("Test Event Description");
          expect(Array.isArray(event.eventTypes)).toBe(true);

          // Check parent fields
          expect(event.aoId).toBe(MY_REGION_ID);
          expect(event.aoLogo).toBeDefined();
          expect(event.aoWebsite).toBeDefined();
          expect(event.aoName).toBeDefined();
        }
      }
    });
  });

  // Nation Router Tests
  describe("nation router", () => {
    it("should get all nations", async () => {
      const result = await caller.org.all({ orgTypes: ["nation"] });
      expect(result).toBeDefined();
    });

    it("should get all orgs", async () => {
      const result = await caller.org.all({ orgTypes: ["nation"] });
      expect(result).toBeDefined();
    });

    const randomNumber = Math.floor(Math.random() * 1000000);
    const name = `Test Nation ${randomNumber}`;
    it("should fail to update and get nation by id", async () => {
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
      await expect(caller.org.crupdate(nationData)).rejects.toThrow();
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

    it("should get region by id", async () => {
      const result = await caller.org.byId({
        id: MY_REGION_ID,
        orgType: "region" as OrgType,
      });
      expect(result).toBeDefined();
    });

    it("should fail to modify region without permission", async () => {
      const regionData = {
        id: TEST_REGION_1_ORG_ID,
        name: "Test Region 3",
        orgType: "region" as OrgType,
        isActive: true,
        parentId: TEST_SECTOR_ORG_ID,
        email: "test@region3.com",
        description: "Test Region 3 Description",
        logoUrl: "https://example.com/logo.png",
        website: "https://example.com",
        twitter: "@testregion3",
        facebook: "testregion3",
        instagram: "@testregion3",
        lastAnnualReview: dayjs().toISOString(),
        meta: { key: "value" },
      };
      // Try to create a new region
      await expect(caller.org.crupdate(regionData)).rejects.toThrow();

      // Try to modify an existing region they don't have access to
      await expect(
        caller.org.crupdate({
          ...regionData,
          id: TEST_REGION_3_ORG_ID, // Different region than editor has access to
        }),
      ).rejects.toThrow();
    });

    it("should fail to delete region", async () => {
      await expect(
        caller.org.delete({ id: MY_REGION_ID, orgType: "region" }),
      ).rejects.toThrow();
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
        orgIds: [MY_REGION_ID],
      });
      expect(result).toBeDefined();
    });

    it("should create a new request that is not auto approved", async () => {
      const requestData = {
        id: "123e4567-e89b-12d3-a456-426614174000",
        regionId: TEST_REGION_1_ORG_ID,
        eventTypeIds: [1],
        eventName: "Test Event Request",
        eventDescription: "Test Event Description",
        eventDayOfWeek: "monday" as DayOfWeek,
        eventStartTime: "0600",
        eventEndTime: "0700",
        aoName: "Test AO",
        locationName: "Test Location",
        locationDescription: "Test Location Description",
        locationAddress: "123 Test St",
        locationCity: "Test City",
        locationState: "TS",
        locationZip: "12345",
        locationCountry: "Test Country",
        submittedBy: "test@example.com",
        eventMeta: { key: "value" },
        requestType: "edit" as const,
      };

      const result = await caller.request.submitUpdateRequest(requestData);
      expect(result).toBeDefined();
      expect(result.status).toBe("pending");
    });

    it("should create a new request for an existing event into my own region that is not auto approved", async () => {
      const [newLoc] = await db
        .insert(schema.locations)
        .values({
          name: "Test Location",
          description: "Test Location Description",
          orgId: TEST_REGION_1_ORG_ID,
          isActive: true,
          latitude: 40.7128,
          longitude: -74.006,
        })
        .returning();

      if (!newLoc) {
        throw new Error("Failed to create new location");
      }

      const [eventNotInMyRegion] = await db
        .insert(schema.events)
        .values({
          name: "Test Event Not In My Region",
          description: "Test Event Description Not In My Region",
          dayOfWeek: "monday" as DayOfWeek,
          startTime: "0600",
          endTime: "0700",
          orgId: TEST_REGION_1_ORG_ID,
          locationId: newLoc.id,
          isActive: true,
          highlight: false,
          startDate: dayjs().format("YYYY-MM-DD"),
        })
        .returning();

      if (!eventNotInMyRegion) {
        throw new Error("Failed to create event not in my region");
      }

      const requestData = {
        id: "123e4567-e89b-12d3-a456-426614174006",
        regionId: MY_REGION_ID, // Attempt to move this event to my region  - Should fail since it didn't start in my region
        eventId: eventNotInMyRegion.id,
        eventTypeIds: [1],
        eventName: "Test Event Request",
        eventDescription: "Test Event Description",
        eventDayOfWeek: "monday" as DayOfWeek,
        eventStartTime: "0600",
        eventEndTime: "0700",
        aoName: "Test AO",
        locationName: "Test Location",
        locationDescription: "Test Location Description",
        locationAddress: "123 Test St",
        locationCity: "Test City",
        locationState: "TS",
        locationZip: "12345",
        locationCountry: "Test Country",
        submittedBy: "test@example.com",
        eventMeta: { key: "value" },
        requestType: "edit" as const,
      };

      const result = await caller.request.submitUpdateRequest(requestData);
      expect(result).toBeDefined();
      expect(result.status).toBe("pending");
    });

    it("should create a new request that is auto approved", async () => {
      const requestData = {
        id: "123e4567-e89b-12d3-a456-426614174005",
        regionId: MY_REGION_ID,
        eventTypeIds: [1],
        eventName: "Auto Approved Event",
        eventDescription: "Auto Approved Event Description",
        eventDayOfWeek: "monday" as DayOfWeek,
        eventStartTime: "0600",
        eventEndTime: "0700",
        aoName: "Test AO",
        locationName: "Test Location",
        locationDescription: "Test Location Description",
        locationAddress: "123 Test St",
        locationCity: "Test City",
        locationState: "TS",
        locationZip: "12345",
        locationCountry: "Test Country",
        submittedBy: "test@example.com",
        eventMeta: { autoApprove: true },
        requestType: "edit" as const,
      };

      const result = await caller.request.submitUpdateRequest(requestData);
      expect(result).toBeDefined();
      expect(result.status).toBe("approved");
    });

    it("should fail to create a new request with an invalid event start time", async () => {
      const requestData = {
        id: "123e4567-e89b-12d3-a456-426614174002",
        regionId: MY_REGION_ID,
        eventTypeIds: [1],
        eventName: "Invalid Start Time Event",
        eventDescription: "Test Description",
        eventDayOfWeek: "monday" as DayOfWeek,
        eventStartTime: "25:00",
        eventEndTime: "0700",
        aoName: "Test AO",
        locationName: "Test Location",
        locationDescription: "Test Location Description",
        locationAddress: "123 Test St",
        locationCity: "Test City",
        locationState: "TS",
        locationZip: "12345",
        locationCountry: "Test Country",
        submittedBy: "test@example.com",
        requestType: "edit" as const,
      };

      await expect(
        caller.request.submitUpdateRequest(requestData),
      ).rejects.toThrow();
    });

    it("should fail to create a new request with an invalid event end time", async () => {
      const requestData = {
        id: "123e4567-e89b-12d3-a456-426614174003",
        regionId: MY_REGION_ID,
        eventTypeIds: [1],
        eventName: "Invalid End Time Event",
        eventDescription: "Test Description",
        eventDayOfWeek: "monday" as DayOfWeek,
        eventStartTime: "0600",
        eventEndTime: "99:99",
        aoName: "Test AO",
        locationName: "Test Location",
        locationDescription: "Test Location Description",
        locationAddress: "123 Test St",
        locationCity: "Test City",
        locationState: "TS",
        locationZip: "12345",
        locationCountry: "Test Country",
        submittedBy: "test@example.com",
        requestType: "edit" as const,
      };

      await expect(
        caller.request.submitUpdateRequest(requestData),
      ).rejects.toThrow();
    });

    const callerWithPermissions = createCaller(
      createTRPCContext({
        id: TEST_EDITOR_USER_ID,
        email: "editor@test.com",
        roles: [
          {
            orgId: TEST_REGION_1_ORG_ID,
            orgName: "Test Region 1",
            roleName: "admin",
          },
        ],
      }),
    );

    it("should allow us to approve a request", async () => {
      // First create a request
      const requestData = {
        id: "123e4567-e89b-12d3-a456-426614174004",
        regionId: TEST_REGION_1_ORG_ID,
        eventTypeIds: [1],
        eventName: "Request To Approve",
        eventDescription: "Test Description",
        eventDayOfWeek: "monday" as DayOfWeek,
        eventStartTime: "0600",
        eventEndTime: "0700",
        aoName: "Test AO",
        locationName: "Test Location",
        locationDescription: "Test Location Description",
        locationAddress: "123 Test St",
        locationCity: "Test City",
        locationState: "TS",
        locationZip: "12345",
        locationCountry: "Test Country",
        submittedBy: "test@example.com",
        requestType: "edit" as const,
      };

      const request = await caller.request.submitUpdateRequest(requestData);
      expect(request.status).toBe("pending");

      // Then approve it
      const result =
        await callerWithPermissions.request.validateSubmissionByAdmin(
          requestData,
        );
      expect(result.status).toBe("approved");
    });

    it("should allow us to reject a request", async () => {
      // First create a request
      const requestData = {
        id: "123e4567-e89b-12d3-a456-426614174007",
        regionId: TEST_REGION_1_ORG_ID,
        eventTypeIds: [1],
        eventName: "Request To Reject",
        eventDescription: "Test Description",
        eventDayOfWeek: "monday" as DayOfWeek,
        eventStartTime: "0600",
        eventEndTime: "0700",
        aoName: "Test AO",
        locationName: "Test Location",
        locationDescription: "Test Location Description",
        locationAddress: "123 Test St",
        locationCity: "Test City",
        locationState: "TS",
        locationZip: "12345",
        locationCountry: "Test Country",
        submittedBy: "test@example.com",
        requestType: "edit" as const,
      };

      const request = await caller.request.submitUpdateRequest(requestData);
      expect(request.status).toBe("pending");

      if (!request.updateRequest.id) {
        throw new Error("Request ID is undefined");
      }

      // Then reject it
      await callerWithPermissions.request.rejectSubmission({
        id: request.updateRequest.id,
      });

      // Verify the request was rejected
      const updatedRequest = await caller.request.byId({
        id: request.updateRequest.id,
      });
      expect(updatedRequest?.status).toBe("rejected");
    });
  });

  // Sector Router Tests
  describe("sector router", () => {
    it("should fail to create and get sector by id", async () => {
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

      await expect(caller.org.crupdate(sectorData)).rejects.toThrow();
    });

    it("should fail to update and get sector by id", async () => {
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
      await expect(caller.org.crupdate(sectorData)).rejects.toThrow();
    });

    it("should fail to delete sector", async () => {
      await expect(
        caller.org.delete({ id: TEST_SECTOR_ORG_ID, orgType: "sector" }),
      ).rejects.toThrow();
    });

    it("should get all sectors", async () => {
      const result = await caller.org.all({ orgTypes: ["sector"] });
      expect(result).toBeDefined();
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
