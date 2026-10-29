import type { Session } from "@acme/auth";
import type { UserRole } from "@acme/shared/app/enums";
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

import {
  createMixedOrgTree,
  db,
  getOrCreateRoles,
  uniqueId,
} from "./__tests__/test-utils";
import {
  checkHasRoleOnAllOrgs,
  checkHasRoleOnAnyOrg,
  checkHasRoleOnOrg,
  checkHasRolesOnOrgs,
} from "./check-has-role-on-org";
import type { RoleCheckOutcome } from "./check-has-role-on-org";
import * as loggerModule from "./logger";
import { ORG_TREE_MAX_DEPTH } from "./org-tree";

vi.mock("./logger", { spy: true });

const mockLogError = vi.mocked(loggerModule.logError);

/**
 * The batched role check must return exactly what the old one-org-at-a-time
 * check returned, while issuing at most one hierarchy query no matter how many
 * orgs are checked. The reference below is an independent, in-memory
 * re-statement of the per-org rule (self or any ancestor, within the depth
 * guard, no is_active filter; first matching session role wins), so the
 * comparison does not run the code under test against itself.
 */
describe("batched role checks", () => {
  const createdOrgIds: number[] = [];

  let orgs: Awaited<ReturnType<typeof createMixedOrgTree>>;
  let inactiveRegionId: number;
  let inactiveRegionAoId: number;
  let manyAoIds: number[];
  let allOrgIds: number[];
  let parentById: Map<number, number | null>;

  beforeAll(async () => {
    await getOrCreateRoles();
    orgs = await createMixedOrgTree(createdOrgIds);

    const [inactiveRegion] = await db
      .insert(schema.orgs)
      .values({
        name: `Batched ${uniqueId()} inactive region`,
        orgType: "region",
        parentId: orgs.directBranch.area.id,
        isActive: false,
      })
      .returning({ id: schema.orgs.id });
    if (!inactiveRegion) throw new Error("Failed to create inactive region");
    createdOrgIds.push(inactiveRegion.id);
    inactiveRegionId = inactiveRegion.id;

    const insertedAos = await db
      .insert(schema.orgs)
      .values(
        Array.from({ length: 21 }, (_, i) => ({
          name: `Batched ${uniqueId()} ao ${i}`,
          orgType: "ao" as const,
          // The first AO hangs off the inactive region; the rest off a live one.
          parentId: i === 0 ? inactiveRegionId : orgs.directBranch.region.id,
          isActive: true,
        })),
      )
      .returning({ id: schema.orgs.id });
    createdOrgIds.push(...insertedAos.map((ao) => ao.id));
    const [firstAo, ...restAos] = insertedAos;
    if (!firstAo) throw new Error("Failed to create AOs");
    inactiveRegionAoId = firstAo.id;
    manyAoIds = restAos.map((ao) => ao.id);

    allOrgIds = [
      orgs.nation.id,
      orgs.sector.id,
      orgs.territory.id,
      orgs.territoryBranch.area.id,
      orgs.territoryBranch.region.id,
      orgs.territoryBranch.ao.id,
      orgs.directBranch.area.id,
      orgs.directBranch.region.id,
      orgs.directBranch.ao.id,
      orgs.unrelatedSector.id,
      orgs.unrelatedBranch.area.id,
      orgs.unrelatedBranch.region.id,
      orgs.unrelatedBranch.ao.id,
      inactiveRegionId,
      inactiveRegionAoId,
      ...manyAoIds,
    ];

    const rows = await db
      .select({ id: schema.orgs.id, parentId: schema.orgs.parentId })
      .from(schema.orgs);
    parentById = new Map(rows.map((row) => [row.id, row.parentId]));
  });

  /** A db that counts the raw SQL statements (hierarchy queries) run through it. */
  const countingDb = () => {
    const counter = { executes: 0 };
    const counted = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "execute") {
          return (...args: unknown[]) => {
            counter.executes++;
            return (target.execute as (...a: unknown[]) => unknown)(...args);
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    return { db: counted, counter };
  };

  afterAll(async () => {
    if (createdOrgIds.length > 0) {
      await db
        .update(schema.orgs)
        .set({ parentId: null })
        .where(inArray(schema.orgs.id, createdOrgIds));
      await db
        .delete(schema.orgs)
        .where(inArray(schema.orgs.id, createdOrgIds));
    }
  });

  const makeSession = (
    userId: number,
    roles: { orgId: number; orgName: string; roleName: UserRole }[],
    apiKey = false,
  ): Session =>
    ({
      id: userId,
      email: `batched-${userId}@example.com`,
      user: {
        id: String(userId),
        email: `batched-${userId}@example.com`,
        name: "Batched Test User",
        roles,
      },
      roles,
      expires: new Date(Date.now() + 60_000).toISOString(),
      ...(apiKey ? { apiKey: { id: 1 } } : {}),
    }) as unknown as Session;

  /** Org itself plus ancestors within the depth guard, from the in-memory map. */
  const selfAndAncestors = (orgId: number): Set<number> => {
    const ids = new Set<number>();
    let current: number | null | undefined = orgId;
    for (
      let depth = 0;
      current != null && depth <= ORG_TREE_MAX_DEPTH && !ids.has(current);
      depth++
    ) {
      if (!parentById.has(current)) break;
      ids.add(current);
      current = parentById.get(current);
    }
    return ids;
  };

  const referenceCheck = (
    session: Session | null,
    orgId: number,
    roleName: UserRole,
  ): RoleCheckOutcome => {
    if (!session) {
      return {
        success: false,
        orgId: null,
        roleName: null,
        mode: "no-permission",
      };
    }
    const grants = (r: { roleName: UserRole }) =>
      r.roleName === "admin" || r.roleName === roleName;
    if (session.roles?.some((r) => grants(r) && r.orgId === orgId)) {
      return { success: true, orgId, roleName, mode: "direct-permission" };
    }
    const ancestors = selfAndAncestors(orgId);
    const match = session.roles?.find(
      (r) => grants(r) && ancestors.has(r.orgId),
    );
    return match
      ? {
          success: true,
          orgId: match.orgId,
          roleName: match.roleName,
          mode: "org-admin",
        }
      : { success: false, orgId, roleName, mode: "no-permission" };
  };

  const sessions = () => ({
    // Admin on the nation: inherits everything below it.
    nationAdmin: makeSession(9001, [
      { orgId: orgs.nation.id, orgName: "F3 Nation", roleName: "admin" },
    ]),
    nationEditor: makeSession(9002, [
      { orgId: orgs.nation.id, orgName: "F3 Nation", roleName: "editor" },
    ]),
    // Territory editor: reaches the territory branch only.
    territoryEditor: makeSession(9003, [
      {
        orgId: orgs.territory.id,
        orgName: "Territory",
        roleName: "editor",
      },
    ]),
    // Region admin that also holds a direct AO editor role elsewhere.
    regionAdminPlusAo: makeSession(9004, [
      {
        orgId: orgs.directBranch.region.id,
        orgName: "Region",
        roleName: "admin",
      },
      {
        orgId: orgs.unrelatedBranch.ao.id,
        orgName: "AO",
        roleName: "editor",
      },
    ]),
    // Role on the inactive region: inactive orgs are not filtered out.
    inactiveRegionEditor: makeSession(9005, [
      { orgId: inactiveRegionId, orgName: "Inactive", roleName: "editor" },
    ]),
    // A role on a descendant never grants anything on its ancestors.
    aoEditor: makeSession(9006, [
      {
        orgId: orgs.directBranch.ao.id,
        orgName: "AO",
        roleName: "editor",
      },
    ]),
    // API-key principal: the session carries the key's roles.
    apiKeyEditor: makeSession(
      9007,
      [
        {
          orgId: orgs.sector.id,
          orgName: "Sector",
          roleName: "editor",
        },
      ],
      true,
    ),
    noRoles: makeSession(9008, []),
    anonymous: null as Session | null,
  });

  it("returns exactly the per-org decision for every org, role and principal", async () => {
    const orgIdsWithEdges = [
      ...allOrgIds,
      2_147_483_647, // does not exist
      orgs.nation.id, // duplicate entries line up positionally
      manyAoIds[0]!,
    ];

    for (const [label, session] of Object.entries(sessions())) {
      for (const roleName of ["editor", "admin"] as const) {
        const checks = orgIdsWithEdges.map((orgId) => ({ orgId, roleName }));
        const batched = await checkHasRolesOnOrgs({ session, checks, db });
        const expected = checks.map((c) =>
          referenceCheck(session, c.orgId, c.roleName),
        );
        expect(batched, `${label} / ${roleName}`).toEqual(expected);

        // The single-org entry point is the same code path, so it must agree too.
        const single = await Promise.all(
          checks.map((c) =>
            checkHasRoleOnOrg({ session, orgId: c.orgId, db, roleName }),
          ),
        );
        expect(single, `${label} / ${roleName} (single)`).toEqual(expected);
      }
    }
  });

  it("handles mixed role names in one batch (api-key.create shape)", async () => {
    const session = sessions().regionAdminPlusAo;
    const checks = [
      { orgId: orgs.directBranch.ao.id, roleName: "admin" as const },
      { orgId: orgs.directBranch.ao.id, roleName: "editor" as const },
      { orgId: orgs.unrelatedBranch.ao.id, roleName: "admin" as const },
      { orgId: orgs.unrelatedBranch.ao.id, roleName: "editor" as const },
      { orgId: orgs.nation.id, roleName: "editor" as const },
    ];
    const batched = await checkHasRolesOnOrgs({ session, checks, db });
    expect(batched.map((r) => r.success)).toEqual([
      true,
      true,
      false,
      true,
      false,
    ]);
    expect(batched).toEqual(
      checks.map((c) => referenceCheck(session, c.orgId, c.roleName)),
    );
  });

  it("keeps inheritance rules: nation admin reaches all, ancestors are not reachable from below, inactive orgs still count", async () => {
    const s = sessions();
    const decide = async (
      session: Session | null,
      orgId: number,
      roleName: UserRole,
    ) =>
      (
        await checkHasRolesOnOrgs({
          session,
          checks: [{ orgId, roleName }],
          db,
        })
      )[0];

    expect(
      await decide(s.nationAdmin, orgs.unrelatedBranch.ao.id, "admin"),
    ).toMatchObject({
      success: true,
      orgId: orgs.nation.id,
      mode: "org-admin",
    });
    expect(
      await decide(s.aoEditor, orgs.directBranch.region.id, "editor"),
    ).toMatchObject({
      success: false,
      mode: "no-permission",
    });
    expect(
      await decide(s.inactiveRegionEditor, inactiveRegionAoId, "editor"),
    ).toMatchObject({
      success: true,
      orgId: inactiveRegionId,
      mode: "org-admin",
    });
    expect(
      await decide(s.apiKeyEditor, orgs.territoryBranch.ao.id, "editor"),
    ).toMatchObject({
      success: true,
      orgId: orgs.sector.id,
      mode: "org-admin",
    });
    expect(
      await decide(s.apiKeyEditor, orgs.unrelatedBranch.ao.id, "editor"),
    ).toMatchObject({
      success: false,
    });
    expect(await decide(s.anonymous, orgs.nation.id, "editor")).toEqual({
      success: false,
      orgId: null,
      roleName: null,
      mode: "no-permission",
    });
  });

  describe("depth guard", () => {
    /** A parent chain of `length` orgs, root first. */
    const createChain = async (length: number) => {
      const chain: number[] = [];
      let parentId: number | null = null;
      for (let i = 0; i < length; i++) {
        const inserted: { id: number }[] = await db
          .insert(schema.orgs)
          .values({
            name: `Batched ${uniqueId()} deep ${i}`,
            orgType: "region" as const,
            parentId,
            isActive: true,
          })
          .returning({ id: schema.orgs.id });
        const row = inserted[0];
        if (!row) throw new Error("Failed to create deep chain org");
        createdOrgIds.push(row.id);
        chain.push(row.id);
        parentId = row.id;
      }
      parentById = new Map(
        (
          await db
            .select({ id: schema.orgs.id, parentId: schema.orgs.parentId })
            .from(schema.orgs)
        ).map((row) => [row.id, row.parentId]),
      );
      return chain;
    };

    beforeEach(() => {
      mockLogError.mockClear();
    });

    it("grants from an ancestor at ORG_TREE_MAX_DEPTH and denies from one beyond it, like the single-org check and the reference", async () => {
      // ORG_TREE_MAX_DEPTH + 2 orgs = ORG_TREE_MAX_DEPTH + 1 parent edges.
      const chain = await createChain(ORG_TREE_MAX_DEPTH + 2);
      const leaf = chain[chain.length - 1]!;
      const atGuard = chain[1]!; // exactly ORG_TREE_MAX_DEPTH edges above the leaf
      const beyondGuard = chain[0]!; // one edge further

      const cases = [
        { ancestor: atGuard, expected: true },
        { ancestor: beyondGuard, expected: false },
      ];
      for (const { ancestor, expected } of cases) {
        const session = makeSession(9100, [
          { orgId: ancestor, orgName: "Deep", roleName: "editor" },
        ]);
        const [batched] = await checkHasRolesOnOrgs({
          session,
          checks: [{ orgId: leaf, roleName: "editor" }],
          db,
        });
        expect(batched?.success).toBe(expected);
        expect(batched).toEqual(referenceCheck(session, leaf, "editor"));
        expect(
          await checkHasRoleOnOrg({
            session,
            orgId: leaf,
            db,
            roleName: "editor",
          }),
        ).toEqual(batched);
      }
    });

    it("logs the depth-limit error once per org that hits the guard in a batch", async () => {
      const [chainA, chainB] = [
        await createChain(ORG_TREE_MAX_DEPTH + 2),
        await createChain(ORG_TREE_MAX_DEPTH + 2),
      ];
      const leafA = chainA[chainA.length - 1]!;
      const leafB = chainB[chainB.length - 1]!;

      await checkHasRolesOnOrgs({
        session: sessions().noRoles,
        checks: [
          { orgId: leafA, roleName: "editor" },
          { orgId: leafB, roleName: "editor" },
          { orgId: leafA, roleName: "admin" },
          { orgId: manyAoIds[0]!, roleName: "editor" },
        ],
        db,
      });

      const depthLogs = mockLogError.mock.calls.filter(
        ([event, fields]) =>
          event === "api.org_tree.depth_limit_reached" &&
          (fields as { source?: string } | undefined)?.source === "role_check",
      );
      expect(depthLogs).toHaveLength(2);
    });

    it("splits a list beyond the bind-parameter limit into chunks without changing any decision", async () => {
      // 65535 is Postgres' per-statement parameter cap; ids this large do not exist.
      const ghostIds = Array.from(
        { length: 70_000 },
        (_, i) => 2_000_000_000 + i,
      );
      const session = sessions().territoryEditor;
      const checks = [
        ...ghostIds.slice(0, 35_000),
        orgs.territoryBranch.ao.id,
        orgs.directBranch.ao.id,
        ...ghostIds.slice(35_000),
      ].map((orgId) => ({ orgId, roleName: "editor" as const }));

      const { db: counted, counter } = countingDb();
      const batched = await checkHasRolesOnOrgs({
        session,
        checks,
        db: counted,
      });

      expect(counter.executes).toBe(Math.ceil(checks.length / 10_000));
      expect(batched).toHaveLength(checks.length);
      expect(batched.filter((r) => r.success).map((r) => r.orgId)).toEqual([
        orgs.territory.id,
      ]);
      expect(batched[35_000]).toEqual(
        referenceCheck(session, orgs.territoryBranch.ao.id, "editor"),
      );
      expect(batched[35_001]?.success).toBe(false);
      expect(batched[0]?.success).toBe(false);
    });
  });

  describe("query count", () => {
    it("issues one hierarchy query regardless of how many orgs are checked", async () => {
      const session = sessions().nationEditor;
      expect(allOrgIds.length).toBeGreaterThan(20);

      for (const count of [1, 5, allOrgIds.length]) {
        const { db: counted, counter } = countingDb();
        await checkHasRolesOnOrgs({
          session,
          checks: allOrgIds
            .slice(-count)
            .map((orgId) => ({ orgId, roleName: "editor" as const })),
          db: counted,
        });
        expect(counter.executes, `${count} orgs`).toBe(1);
      }
    });

    it("issues no query when every check is satisfied by a direct role", async () => {
      const { db: counted, counter } = countingDb();
      const result = await checkHasRolesOnOrgs({
        session: sessions().regionAdminPlusAo,
        checks: [
          { orgId: orgs.directBranch.region.id, roleName: "editor" },
          { orgId: orgs.unrelatedBranch.ao.id, roleName: "editor" },
        ],
        db: counted,
      });
      expect(result.every((r) => r.mode === "direct-permission")).toBe(true);
      expect(counter.executes).toBe(0);
    });

    it("issues no query without a session", async () => {
      const { db: counted, counter } = countingDb();
      await checkHasRolesOnOrgs({
        session: null,
        checks: allOrgIds.map((orgId) => ({ orgId, roleName: "editor" })),
        db: counted,
      });
      expect(counter.executes).toBe(0);
    });

    it("any-of and all-of helpers also use a single query for many orgs", async () => {
      const session = sessions().territoryEditor;

      const any = countingDb();
      await checkHasRoleOnAnyOrg({
        session,
        orgIds: manyAoIds,
        db: any.db,
        roleName: "editor",
      });
      expect(any.counter.executes).toBe(1);

      const all = countingDb();
      await checkHasRoleOnAllOrgs({
        session,
        orgIds: manyAoIds,
        db: all.db,
        roleName: "editor",
      });
      expect(all.counter.executes).toBe(1);
    });

    it("any-of issues no query when a direct role covers one org and others are unresolved", async () => {
      const { db: counted, counter } = countingDb();
      const result = await checkHasRoleOnAnyOrg({
        session: sessions().regionAdminPlusAo,
        orgIds: [orgs.territoryBranch.ao.id, orgs.directBranch.region.id],
        db: counted,
        roleName: "editor",
      });
      expect(result).toBe(true);
      expect(counter.executes).toBe(0);
    });
  });

  describe("any-of / all-of helpers", () => {
    it("match the loop semantics they replace", async () => {
      const s = sessions();
      const args = (session: Session | null, orgIds: number[]) => ({
        session,
        orgIds,
        db,
        roleName: "editor" as const,
      });
      const { territoryBranch, directBranch, unrelatedBranch } = orgs;

      // any-of: one reachable org is enough; nothing reachable or empty is false.
      expect(
        await checkHasRoleOnAnyOrg(
          args(s.territoryEditor, [
            unrelatedBranch.ao.id,
            territoryBranch.ao.id,
          ]),
        ),
      ).toBe(true);
      expect(
        await checkHasRoleOnAnyOrg(
          args(s.territoryEditor, [unrelatedBranch.ao.id, directBranch.ao.id]),
        ),
      ).toBe(false);
      expect(await checkHasRoleOnAnyOrg(args(s.nationAdmin, []))).toBe(false);
      expect(
        await checkHasRoleOnAnyOrg(args(s.anonymous, [orgs.nation.id])),
      ).toBe(false);
      // duplicates are harmless
      expect(
        await checkHasRoleOnAnyOrg(
          args(s.territoryEditor, [
            territoryBranch.ao.id,
            territoryBranch.ao.id,
          ]),
        ),
      ).toBe(true);

      // all-of: every org must be reachable; a single miss denies; empty is vacuously true.
      expect(
        await checkHasRoleOnAllOrgs(
          args(s.nationEditor, [unrelatedBranch.ao.id, directBranch.ao.id]),
        ),
      ).toBe(true);
      expect(
        await checkHasRoleOnAllOrgs(
          args(s.territoryEditor, [territoryBranch.ao.id, directBranch.ao.id]),
        ),
      ).toBe(false);
      expect(await checkHasRoleOnAllOrgs(args(s.noRoles, []))).toBe(true);
      expect(await checkHasRoleOnAllOrgs(args(s.anonymous, []))).toBe(true);
      expect(
        await checkHasRoleOnAllOrgs(args(s.anonymous, [orgs.nation.id])),
      ).toBe(false);
    });
  });
});
