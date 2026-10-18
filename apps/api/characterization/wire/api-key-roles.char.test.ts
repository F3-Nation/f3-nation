import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  cleanup,
  createMixedOrgTree,
  db,
  getOrCreateRoles,
  uniqueId,
} from "@acme/api/testing";
import { eq, inArray, schema } from "@acme/db";
import { UserRole } from "@acme/shared/app/enums";

import { createApiKey } from "../fixtures/api-keys";
import type { FixtureApiKey } from "../fixtures/api-keys";
import { sessionCookie } from "../fixtures/cookies";
import { signFixtureJwt } from "../fixtures/jwt";
import { createFixtureUser } from "../fixtures/users";
import { rpcResponse } from "../rpc-client";
import { req, target } from "../transport";

interface ListedKey {
  id: number;
  ownerEmail: string | null;
  keySignature: string;
  roles: { orgId: number; orgName: string; roleName: UserRole }[];
  orgIds: number[];
  canManage: boolean;
}

const transports = ["REST", "RPC"] as const;
const readCases: { label: string; roles: readonly UserRole[] }[] = [
  { label: "no roles", roles: [] },
  ...UserRole.map((role) => ({ label: role, roles: [role] })),
  { label: "mixed roles", roles: UserRole },
];

describe.runIf(target.inProcess)("API-key role response contract", () => {
  const fixtureKeys: FixtureApiKey[] = [];
  const insertedRoleIds: number[] = [];
  const orgIds: number[] = [];
  const roleIds = new Map<UserRole, number>();
  let tree: Awaited<ReturnType<typeof createMixedOrgTree>>;
  let regionAdmin: Awaited<ReturnType<typeof createFixtureUser>>;
  let nationCookie: string;
  let regionToken: string;
  let inactiveOrgId: number;
  let requestNumber = 0;

  const makeKey = async (
    roles: { orgId: number; roleName: UserRole }[],
    ownerId?: number,
  ) => {
    const key = await createApiKey();
    fixtureKeys.push(key);
    await db
      .update(schema.apiKeys)
      .set({
        name: `Role contract ${uniqueId()}`,
        ...(ownerId === undefined ? {} : { ownerId }),
      })
      .where(eq(schema.apiKeys.id, key.apiKeyId));
    if (roles.length > 0) {
      await db.insert(schema.rolesXApiKeysXOrg).values(
        roles.map((role) => {
          const roleId = roleIds.get(role.roleName);
          if (roleId === undefined) throw new Error("Missing fixture role");
          return { apiKeyId: key.apiKeyId, orgId: role.orgId, roleId };
        }),
      );
    }
    return key;
  };

  const invokeList = async (
    transport: (typeof transports)[number],
    headers: Record<string, string>,
  ) => {
    const requestHeaders = {
      "x-forwarded-for": `10.99.0.${++requestNumber}`,
      ...headers,
    };
    return transport === "REST"
      ? target.invoke(req("/v1/api-key", { headers: requestHeaders }))
      : rpcResponse((client) => client.apiKey.list(), requestHeaders);
  };

  const readKeys = async (response: Response, transport: string) => {
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      apiKeys?: ListedKey[];
      json?: { apiKeys: ListedKey[] };
    };
    for (const fixture of fixtureKeys) {
      expect(JSON.stringify(body)).not.toContain(fixture.key);
    }
    return (transport === "REST" ? body.apiKeys : body.json?.apiKeys)!;
  };

  beforeAll(async () => {
    await getOrCreateRoles();
    for (const name of UserRole) {
      const [existing] = await db
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .where(eq(schema.roles.name, name));
      if (existing) {
        roleIds.set(name, existing.id);
      } else {
        const [role] = await db
          .insert(schema.roles)
          .values({ name })
          .returning({ id: schema.roles.id });
        if (!role) throw new Error("Failed to insert fixture role");
        insertedRoleIds.push(role.id);
        roleIds.set(name, role.id);
      }
    }
    tree = await createMixedOrgTree(orgIds);
    const [inactive] = await db
      .insert(schema.orgs)
      .values({
        name: `Inactive key-role org ${uniqueId()}`,
        orgType: "ao",
        parentId: tree.unrelatedBranch.region.id,
        isActive: false,
      })
      .returning({ id: schema.orgs.id });
    if (!inactive) throw new Error("Failed to insert inactive fixture org");
    inactiveOrgId = inactive.id;
    orgIds.push(inactiveOrgId);
    regionAdmin = await createFixtureUser({
      roles: [{ orgId: tree.directBranch.region.id, roleName: "admin" }],
    });
    nationCookie = await sessionCookie({
      roles: [
        { orgId: tree.nation.id, orgName: "F3 Nation", roleName: "admin" },
      ],
    });
    regionToken = await signFixtureJwt({ sub: regionAdmin.userId });
  });

  afterEach(async () => {
    const results = await Promise.allSettled(
      fixtureKeys.splice(0).map((fixture) => fixture.cleanup()),
    );
    // eslint-disable-next-line vitest/no-standalone-expect -- assert fixture cleanup in the hook
    expect(results.filter((result) => result.status === "rejected")).toEqual(
      [],
    );
  });

  afterAll(async () => {
    const results: PromiseSettledResult<unknown>[] = [];
    // Preserve dependency order, but attempt every cleanup even after a failure.
    for (const teardown of [
      () => regionAdmin.cleanup(),
      ...[...orgIds].reverse().map((id) => () => cleanup.org(id)),
      async () => {
        if (insertedRoleIds.length > 0) {
          await db
            .delete(schema.roles)
            .where(inArray(schema.roles.id, insertedRoleIds));
        }
      },
    ]) {
      results.push(
        ...(await Promise.allSettled([Promise.resolve().then(teardown)])),
      );
    }
    // eslint-disable-next-line vitest/no-standalone-expect -- assert fixture cleanup in the hook
    expect(results.filter((result) => result.status === "rejected")).toEqual(
      [],
    );
  });

  describe.each(transports)("%s", (transport) => {
    const invokeCreate = async (name: string, roleName: UserRole) => {
      const input = {
        name,
        roles: [{ orgId: tree.directBranch.ao.id, roleName }],
      };
      const headers = {
        cookie: nationCookie,
        "x-forwarded-for": `10.99.0.${++requestNumber}`,
      };
      return transport === "REST"
        ? target.invoke(
            req("/v1/api-key", {
              method: "POST",
              headers: { ...headers, "content-type": "application/json" },
              body: JSON.stringify(input),
            }),
          )
        : rpcResponse(
            // Probe deliberately invalid role values through the real codec.
            (client) => client.apiKey.create(input as never),
            headers,
          );
    };

    const createdKeys = (name: string) =>
      db
        .select({ id: schema.apiKeys.id })
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.name, name));

    const cleanupCreatedKeys = async (name: string) => {
      for (const key of await createdKeys(name)) await cleanup.apiKey(key.id);
    };

    it.each(readCases)(
      "lists $label faithfully without secrets",
      async ({ roles }) => {
        const key = await makeKey(
          roles.map((roleName) => ({
            orgId: tree.directBranch.ao.id,
            roleName,
          })),
        );
        const keys = await readKeys(
          await invokeList(transport, { cookie: nationCookie }),
          transport,
        );
        const listed = keys.find((row) => row.id === key.apiKeyId);
        expect(listed).toMatchObject({
          id: key.apiKeyId,
          canManage: true,
          keySignature: key.key.slice(-4),
        });
        expect(listed?.ownerEmail).toBeTruthy();
        expect(listed?.roles).toEqual(
          expect.arrayContaining(
            roles.map((roleName) => ({
              orgId: tree.directBranch.ao.id,
              orgName: tree.directBranch.ao.name,
              roleName,
            })),
          ),
        );
        expect(listed?.roles).toHaveLength(roles.length);
        expect(listed).not.toHaveProperty("key");
        expect(listed).not.toHaveProperty("secret");
      },
    );

    it("keeps scope checks on inactive and out-of-scope legal roles", async () => {
      const inScope = await makeKey([
        { orgId: tree.directBranch.ao.id, roleName: "user" },
      ]);
      const hidden = await makeKey([
        { orgId: tree.directBranch.ao.id, roleName: "editor" },
        { orgId: inactiveOrgId, roleName: "password_reader" },
      ]);
      const ownedWider = await makeKey(
        [
          { orgId: tree.directBranch.ao.id, roleName: "password_manager" },
          { orgId: inactiveOrgId, roleName: "user" },
        ],
        regionAdmin.userId,
      );
      const keys = await readKeys(
        await invokeList(transport, {
          authorization: `Bearer ${regionToken}`,
          client: transport === "REST" ? "characterization" : "orpc",
        }),
        transport,
      );
      expect(keys.map((row) => row.id)).not.toContain(hidden.apiKeyId);
      expect(keys.find((row) => row.id === inScope.apiKeyId)).toMatchObject({
        canManage: true,
        ownerEmail: null,
        roles: [{ orgId: tree.directBranch.ao.id, roleName: "user" }],
      });
      expect(keys.find((row) => row.id === ownedWider.apiKeyId)).toMatchObject({
        canManage: false,
        ownerEmail: null,
        roles: [
          { orgId: tree.directBranch.ao.id, roleName: "password_manager" },
        ],
        orgIds: [tree.directBranch.ao.id],
      });
    });

    it("continues rejecting API-key sessions, even with an admin role on the Nation organization", async () => {
      const key = await makeKey([{ orgId: tree.nation.id, roleName: "admin" }]);
      const response = await invokeList(transport, {
        authorization: `Bearer ${key.key}`,
        client: transport === "REST" ? "characterization" : "orpc",
      });
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain(key.key);
    });

    it.each(["user", "password_manager", "password_reader"] as const)(
      "does not allow granting %s when creating a key",
      async (roleName) => {
        const name = `Rejected role ${uniqueId()}`;
        try {
          const response = await invokeCreate(name, roleName);
          expect(response.status).toBe(400);
          expect(await createdKeys(name)).toEqual([]);
        } finally {
          await cleanupCreatedKeys(name);
        }
      },
    );

    it("allows granting editor with the same creation request", async () => {
      const name = `Allowed role ${uniqueId()}`;
      try {
        const response = await invokeCreate(name, "editor");
        expect(response.status).toBeGreaterThanOrEqual(200);
        expect(response.status).toBeLessThan(300);
        expect(await createdKeys(name)).toHaveLength(1);
      } finally {
        await cleanupCreatedKeys(name);
      }
    });
  });
});
