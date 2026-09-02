import type { Session } from "@acme/auth";
import { inArray, schema } from "@acme/db";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mockLimit = vi.hoisted(() => vi.fn());

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mockLimit };
  }),
}));

import {
  createTestClient,
  db,
  getOrCreateRoles,
  mockAuthWithSession,
  uniqueId,
} from "../__tests__/test-utils";
import { ORG_TREE_MAX_DEPTH } from "../org-tree";

describe("organization tree onlyMine router scoping", () => {
  const createdEventIds: number[] = [];
  const createdLocationIds: number[] = [];
  const createdOrgIds: number[] = [];
  const createdPositionIds: number[] = [];
  const createdRequestIds: string[] = [];
  const createdUserIds: number[] = [];
  const prefix = `OnlyMineDepth-${uniqueId()}`;

  let beyondOrgId: number;
  let boundaryOrgId: number;
  let editorSession: Session;
  let unbackedRoleSession: Session;
  let withinEventId: number;
  let beyondEventId: number;
  let withinLocationId: number;
  let beyondLocationId: number;
  let withinPositionId: number;
  let beyondPositionId: number;
  let withinRequestId: string;
  let beyondRequestId: string;

  const createSession = (params: {
    email: string;
    orgId?: number;
    orgName?: string;
    userId: number;
  }): Session => {
    const roles =
      params.orgId === undefined
        ? []
        : [
            {
              orgId: params.orgId,
              orgName: params.orgName ?? "OnlyMine root",
              roleName: "admin" as const,
            },
          ];

    return {
      id: params.userId,
      email: params.email,
      user: {
        id: String(params.userId),
        email: params.email,
        name: "OnlyMine Test User",
        roles,
      },
      roles,
      expires: new Date(Date.now() + 60_000).toISOString(),
    };
  };

  beforeAll(async () => {
    await getOrCreateRoles();

    let parentId: number | null = null;
    let root: { id: number; name: string } | undefined;
    for (let index = 0; index < ORG_TREE_MAX_DEPTH + 2; index++) {
      const insertedOrgs: { id: number; name: string }[] = await db
        .insert(schema.orgs)
        .values({
          name: `${prefix} Region ${index}`,
          orgType: "region",
          parentId,
          isActive: true,
        })
        .returning({ id: schema.orgs.id, name: schema.orgs.name });
      const org = insertedOrgs[0];
      if (!org) throw new Error("Failed to create onlyMine org chain");
      createdOrgIds.push(org.id);
      root ??= org;
      parentId = org.id;
      if (index === ORG_TREE_MAX_DEPTH) boundaryOrgId = org.id;
      if (index === ORG_TREE_MAX_DEPTH + 1) beyondOrgId = org.id;
    }
    if (!root || !boundaryOrgId || !beyondOrgId) {
      throw new Error("Failed to resolve onlyMine boundary fixtures");
    }

    const [adminRole] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(inArray(schema.roles.name, ["admin"]));
    if (!adminRole) throw new Error("Admin role not found");

    const users = await db
      .insert(schema.users)
      .values([
        {
          email: `only-mine-editor-${uniqueId()}@example.com`,
          f3Name: "OnlyMine Editor",
        },
        {
          email: `only-mine-no-role-${uniqueId()}@example.com`,
          f3Name: "OnlyMine No Role",
        },
      ])
      .returning({
        id: schema.users.id,
        email: schema.users.email,
      });
    const editorUser = users[0];
    const noRoleUser = users[1];
    if (!editorUser || !noRoleUser) {
      throw new Error("Failed to create onlyMine users");
    }
    createdUserIds.push(editorUser.id, noRoleUser.id);

    await db.insert(schema.rolesXUsersXOrg).values({
      roleId: adminRole.id,
      userId: editorUser.id,
      orgId: root.id,
    });
    editorSession = createSession({
      userId: editorUser.id,
      email: editorUser.email,
      orgId: root.id,
      orgName: root.name,
    });
    unbackedRoleSession = createSession({
      userId: noRoleUser.id,
      email: noRoleUser.email,
      orgId: root.id,
      orgName: root.name,
    });

    const locations = await db
      .insert(schema.locations)
      .values([
        {
          name: `${prefix} Within Location`,
          orgId: boundaryOrgId,
          isActive: true,
          latitude: 35,
          longitude: -80,
        },
        {
          name: `${prefix} Beyond Location`,
          orgId: beyondOrgId,
          isActive: true,
          latitude: 36,
          longitude: -81,
        },
      ])
      .returning({ id: schema.locations.id });
    const withinLocation = locations[0];
    const beyondLocation = locations[1];
    if (!withinLocation || !beyondLocation) {
      throw new Error("Failed to create onlyMine locations");
    }
    withinLocationId = withinLocation.id;
    beyondLocationId = beyondLocation.id;
    createdLocationIds.push(withinLocationId, beyondLocationId);

    const events = await db
      .insert(schema.events)
      .values([
        {
          name: `${prefix} Within Event`,
          orgId: boundaryOrgId,
          locationId: withinLocationId,
          dayOfWeek: "monday",
          startTime: "0530",
          startDate: "2026-01-01",
          isActive: true,
          isPrivate: false,
          highlight: false,
        },
        {
          name: `${prefix} Beyond Event`,
          orgId: beyondOrgId,
          locationId: beyondLocationId,
          dayOfWeek: "tuesday",
          startTime: "0600",
          startDate: "2026-01-01",
          isActive: true,
          isPrivate: false,
          highlight: false,
        },
      ])
      .returning({ id: schema.events.id });
    const withinEvent = events[0];
    const beyondEvent = events[1];
    if (!withinEvent || !beyondEvent) {
      throw new Error("Failed to create onlyMine events");
    }
    withinEventId = withinEvent.id;
    beyondEventId = beyondEvent.id;
    createdEventIds.push(withinEventId, beyondEventId);

    const positions = await db
      .insert(schema.positions)
      .values([
        {
          name: `${prefix} Within Position`,
          orgId: boundaryOrgId,
          orgType: "region",
          isActive: true,
        },
        {
          name: `${prefix} Beyond Position`,
          orgId: beyondOrgId,
          orgType: "region",
          isActive: true,
        },
      ])
      .returning({ id: schema.positions.id });
    const withinPosition = positions[0];
    const beyondPosition = positions[1];
    if (!withinPosition || !beyondPosition) {
      throw new Error("Failed to create onlyMine positions");
    }
    withinPositionId = withinPosition.id;
    beyondPositionId = beyondPosition.id;
    createdPositionIds.push(withinPositionId, beyondPositionId);

    const requests = await db
      .insert(schema.updateRequests)
      .values([
        {
          regionId: boundaryOrgId,
          requestType: "create_event",
          eventName: `${prefix} Within Request`,
          submittedBy: "only-mine@example.com",
          status: "pending",
        },
        {
          regionId: beyondOrgId,
          requestType: "create_event",
          eventName: `${prefix} Beyond Request`,
          submittedBy: "only-mine@example.com",
          status: "pending",
        },
      ])
      .returning({ id: schema.updateRequests.id });
    const withinRequest = requests[0];
    const beyondRequest = requests[1];
    if (!withinRequest || !beyondRequest) {
      throw new Error("Failed to create onlyMine requests");
    }
    withinRequestId = withinRequest.id;
    beyondRequestId = beyondRequest.id;
    createdRequestIds.push(withinRequestId, beyondRequestId);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mockLimit.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60_000,
    });
    await mockAuthWithSession(editorSession);
  });

  afterAll(async () => {
    if (createdRequestIds.length > 0) {
      await db
        .delete(schema.updateRequests)
        .where(inArray(schema.updateRequests.id, createdRequestIds));
    }
    if (createdEventIds.length > 0) {
      await db
        .delete(schema.events)
        .where(inArray(schema.events.id, createdEventIds));
    }
    if (createdPositionIds.length > 0) {
      await db
        .delete(schema.positions)
        .where(inArray(schema.positions.id, createdPositionIds));
    }
    if (createdLocationIds.length > 0) {
      await db
        .delete(schema.locations)
        .where(inArray(schema.locations.id, createdLocationIds));
    }
    if (createdUserIds.length > 0) {
      await db
        .delete(schema.rolesXUsersXOrg)
        .where(inArray(schema.rolesXUsersXOrg.userId, createdUserIds));
      await db
        .delete(schema.users)
        .where(inArray(schema.users.id, createdUserIds));
    }
    if (createdOrgIds.length > 0) {
      await db
        .delete(schema.orgs)
        .where(inArray(schema.orgs.id, createdOrgIds.reverse()));
    }
  });

  it("applies one depth budget to organization results", async () => {
    const result = await createTestClient().org.all({
      orgTypes: ["region"],
      onlyMine: true,
      searchTerm: prefix,
      pageIndex: 0,
      pageSize: 100,
    });
    const ids = result.orgs.map((org) => org.id);
    expect(ids).toContain(boundaryOrgId);
    expect(ids).not.toContain(beyondOrgId);
  });

  it("applies one depth budget to location results", async () => {
    const result = await createTestClient().location.all({
      onlyMine: true,
      searchTerm: prefix,
      pageIndex: 0,
      pageSize: 100,
    });
    const ids = result.locations.map((location) => location.id);
    expect(ids).toContain(withinLocationId);
    expect(ids).not.toContain(beyondLocationId);
  });

  it("applies one depth budget to admin event results", async () => {
    const result = await createTestClient().event.all({
      onlyMine: true,
      searchTerm: prefix,
      pageIndex: 0,
      pageSize: 100,
    });
    const ids = result.events.map((event) => event.id);
    expect(ids).toContain(withinEventId);
    expect(ids).not.toContain(beyondEventId);
  });

  it("applies one depth budget to map event results", async () => {
    const result = await createTestClient().map.event.all({
      onlyMine: true,
      searchTerm: prefix,
      pageIndex: 0,
      pageSize: 100,
    });
    const ids = result.events.map((event) => event.id);
    expect(ids).toContain(withinEventId);
    expect(ids).not.toContain(beyondEventId);
  });

  it("applies one depth budget to position results", async () => {
    const result = await createTestClient().position.all({
      onlyMine: true,
      searchTerm: prefix,
      pageIndex: 0,
      pageSize: 100,
    });
    const ids = result.positions.map((position) => position.id);
    expect(ids).toContain(withinPositionId);
    expect(ids).not.toContain(beyondPositionId);
  });

  it("fails closed when session roles have no database-backed editable scope", async () => {
    await mockAuthWithSession(unbackedRoleSession);
    const result = await createTestClient().position.all({
      onlyMine: true,
      searchTerm: prefix,
      pageIndex: 0,
      pageSize: 100,
    });
    expect(result).toEqual({ positions: [], totalCount: 0 });
  });

  it("keeps request scoping on deep non-AO editable organizations", async () => {
    const result = await createTestClient().request.all({
      onlyMine: true,
      searchTerm: prefix,
      pageIndex: 0,
      pageSize: 100,
    });
    const ids = result.requests.map((request) => request.id);
    expect(ids).toContain(withinRequestId);
    expect(ids).not.toContain(beyondRequestId);
  });
});
