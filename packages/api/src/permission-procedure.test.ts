import { vi } from "vitest";

const mockLimit = vi.hoisted(() => vi.fn());

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mockLimit };
  }),
}));

import type { Session } from "@acme/auth";
import type { UserRole } from "@acme/shared/app/enums";
import { Permission } from "@acme/shared/app/permissions";
import { Client, Header } from "@acme/shared/common/enums";
import { createRouterClient } from "@orpc/server";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getOrCreateF3NationOrg,
  mockAuthWithSession,
} from "./__tests__/test-utils";
import { permissionProcedure } from "./shared";

const sessionWithRole = (orgId: number, roleName: UserRole): Session => {
  const roles = [{ orgId, orgName: `org ${orgId}`, roleName }];
  return {
    id: 6262,
    email: "procedure@example.com",
    user: { id: "6262", email: "procedure@example.com", name: "P", roles },
    roles,
    expires: new Date(Date.now() + 60_000).toISOString(),
  };
};

const client = () =>
  createRouterClient(
    {
      // Skips the org check, to show what the gate alone allows.
      gateOnly: permissionProcedure(
        Permission.EntitiesManage,
        Permission.MessagesSend,
      ).handler(() => "ran"),
      onOrg: permissionProcedure(Permission.MessagesSend).handler(
        async ({ context }) => {
          const nation = await getOrCreateF3NationOrg();
          await context.assertPermissionsOnOrg(nation.id);
          return "ran";
        },
      ),
    },
    {
      context: () => ({
        reqHeaders: new Headers({ [Header.Client]: Client.ORPC }),
      }),
    },
  );

describe("permissionProcedure", () => {
  beforeEach(() => {
    mockLimit.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60000,
    });
  });

  it("stops a caller who lacks one of the permissions on every org", async () => {
    // A role with one of the two permissions but not the other.
    await mockAuthWithSession(sessionWithRole(999_999, "editor"));
    await expect(client().gateOnly()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("stops a caller with no session", async () => {
    await mockAuthWithSession(null);
    await expect(client().gateOnly()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("lets a caller with each permission somewhere reach the handler", async () => {
    await mockAuthWithSession(sessionWithRole(999_999, "admin"));
    await expect(client().gateOnly()).resolves.toBe("ran");
  });

  it("gives the handler an org check for the same permissions", async () => {
    const nation = await getOrCreateF3NationOrg();
    await mockAuthWithSession(sessionWithRole(nation.id, "admin"));
    await expect(client().onOrg()).resolves.toBe("ran");

    // Admin on an org that isn't the nation or above it.
    await mockAuthWithSession(sessionWithRole(999_999, "admin"));
    await expect(client().onOrg()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "This action needs these permissions on the org: Send messages",
    });
  });
});
