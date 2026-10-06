/**
 * Reads made with an API key are scoped by the key's own roles, not its
 * owner's, and map-change requests are scoped to the caller's regions.
 *
 * These tests require TEST_DATABASE_URL to point at the seeded test database.
 */

import { vi } from "vitest";

const mockLimit = vi.hoisted(() => vi.fn());

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mockLimit };
  }),
}));

import type { Session } from "@acme/auth";
import { count, eq, schema } from "@acme/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  createTestClient,
  db,
  getOrCreateF3NationOrg,
  getOrCreateRoles,
  mockAuthWithSession,
  uniqueId,
} from "../__tests__/test-utils";

interface Org {
  id: number;
  name: string;
}

describe("API-key and request read scoping", () => {
  let nation: Org;
  let regionA: Org;
  let regionB: Org;
  let ownerId: number;
  let regionEditorId: number;
  let positionId: number;
  const requestIds: string[] = [];

  const ownerSession = (): Session => ({
    id: ownerId,
    email: "nation-owner@example.com",
    user: { id: String(ownerId), email: "nation-owner@example.com", roles: [] },
    roles: [{ orgId: nation.id, orgName: nation.name, roleName: "admin" }],
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  });

  /** A key owned by a nation admin, holding only `roles`. */
  const keySession = (roles: Session["roles"] = []): Session => {
    const owner = ownerSession();
    return {
      ...owner,
      roles,
      user: { ...owner.user, roles },
      apiKey: {
        id: 1,
        key: "test...key",
        ownerId,
        revokedAt: null,
        expiresAt: null,
        orgIds: roles.map((r) => r.orgId),
      },
    };
  };

  /**
   * A signed-in editor of region A. Its DB role row is what scopes reads;
   * `sessionRoles` only feeds the procedure-level role guards.
   */
  const regionEditorSession = (
    sessionRoles: Session["roles"] = [],
  ): Session => ({
    id: regionEditorId,
    email: "region-editor@example.com",
    user: {
      id: String(regionEditorId),
      email: "region-editor@example.com",
      roles: sessionRoles,
    },
    roles: sessionRoles,
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  });

  const editorKeyOn = (org: Org) =>
    keySession([{ orgId: org.id, orgName: org.name, roleName: "editor" }]);

  const insertRequest = async (regionId: number) => {
    const [request] = await db
      .insert(schema.updateRequests)
      .values({
        regionId,
        requestType: "create_event",
        eventName: `Scope Request ${uniqueId()}`,
        submittedBy: "submitter@example.com",
        status: "pending",
      })
      .returning({ id: schema.updateRequests.id });
    if (!request) throw new Error("Failed to create request");
    requestIds.push(request.id);
    return request.id;
  };

  beforeAll(async () => {
    await getOrCreateRoles();
    const nationOrg = await getOrCreateF3NationOrg();
    nation = { id: nationOrg.id, name: nationOrg.name ?? "F3 Nation" };

    const regions = await db
      .insert(schema.orgs)
      .values(
        ["A", "B"].map((suffix) => ({
          name: `Read Scope Region ${suffix} ${uniqueId()}`,
          orgType: "region" as const,
          parentId: nation.id,
          isActive: true,
        })),
      )
      .returning({ id: schema.orgs.id, name: schema.orgs.name });
    if (!regions[0] || !regions[1]) throw new Error("Failed to create regions");
    [regionA, regionB] = [regions[0], regions[1]];

    const [owner] = await db
      .insert(schema.users)
      .values({ email: `${uniqueId()}@example.com`, f3Name: "Nation Owner" })
      .returning({ id: schema.users.id });
    if (!owner) throw new Error("Failed to create owner");
    ownerId = owner.id;

    const [adminRole] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.name, "admin"));
    if (!adminRole) throw new Error("Admin role not seeded");
    await db
      .insert(schema.rolesXUsersXOrg)
      .values({ userId: ownerId, orgId: nation.id, roleId: adminRole.id });

    const [regionEditor] = await db
      .insert(schema.users)
      .values({ email: `${uniqueId()}@example.com`, f3Name: "Region Editor" })
      .returning({ id: schema.users.id });
    const [editorRole] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.name, "editor"));
    if (!regionEditor || !editorRole) throw new Error("Failed to seed editor");
    regionEditorId = regionEditor.id;
    await db.insert(schema.rolesXUsersXOrg).values({
      userId: regionEditorId,
      orgId: regionA.id,
      roleId: editorRole.id,
    });

    const [position] = await db
      .insert(schema.positions)
      .values({ name: `Scope Position ${uniqueId()}`, orgId: regionB.id })
      .returning({ id: schema.positions.id });
    if (!position) throw new Error("Failed to create position");
    positionId = position.id;
    await db
      .insert(schema.positionsXOrgsXUsers)
      .values({ positionId, orgId: regionB.id, userId: ownerId });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60000,
    });
  });

  afterAll(async () => {
    for (const id of requestIds) {
      await db
        .delete(schema.updateRequests)
        .where(eq(schema.updateRequests.id, id))
        .catch(() => undefined);
    }
    await db
      .delete(schema.positionsXOrgsXUsers)
      .where(eq(schema.positionsXOrgsXUsers.positionId, positionId))
      .catch(() => undefined);
    await db
      .delete(schema.positions)
      .where(eq(schema.positions.id, positionId))
      .catch(() => undefined);
    await cleanup.user(ownerId).catch(() => undefined);
    await cleanup.user(regionEditorId).catch(() => undefined);
    for (const org of [regionA, regionB]) {
      await cleanup.org(org.id).catch(() => undefined);
    }
  });

  describe("API keys use their own roles, not their owner's", () => {
    it("org.mine lists only the key's orgs", async () => {
      await mockAuthWithSession(keySession());
      expect((await createTestClient().org.mine()).orgs).toEqual([]);

      await mockAuthWithSession(editorKeyOn(regionA));
      const { orgs } = await createTestClient().org.mine();
      expect(orgs.map((org) => org.id)).toEqual([regionA.id]);
      expect(orgs[0]?.roles).toEqual(["editor"]);
    });

    it("org.accessible lists only orgs under the key's roles", async () => {
      await mockAuthWithSession(keySession());
      expect((await createTestClient().org.accessible({})).total).toBe(0);

      await mockAuthWithSession(editorKeyOn(regionA));
      const { orgs } = await createTestClient().org.accessible({
        pageSize: 100,
      });
      const ids = orgs.map((org) => org.id);
      expect(ids).toContain(regionA.id);
      expect(ids).not.toContain(regionB.id);
    });

    it("org.accessible lists every org for a key with a nation role", async () => {
      const [allOrgs] = await db
        .select({ total: count(schema.orgs.id) })
        .from(schema.orgs);

      await mockAuthWithSession(
        keySession([
          { orgId: nation.id, orgName: nation.name, roleName: "editor" },
        ]),
      );
      const { total } = await createTestClient().org.accessible({});
      expect(total).toBe(allOrgs?.total);
    });

    it("position.getAllAssignments hides the owner's nation-wide view", async () => {
      await mockAuthWithSession(keySession());
      const { assignments } =
        await createTestClient().position.getAllAssignments({ positionId });
      expect(assignments).toEqual([]);

      await mockAuthWithSession(ownerSession());
      const asOwner = await createTestClient().position.getAllAssignments({
        positionId,
      });
      expect(asOwner.assignments.map((a) => a.orgId)).toEqual([regionB.id]);
    });
  });

  describe("map-change requests are scoped to the caller's regions", () => {
    it("request.all omits other regions even without onlyMine", async () => {
      const inA = await insertRequest(regionA.id);
      const inB = await insertRequest(regionB.id);

      await mockAuthWithSession(editorKeyOn(regionA));
      const { requests } = await createTestClient().request.all({
        onlyMine: false,
        searchTerm: "Scope Request",
        pageSize: 100,
      });
      const ids = requests.map((r) => r.id);
      expect(ids).toContain(inA);
      expect(ids).not.toContain(inB);
    });

    it("request.all still returns every region to a nation admin", async () => {
      const inA = await insertRequest(regionA.id);
      const inB = await insertRequest(regionB.id);

      await mockAuthWithSession(ownerSession());
      const { requests } = await createTestClient().request.all({
        searchTerm: "Scope Request",
        pageSize: 100,
      });
      const ids = requests.map((r) => r.id);
      expect(ids).toContain(inA);
      expect(ids).toContain(inB);
    });

    it("request.byId reads other regions' requests as missing", async () => {
      const inA = await insertRequest(regionA.id);
      const inB = await insertRequest(regionB.id);

      await mockAuthWithSession(editorKeyOn(regionA));
      const client = createTestClient();
      expect((await client.request.byId({ id: inA })).request?.id).toBe(inA);
      expect((await client.request.byId({ id: inB })).request).toBeNull();
    });
  });

  describe("signed-in users keep their current scope", () => {
    it("org.mine and org.accessible read the user's roles from the database", async () => {
      await mockAuthWithSession(regionEditorSession());
      const client = createTestClient();

      const { orgs } = await client.org.mine();
      expect(orgs.map((org) => org.id)).toEqual([regionA.id]);
      expect(orgs[0]?.roles).toEqual(["editor"]);

      const accessible = await client.org.accessible({ pageSize: 100 });
      const ids = accessible.orgs.map((org) => org.id);
      expect(ids).toContain(regionA.id);
      expect(ids).not.toContain(regionB.id);
    });

    it("request.byId returns in-region requests and hides others", async () => {
      const inA = await insertRequest(regionA.id);
      const inB = await insertRequest(regionB.id);

      await mockAuthWithSession(
        regionEditorSession([
          { orgId: regionA.id, orgName: regionA.name, roleName: "editor" },
        ]),
      );
      const client = createTestClient();
      expect((await client.request.byId({ id: inA })).request?.id).toBe(inA);
      expect((await client.request.byId({ id: inB })).request).toBeNull();
    });
  });
});
