/**
 * Org scoping for user.crupdate profile writes.
 *
 * These tests require TEST_DATABASE_URL to point at the seeded test database.
 */

import { vi } from "vitest";
import type * as orgTree from "../org-tree";
import type * as logger from "../logger";

const mockLimit = vi.hoisted(() => vi.fn());
const mockLogInfo = vi.hoisted(() => vi.fn());
const mockDepthScan = vi.hoisted(() => vi.fn());
vi.mock("../org-tree", async (importOriginal) => {
  const original = await importOriginal<typeof orgTree>();
  return {
    ...original,
    logIfOrgTreeExceedsMaxDepth: mockDepthScan.mockImplementation(
      original.logIfOrgTreeExceedsMaxDepth,
    ),
  };
});
vi.mock("../logger", async (importOriginal) => ({
  ...(await importOriginal<typeof logger>()),
  logInfo: mockLogInfo,
}));

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mockLimit };
  }),
}));

import type { Session } from "@acme/auth";
import { eq, schema, sql } from "@acme/db";
import { mail } from "@acme/mail";
import { notifyWebhooks } from "../lib/notify-webhooks";
import { ERRORS } from "@acme/shared/app/errors";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
} from "vitest";
import {
  cleanup,
  createAdminSession,
  createEditorSession,
  createTestClient,
  db,
  getOrCreateF3NationOrg,
  getOrCreateRoles,
  mockAuthWithSession,
  uniqueId,
} from "../__tests__/test-utils";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("user.crupdate org scoping", () => {
  const createdUserIds: number[] = [];
  const createdOrgIds: number[] = [];
  let regionA: { id: number; name: string };
  let regionB: { id: number; name: string };

  const createRegion = async () => {
    const nation = await getOrCreateF3NationOrg();
    const [region] = await db
      .insert(schema.orgs)
      .values({
        name: `Scope Region ${uniqueId()}`,
        orgType: "region",
        parentId: nation.id,
        isActive: true,
      })
      .returning({ id: schema.orgs.id, name: schema.orgs.name });
    if (!region) throw new Error("Failed to create region");
    createdOrgIds.push(region.id);
    return region;
  };

  const createUser = async (
    values: Partial<typeof schema.users.$inferInsert> = {},
  ) => {
    const [user] = await db
      .insert(schema.users)
      .values({
        email: `${uniqueId()}@example.com`,
        f3Name: "Original",
        ...values,
      })
      .returning();
    if (!user) throw new Error("Failed to create user");
    createdUserIds.push(user.id);
    return user;
  };

  const grantRole = async (
    userId: number,
    orgId: number,
    roleName: "editor" | "admin",
  ) => {
    const [role] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.name, roleName));
    if (!role) throw new Error(`Role ${roleName} not seeded`);
    await db
      .insert(schema.rolesXUsersXOrg)
      .values({ userId, orgId, roleId: role.id });
  };

  const readUser = async (id: number) => {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));
    return user;
  };

  const editorOf = (region: { id: number; name: string }) =>
    createEditorSession({ orgId: region.id, orgName: region.name });

  beforeAll(async () => {
    await getOrCreateRoles();
    regionA = await createRegion();
    regionB = await createRegion();
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
    for (const userId of createdUserIds.reverse()) {
      await cleanup.user(userId).catch(() => undefined);
    }
    for (const orgId of createdOrgIds.reverse()) {
      await cleanup.org(orgId).catch(() => undefined);
    }
  });

  it("rejects a profile write to a user with no home region and no role in the caller's orgs", async () => {
    const target = await createUser({ homeRegionId: null });
    await mockAuthWithSession(editorOf(regionA));

    await expect(
      createTestClient().user.crupdate({
        id: target.id,
        f3Name: "Hijacked",
        status: "inactive",
        homeRegionId: regionA.id,
        roles: [],
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const after = await readUser(target.id);
    expect(after?.f3Name).toBe("Original");
    expect(after?.status).toBe("active");
    expect(after?.homeRegionId).toBeNull();
  });

  it("writes the profile of a user with no home region who holds a role in the caller's org", async () => {
    const target = await createUser({ homeRegionId: null });
    await grantRole(target.id, regionA.id, "editor");
    await mockAuthWithSession(editorOf(regionA));

    await createTestClient().user.crupdate({
      id: target.id,
      f3Name: "Renamed",
      roles: [{ orgId: regionA.id, roleName: "editor" }],
    });

    expect((await readUser(target.id))?.f3Name).toBe("Renamed");
  });

  it("rejects moving a user's home region into an org the caller can't edit", async () => {
    const target = await createUser({ homeRegionId: regionA.id });
    await mockAuthWithSession(editorOf(regionA));

    await expect(
      createTestClient().user.crupdate({
        id: target.id,
        homeRegionId: regionB.id,
        roles: [],
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect((await readUser(target.id))?.homeRegionId).toBe(regionA.id);
  });

  it.each(["editor", "admin"] as const)(
    "rejects creating a user outside the caller's regions (%s)",
    async (roleName) => {
      const email = `${uniqueId()}@example.com`;
      await mockAuthWithSession({
        ...editorOf(regionA),
        roles: [{ orgId: regionA.id, orgName: regionA.name, roleName }],
      });

      await expect(
        createTestClient().user.crupdate({
          email,
          f3Name: "Planted",
          homeRegionId: regionB.id,
          roles: [],
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

      const [created] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, email));
      if (created) createdUserIds.push(created.id);
      expect(created).toBeUndefined();
    },
  );

  it("creates a user homed in an org the caller can edit", async () => {
    await mockAuthWithSession(editorOf(regionA));

    const created = await createTestClient().user.crupdate({
      email: `${uniqueId()}@example.com`,
      f3Name: "Welcome",
      homeRegionId: regionA.id,
      roles: [],
    });
    createdUserIds.push(created.id);

    expect(created.homeRegionId).toBe(regionA.id);
  });

  it("moves a user's home region when the caller edits both regions", async () => {
    const target = await createUser({ homeRegionId: regionA.id });
    const session = editorOf(regionA);
    const roles = [
      ...session.roles!,
      { orgId: regionB.id, orgName: regionB.name, roleName: "editor" as const },
    ];
    await mockAuthWithSession({ ...session, roles });

    await createTestClient().user.crupdate({
      id: target.id,
      homeRegionId: regionB.id,
      roles: [],
    });

    expect((await readUser(target.id))?.homeRegionId).toBe(regionB.id);
  });

  it("returns NOT_FOUND for an id that doesn't exist", async () => {
    await mockAuthWithSession(editorOf(regionA));

    await expect(
      createTestClient().user.crupdate({
        id: 2_000_000_000,
        f3Name: "Ghost",
        roles: [],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets a signed-in user edit their own profile", async () => {
    const target = await createUser({ homeRegionId: regionB.id });
    await mockAuthWithSession({ ...editorOf(regionA), id: target.id });

    await createTestClient().user.crupdate({
      id: target.id,
      f3Name: "Me",
      roles: [],
    });

    expect((await readUser(target.id))?.f3Name).toBe("Me");
  });

  it("lets a nation admin edit a user with no home region and no roles", async () => {
    const target = await createUser({ homeRegionId: null });
    await mockAuthWithSession(await createAdminSession());

    await createTestClient().user.crupdate({
      id: target.id,
      f3Name: "Renamed",
      roles: [],
    });

    expect((await readUser(target.id))?.f3Name).toBe("Renamed");
  });

  it("ignores caller-supplied emailVerified", async () => {
    const target = await createUser({ homeRegionId: regionA.id });
    await mockAuthWithSession(await createAdminSession());

    await createTestClient().user.crupdate({
      id: target.id,
      emailVerified: "2020-01-01T00:00:00Z",
      roles: [],
    });

    expect((await readUser(target.id))?.emailVerified).toBeNull();
  });

  it("does not treat an API key as its owner editing themselves", async () => {
    const owner = await createUser({ homeRegionId: regionB.id });
    const keySession: Session = {
      ...editorOf(regionA),
      id: owner.id,
      apiKey: {
        id: 1,
        key: "test...key",
        ownerId: owner.id,
        revokedAt: null,
        expiresAt: null,
        orgIds: [regionA.id],
      },
    };
    await mockAuthWithSession(keySession);

    await expect(
      createTestClient().user.crupdate({
        id: owner.id,
        f3Name: "Hijacked",
        roles: [],
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect((await readUser(owner.id))?.f3Name).toBe("Original");
  });

  it("allows a role change that resends the unchanged profile it can't edit", async () => {
    const target = await createUser({ homeRegionId: null, firstName: null });
    const session = editorOf(regionA);
    const roles = [
      { orgId: regionA.id, orgName: regionA.name, roleName: "admin" as const },
    ];
    await mockAuthWithSession({ ...session, roles });

    await createTestClient().user.crupdate({
      id: target.id,
      f3Name: "Original",
      firstName: "",
      homeRegionId: null,
      status: "active",
      roles: [{ orgId: regionA.id, roleName: "editor" }],
    });

    const granted = await db
      .select()
      .from(schema.rolesXUsersXOrg)
      .where(eq(schema.rolesXUsersXOrg.userId, target.id));
    expect(granted.map((role) => role.orgId)).toEqual([regionA.id]);
    expect((await readUser(target.id))?.firstName).toBeNull();
  });

  const adminOf = (region: { id: number; name: string }): Session => ({
    ...editorOf(region),
    roles: [{ orgId: region.id, orgName: region.name, roleName: "admin" }],
  });
  const asKey = (session: Session): Session => ({
    ...session,
    apiKey: {
      id: 1,
      key: "synthetic-key",
      ownerId: session.id,
      revokedAt: null,
      expiresAt: null,
      orgIds: session.roles?.map((role) => role.orgId) ?? [],
    },
  });

  it.each([
    { apiKey: false, optOut: true },
    { apiKey: true, optOut: true },
    { apiKey: false, optOut: false },
    { apiKey: true, optOut: false },
  ])(
    "lets a source admin correct a member without destination rights ($apiKey, $optOut)",
    async ({ apiKey, optOut }) => {
      const sendMail = vi.spyOn(mail, "sendTemplateMessages");
      const target = await createUser({
        homeRegionId: regionA.id,
        meta: optOut ? { home_region_nudge_opt_out: true } : null,
      });
      await grantRole(target.id, regionB.id, "editor");
      const session = apiKey ? asKey(adminOf(regionA)) : adminOf(regionA);
      await mockAuthWithSession(session);
      await createTestClient().user.crupdate({
        id: target.id,
        f3Name: "Corrected",
        email: `Corrected.Member.${target.id}@Example.com`,
        homeRegionId: regionB.id,
        roles: [{ orgId: regionB.id, roleName: "editor" }],
      });
      expect(mockDepthScan).toHaveBeenCalledWith(db);
      expect(await readUser(target.id)).toMatchObject({
        homeRegionId: regionB.id,
        f3Name: "Corrected",
        email: `corrected.member.${target.id}@example.com`,
      });
      expect((await readUser(target.id))?.meta).toEqual(
        optOut ? { home_region_nudge_opt_out: true } : null,
      );
      expect(sendMail).not.toHaveBeenCalled();
      expect(notifyWebhooks).not.toHaveBeenCalled();
      const roles = await db
        .select()
        .from(schema.rolesXUsersXOrg)
        .where(eq(schema.rolesXUsersXOrg.userId, target.id));
      expect(roles.map((role) => role.orgId)).toEqual([regionB.id]);
      expect(mockLogInfo).toHaveBeenCalledWith(
        "api.user.home_region_corrected",
        {
          actorId: session.id,
          apiKeyId: apiKey ? 1 : undefined,
          userId: target.id,
          fromOrgId: regionA.id,
          toOrgId: regionB.id,
        },
      );
    },
  );

  it("honors an ancestor administrator's source permissions", async () => {
    const ancestor = await createRegion();
    const source = await createRegion();
    await db
      .update(schema.orgs)
      .set({ orgType: "area" })
      .where(eq(schema.orgs.id, ancestor.id));
    await db
      .update(schema.orgs)
      .set({ parentId: ancestor.id })
      .where(eq(schema.orgs.id, source.id));
    const target = await createUser({ homeRegionId: source.id });
    await mockAuthWithSession(adminOf(ancestor));
    await createTestClient().user.crupdate({
      id: target.id,
      homeRegionId: regionB.id,
      roles: [],
    });
    expect((await readUser(target.id))?.homeRegionId).toBe(regionB.id);
  });

  it.each([
    { apiKey: false, linked: false },
    { apiKey: true, linked: false },
    { apiKey: false, linked: true },
    { apiKey: true, linked: true },
  ])(
    "does not use an unrelated admin grant alongside source editing ($apiKey, $linked)",
    async ({ apiKey, linked }) => {
      const other = await createRegion();
      const target = await createUser({ homeRegionId: regionA.id });
      if (linked) await grantRole(target.id, other.id, "editor");
      const session = {
        ...editorOf(regionA),
        roles: [
          ...(editorOf(regionA).roles ?? []),
          ...(adminOf(other).roles ?? []),
        ],
      };
      await mockAuthWithSession(apiKey ? asKey(session) : session);
      await expect(
        createTestClient().user.crupdate({
          id: target.id,
          homeRegionId: regionB.id,
          roles: linked ? [{ orgId: other.id, roleName: "editor" }] : [],
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect((await readUser(target.id))?.homeRegionId).toBe(regionA.id);
      expect(mockLogInfo).not.toHaveBeenCalled();
    },
  );

  it("does not remove a destination role without its administrator permission", async () => {
    const target = await createUser({ homeRegionId: regionA.id });
    await grantRole(target.id, regionB.id, "editor");
    await mockAuthWithSession(adminOf(regionA));
    await expect(
      createTestClient().user.crupdate({
        id: target.id,
        homeRegionId: regionB.id,
        roles: [],
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect((await readUser(target.id))?.homeRegionId).toBe(regionA.id);
    expect(
      await db
        .select()
        .from(schema.rolesXUsersXOrg)
        .where(eq(schema.rolesXUsersXOrg.userId, target.id)),
    ).toHaveLength(1);
    expect(mockLogInfo).not.toHaveBeenCalled();
  });

  it("does not borrow an API key owner's source administrator role", async () => {
    const owner = await createUser({ homeRegionId: regionA.id });
    await grantRole(owner.id, regionA.id, "admin");
    const target = await createUser({ homeRegionId: regionA.id });
    await mockAuthWithSession(asKey({ ...editorOf(regionA), id: owner.id }));
    await expect(
      createTestClient().user.crupdate({
        id: target.id,
        homeRegionId: regionB.id,
        roles: [],
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect((await readUser(target.id))?.homeRegionId).toBe(regionA.id);
    expect(mockLogInfo).not.toHaveBeenCalled();
  });

  it("does not give an unrelated administrator the correction exception", async () => {
    const target = await createUser({ homeRegionId: regionA.id });
    await mockAuthWithSession(adminOf(regionB));
    await expect(
      createTestClient().user.crupdate({
        id: target.id,
        homeRegionId: regionB.id,
        roles: [],
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect((await readUser(target.id))?.homeRegionId).toBe(regionA.id);
  });

  it.each(["self", "both", "source", "new", "unhomed"] as const)(
    "validates destinations on the %s path",
    async (path) => {
      const destination = await createRegion();
      await db
        .update(schema.orgs)
        .set({ orgType: "ao" })
        .where(eq(schema.orgs.id, destination.id));
      const target = await createUser({
        homeRegionId: path === "unhomed" ? null : regionA.id,
      });
      const session =
        path === "source"
          ? adminOf(regionA)
          : path === "both"
            ? {
                ...editorOf(regionA),
                roles: [
                  ...(editorOf(regionA).roles ?? []),
                  ...(editorOf(destination).roles ?? []),
                ],
              }
            : await createAdminSession();
      await mockAuthWithSession(
        path === "self" ? { ...session, id: target.id } : session,
      );
      const input =
        path === "new"
          ? { email: `${uniqueId()}@example.invalid` }
          : { id: target.id };
      await expect(
        createTestClient().user.crupdate({
          ...input,
          homeRegionId: destination.id,
          roles: [],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      if (input.email !== undefined) {
        const rows = await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.email, input.email));
        createdUserIds.push(...rows.map((row) => row.id));
        expect(rows).toEqual([]);
      } else {
        expect((await readUser(target.id))?.homeRegionId).toBe(
          path === "unhomed" ? null : regionA.id,
        );
      }
      expect(mockLogInfo).not.toHaveBeenCalled();
    },
  );

  it.each(["missing", "inactive", "inactive-ancestor"] as const)(
    "rejects a %s destination atomically",
    async (kind) => {
      const parent =
        kind === "inactive-ancestor" ? await createRegion() : undefined;
      const destination = await createRegion();
      if (kind === "inactive")
        await db
          .update(schema.orgs)
          .set({ isActive: false })
          .where(eq(schema.orgs.id, destination.id));
      if (parent) {
        await db
          .update(schema.orgs)
          .set({ orgType: "area", isActive: false })
          .where(eq(schema.orgs.id, parent.id));
        await db
          .update(schema.orgs)
          .set({ parentId: parent.id })
          .where(eq(schema.orgs.id, destination.id));
      }
      const target = await createUser({ homeRegionId: regionA.id });
      await mockAuthWithSession(await createAdminSession());
      await expect(
        createTestClient().user.crupdate({
          id: target.id,
          f3Name: "Should not persist",
          homeRegionId: kind === "missing" ? 2000000000 : destination.id,
          roles: [],
        }),
      ).rejects.toMatchObject({
        code: kind === "missing" ? "NOT_FOUND" : "BAD_REQUEST",
      });
      expect((await readUser(target.id))?.f3Name).toBe("Original");
      expect((await readUser(target.id))?.homeRegionId).toBe(regionA.id);
      expect(mockLogInfo).not.toHaveBeenCalled();
    },
  );

  it("permits unchanged inactive home regions and preserves null clearing", async () => {
    const source = await createRegion();
    await db
      .update(schema.orgs)
      .set({ isActive: false })
      .where(eq(schema.orgs.id, source.id));
    const target = await createUser({ homeRegionId: source.id });
    await mockAuthWithSession(editorOf(source));
    await createTestClient().user.crupdate({
      id: target.id,
      homeRegionId: source.id,
      f3Name: "Renamed",
      roles: [],
    });
    expect((await readUser(target.id))?.f3Name).toBe("Renamed");
    await createTestClient().user.crupdate({
      id: target.id,
      homeRegionId: null,
      roles: [],
    });
    expect((await readUser(target.id))?.homeRegionId).toBeNull();
    expect(mockLogInfo).not.toHaveBeenCalled();
  });

  it("does not use the correction exception for initial placement", async () => {
    const target = await createUser({ homeRegionId: null });
    await grantRole(target.id, regionA.id, "editor");
    await mockAuthWithSession(adminOf(regionA));
    await expect(
      createTestClient().user.crupdate({
        id: target.id,
        homeRegionId: regionB.id,
        roles: [{ orgId: regionA.id, roleName: "editor" }],
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect((await readUser(target.id))?.homeRegionId).toBeNull();
  });

  it("rejects an unauthorized role edit with a correction without saving or logging success", async () => {
    const target = await createUser({ homeRegionId: regionA.id });
    await mockAuthWithSession(adminOf(regionA));
    await expect(
      createTestClient().user.crupdate({
        id: target.id,
        homeRegionId: regionB.id,
        roles: [{ orgId: regionB.id, roleName: "admin" }],
      }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: ERRORS.MUST_BE_ADMIN_TO_GRANT_ROLES,
    });
    expect((await readUser(target.id))?.homeRegionId).toBe(regionA.id);
    expect(
      await db
        .select()
        .from(schema.rolesXUsersXOrg)
        .where(eq(schema.rolesXUsersXOrg.userId, target.id)),
    ).toEqual([]);
    expect(mockLogInfo).not.toHaveBeenCalled();
  });

  it.each(["40P01", "55P03"])(
    "maps database concurrency error %s to a retryable conflict at either write stage",
    async (code) => {
      for (const stage of ["execute", "update"] as const) {
        const target = await createUser({ homeRegionId: regionA.id });
        await mockAuthWithSession(adminOf(regionA));
        const transaction = db.transaction.bind(db);
        if (!globalThis.db)
          throw new Error("Database fixture was not initialized");
        const spy = vi
          .spyOn(globalThis.db, "transaction")
          .mockImplementationOnce((callback, config) =>
            transaction(async (tx) => {
              const failing = vi.spyOn(tx, stage).mockImplementationOnce(() => {
                throw new Error("Synthetic driver wrapper", {
                  cause: Object.assign(
                    new Error("Synthetic concurrency fault"),
                    { code },
                  ),
                });
              });
              try {
                return await callback(tx);
              } finally {
                failing.mockRestore();
              }
            }, config),
          );
        try {
          await expect(
            createTestClient().user.crupdate({
              id: target.id,
              f3Name: "Must not persist",
              homeRegionId: regionB.id,
              roles: [],
            }),
          ).rejects.toMatchObject({ code: "CONFLICT" });
          expect((await readUser(target.id))?.homeRegionId).toBe(regionA.id);
          expect((await readUser(target.id))?.f3Name).toBe("Original");
          expect(mockLogInfo).not.toHaveBeenCalled();
        } finally {
          spy.mockRestore();
        }
      }
    },
  );

  it.each(["cycle", "truncated", "boundary"])(
    "validates the complete bounded ancestry (%s)",
    async (kind) => {
      const destination = await createRegion();
      let current = destination;
      const edges = kind === "truncated" ? 21 : kind === "boundary" ? 20 : 1;
      for (let index = 0; index < edges; index++) {
        const parent = await createRegion();
        await db
          .update(schema.orgs)
          .set({ parentId: parent.id })
          .where(eq(schema.orgs.id, current.id));
        current = parent;
      }
      await db
        .update(schema.orgs)
        .set({ parentId: kind === "cycle" ? destination.id : null })
        .where(eq(schema.orgs.id, current.id));
      const target = await createUser({ homeRegionId: regionA.id });
      await mockAuthWithSession(adminOf(regionA));
      const saving = createTestClient().user.crupdate({
        id: target.id,
        homeRegionId: destination.id,
        roles: [],
      });
      if (kind === "boundary") {
        await saving;
        expect((await readUser(target.id))?.homeRegionId).toBe(destination.id);
      } else {
        await expect(saving).rejects.toMatchObject({ code: "BAD_REQUEST" });
        expect((await readUser(target.id))?.homeRegionId).toBe(regionA.id);
      }
      // Break synthetic cycles before ordinary fixture cleanup.
      await db
        .update(schema.orgs)
        .set({ parentId: null })
        .where(eq(schema.orgs.id, current.id));
    },
  );

  it.each(["deactivate", "reparent"])(
    "holds ancestor locks through profile commit against concurrent %s",
    async (change) => {
      const destination = await createRegion();
      const ancestor = await createRegion();
      const alternate = await createRegion();
      await db
        .update(schema.orgs)
        .set({ parentId: ancestor.id })
        .where(eq(schema.orgs.id, destination.id));
      const target = await createUser({ homeRegionId: regionA.id });
      await mockAuthWithSession(adminOf(regionA));
      const saved = deferred<void>();
      const release = deferred<void>();
      const writerPid = deferred<number>();
      const transaction = db.transaction.bind(db);
      if (!globalThis.db)
        throw new Error("Database fixture was not initialized");
      const spy = vi
        .spyOn(globalThis.db, "transaction")
        .mockImplementationOnce((callback, config) =>
          transaction(async (tx) => {
            const result = await callback(tx);
            saved.resolve();
            await release.promise;
            return result;
          }, config),
        );
      const saving = createTestClient().user.crupdate({
        id: target.id,
        homeRegionId: destination.id,
        roles: [],
      });
      let writer: Promise<unknown> | undefined;
      try {
        await saved.promise;
        writer = transaction(async (tx) => {
          const [row] = await tx.execute<{ pid: number }>(
            sql`SELECT pg_backend_pid() AS pid`,
          );
          if (!row) throw new Error("Missing writer backend");
          writerPid.resolve(row.pid);
          await tx
            .update(schema.orgs)
            .set(
              change === "deactivate"
                ? { isActive: false }
                : { parentId: alternate.id },
            )
            .where(eq(schema.orgs.id, ancestor.id));
        });
        const pid = await writerPid.promise;
        await vi.waitFor(async () => {
          const [row] = await db.execute<{ blocked: boolean }>(
            sql`SELECT cardinality(pg_blocking_pids(${pid})) > 0 AS blocked`,
          );
          expect(row?.blocked).toBe(true);
        });
        release.resolve();
        await saving;
        await writer;
        expect((await readUser(target.id))?.homeRegionId).toBe(destination.id);
      } finally {
        release.resolve();
        await Promise.allSettled([saving, ...(writer ? [writer] : [])]);
        spy.mockRestore();
      }
    },
  );

  it("rejects newly discovered ancestry after waiting for a concurrent reparent", async () => {
    const destination = await createRegion();
    const alternate = await createRegion();
    const target = await createUser({ homeRegionId: regionA.id });
    await mockAuthWithSession(adminOf(regionA));
    const writerReady = deferred<void>();
    const releaseWriter = deferred<void>();
    const profilePid = deferred<number>();
    const transaction = db.transaction.bind(db);
    const writer = transaction(async (tx) => {
      await tx
        .update(schema.orgs)
        .set({ parentId: alternate.id })
        .where(eq(schema.orgs.id, destination.id));
      writerReady.resolve();
      await releaseWriter.promise;
    });
    await writerReady.promise;
    if (!globalThis.db) throw new Error("Database fixture was not initialized");
    const spy = vi
      .spyOn(globalThis.db, "transaction")
      .mockImplementationOnce((callback, config) =>
        transaction(async (tx) => {
          const [row] = await tx.execute<{ pid: number }>(
            sql`SELECT pg_backend_pid() AS pid`,
          );
          if (!row) throw new Error("Missing profile backend");
          profilePid.resolve(row.pid);
          return callback(tx);
        }, config),
      );
    const saving = createTestClient().user.crupdate({
      id: target.id,
      f3Name: "Must not persist",
      homeRegionId: destination.id,
      roles: [],
    });
    // Attach rejection handling before releasing the competing transaction.
    const rejected = saving.then(
      () => undefined,
      (error: unknown) => error,
    );
    try {
      const pid = await profilePid.promise;
      await vi.waitFor(async () => {
        const [row] = await db.execute<{ blocked: boolean }>(
          sql`SELECT cardinality(pg_blocking_pids(${pid})) > 0 AS blocked`,
        );
        expect(row?.blocked).toBe(true);
      });
      releaseWriter.resolve();
      await writer;
      expect(await rejected).toMatchObject({ code: "CONFLICT" });
      expect((await readUser(target.id))?.homeRegionId).toBe(regionA.id);
      expect((await readUser(target.id))?.f3Name).toBe("Original");
      expect(mockLogInfo).not.toHaveBeenCalled();
    } finally {
      releaseWriter.resolve();
      await Promise.allSettled([writer, saving, rejected]);
      spy.mockRestore();
    }
  });

  it.each(["destination", "ancestor"])(
    "rejects a %s retired after initial validation without changing profile or roles",
    async (kind) => {
      const destination = await createRegion();
      const ancestor = await createRegion();
      await db
        .update(schema.orgs)
        .set({ parentId: ancestor.id })
        .where(eq(schema.orgs.id, destination.id));
      const target = await createUser({ homeRegionId: regionA.id });
      await mockAuthWithSession(adminOf(regionA));
      const transaction = db.transaction.bind(db);
      if (!globalThis.db)
        throw new Error("Database fixture was not initialized");
      const spy = vi
        .spyOn(globalThis.db, "transaction")
        .mockImplementationOnce(async (callback, config) => {
          await db
            .update(schema.orgs)
            .set({ isActive: false })
            .where(
              eq(
                schema.orgs.id,
                kind === "destination" ? destination.id : ancestor.id,
              ),
            );
          return transaction(callback, config);
        });
      try {
        await expect(
          createTestClient().user.crupdate({
            id: target.id,
            f3Name: "Must not persist",
            homeRegionId: destination.id,
            roles: [],
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        expect((await readUser(target.id))?.homeRegionId).toBe(regionA.id);
        expect((await readUser(target.id))?.f3Name).toBe("Original");
        expect(mockLogInfo).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    },
  );

  it("rolls back the correction if a role insert fails and emits no success event", async () => {
    const target = await createUser({ homeRegionId: regionA.id });
    const roleOrg = await createRegion();
    await mockAuthWithSession(await createAdminSession());
    const transaction = db.transaction.bind(db);
    if (!globalThis.db) throw new Error("Database fixture was not initialized");
    // Remove the authorized role target between authorization and persistence:
    // the role foreign key fails after the profile update in the transaction.
    const spy = vi
      .spyOn(globalThis.db, "transaction")
      .mockImplementationOnce(async (callback, config) => {
        await db.delete(schema.orgs).where(eq(schema.orgs.id, roleOrg.id));
        return transaction(callback, config);
      });
    try {
      await expect(
        createTestClient().user.crupdate({
          id: target.id,
          homeRegionId: regionB.id,
          roles: [{ orgId: roleOrg.id, roleName: "editor" }],
        }),
      ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
      expect(spy).toHaveBeenCalledOnce();
      expect((await readUser(target.id))?.homeRegionId).toBe(regionA.id);
      expect(
        await db
          .select()
          .from(schema.rolesXUsersXOrg)
          .where(eq(schema.rolesXUsersXOrg.userId, target.id)),
      ).toEqual([]);
      expect(mockLogInfo).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects a stale correction after authorization without overwriting a competing move or changing roles", async () => {
    const target = await createUser({ homeRegionId: regionA.id });
    const competing = await createRegion();
    await mockAuthWithSession(adminOf(regionA));
    const transaction = db.transaction.bind(db);
    if (!globalThis.db) throw new Error("Database fixture was not initialized");
    const spy = vi
      .spyOn(globalThis.db, "transaction")
      .mockImplementationOnce(async (callback, config) => {
        await db
          .update(schema.users)
          .set({ homeRegionId: competing.id })
          .where(eq(schema.users.id, target.id));
        return transaction(callback, config);
      });
    try {
      await expect(
        createTestClient().user.crupdate({
          id: target.id,
          homeRegionId: regionB.id,
          roles: [{ orgId: regionA.id, roleName: "editor" }],
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(spy).toHaveBeenCalledOnce();
      expect((await readUser(target.id))?.homeRegionId).toBe(competing.id);
      expect(
        await db
          .select()
          .from(schema.rolesXUsersXOrg)
          .where(eq(schema.rolesXUsersXOrg.userId, target.id)),
      ).toEqual([]);
      expect(mockLogInfo).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it.each(["deleted", "moved-back"] as const)(
    "rejects a correction when the member was %s after authorization",
    async (change) => {
      const target = await createUser({ homeRegionId: regionA.id });
      onTestFinished(async () => {
        await cleanup.user(target.id);
      });
      await mockAuthWithSession(adminOf(regionA));
      const transaction = db.transaction.bind(db);
      if (!globalThis.db)
        throw new Error("Database fixture was not initialized");
      const spy = vi
        .spyOn(globalThis.db, "transaction")
        .mockImplementationOnce(async (callback, config) => {
          if (change === "deleted") {
            await db.delete(schema.users).where(eq(schema.users.id, target.id));
          } else {
            await db
              .update(schema.users)
              .set({ homeRegionId: regionB.id })
              .where(eq(schema.users.id, target.id));
            await db
              .update(schema.users)
              .set({ homeRegionId: regionA.id })
              .where(eq(schema.users.id, target.id));
          }
          return transaction(callback, config);
        });
      try {
        await expect(
          createTestClient().user.crupdate({
            id: target.id,
            email: target.email,
            homeRegionId: regionB.id,
            roles: [{ orgId: regionA.id, roleName: "editor" }],
          }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(spy).toHaveBeenCalledOnce();
        expect((await readUser(target.id))?.homeRegionId).toBe(
          change === "deleted" ? undefined : regionA.id,
        );
        expect(
          await db
            .select()
            .from(schema.rolesXUsersXOrg)
            .where(eq(schema.rolesXUsersXOrg.userId, target.id)),
        ).toEqual([]);
        expect(mockLogInfo).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    },
  );

  describe("PII from an admin of a role org outside the home region", () => {
    const setupPiiCase = async () => {
      const target = await createUser({
        homeRegionId: regionB.id,
        phone: "555-0100",
      });
      await grantRole(target.id, regionA.id, "editor");
      const session = editorOf(regionA);
      await mockAuthWithSession({
        ...session,
        roles: [
          {
            orgId: regionA.id,
            orgName: regionA.name,
            roleName: "admin" as const,
          },
        ],
      });
      return target;
    };

    it("rejects a PII change instead of dropping it", async () => {
      const target = await setupPiiCase();

      await expect(
        createTestClient().user.crupdate({
          id: target.id,
          phone: "555-0199",
          roles: [{ orgId: regionA.id, roleName: "editor" }],
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

      expect((await readUser(target.id))?.phone).toBe("555-0100");
    });

    it("accepts PII resent unchanged", async () => {
      const target = await setupPiiCase();

      await createTestClient().user.crupdate({
        id: target.id,
        email: target.email.toUpperCase(),
        phone: "",
        roles: [{ orgId: regionA.id, roleName: "editor" }],
      });

      const after = await readUser(target.id);
      expect(after?.email).toBe(target.email);
      expect(after?.phone).toBe("555-0100");
    });
  });

  it("rejects a nested meta change to a profile the caller can't edit", async () => {
    const target = await createUser({
      homeRegionId: regionB.id,
      meta: { settings: { sms: false } },
    });
    await mockAuthWithSession(editorOf(regionA));

    await expect(
      createTestClient().user.crupdate({
        id: target.id,
        meta: { settings: { sms: true } },
        roles: [],
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect((await readUser(target.id))?.meta).toEqual({
      settings: { sms: false },
    });
  });

  it("accepts nested meta resent unchanged in a different key order", async () => {
    const target = await createUser({
      homeRegionId: regionB.id,
      meta: { settings: { email: true, sms: false } },
    });
    await mockAuthWithSession(editorOf(regionA));

    await createTestClient().user.crupdate({
      id: target.id,
      meta: { settings: { sms: false, email: true } },
      roles: [],
    });

    expect((await readUser(target.id))?.meta).toEqual({
      settings: { email: true, sms: false },
    });
  });

  it("rejects a non-admin removing a role and writes nothing", async () => {
    const target = await createUser({ homeRegionId: regionA.id });
    await grantRole(target.id, regionA.id, "editor");
    await mockAuthWithSession(editorOf(regionA));

    await expect(
      createTestClient().user.crupdate({
        id: target.id,
        f3Name: "Renamed",
        roles: [],
      }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: ERRORS.MUST_BE_ADMIN_TO_REMOVE_ROLES,
    });

    const remaining = await db
      .select()
      .from(schema.rolesXUsersXOrg)
      .where(eq(schema.rolesXUsersXOrg.userId, target.id));
    expect(remaining).toHaveLength(1);
    expect((await readUser(target.id))?.f3Name).toBe("Original");
  });

  it("leaves the profile untouched when a role change is rejected", async () => {
    const target = await createUser({ homeRegionId: regionA.id });
    await mockAuthWithSession(editorOf(regionA));

    await expect(
      createTestClient().user.crupdate({
        id: target.id,
        f3Name: "Renamed",
        roles: [{ orgId: regionA.id, roleName: "admin" }],
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect((await readUser(target.id))?.f3Name).toBe("Original");
  });
});
