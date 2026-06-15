import { describe, expect, it, vi } from "vitest";

import type { Context } from "../shared";
import {
  assertEditorOnEventOrg,
  assertSelfOrEditorOnEventOrg,
} from "./attendance-auth";

vi.mock("../check-has-role-on-org", () => ({
  checkHasRoleOnOrg: vi.fn(),
}));

import { checkHasRoleOnOrg } from "../check-has-role-on-org";

const mockCheckHasRoleOnOrg = vi.mocked(checkHasRoleOnOrg);

const mockDb = {
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ orgId: 10 }]),
    }),
  }),
} as unknown as Context["db"];

const baseCtx = {
  session: null,
  db: mockDb,
} satisfies Context;

describe("assertSelfOrEditorOnEventOrg", () => {
  it("allows the session user when session.id is a numeric string", async () => {
    mockCheckHasRoleOnOrg.mockResolvedValue({
      success: false,
      orgId: null,
      roleName: null,
      mode: "no-permission",
    });

    await expect(
      assertSelfOrEditorOnEventOrg({
        ctx: {
          ...baseCtx,
          session: {
            id: "42" as unknown as number,
            email: "user@example.com",
            roles: [],
            user: {
              id: "42",
              email: "user@example.com",
              name: "Test User",
              roles: [],
            },
            expires: new Date().toISOString(),
          },
        },
        eventInstanceId: 1,
        targetUserId: 42,
      }),
    ).resolves.toEqual({ orgId: 10 });

    expect(mockCheckHasRoleOnOrg).not.toHaveBeenCalled();
  });

  it("requires editor role when acting on another user", async () => {
    mockCheckHasRoleOnOrg.mockResolvedValue({
      success: false,
      orgId: null,
      roleName: null,
      mode: "no-permission",
    });

    await expect(
      assertSelfOrEditorOnEventOrg({
        ctx: {
          ...baseCtx,
          session: {
            id: 1,
            email: "user@example.com",
            roles: [],
            user: {
              id: "1",
              email: "user@example.com",
              name: "Test User",
              roles: [],
            },
            expires: new Date().toISOString(),
          },
        },
        eventInstanceId: 1,
        targetUserId: 2,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("assertEditorOnEventOrg", () => {
  it("resolves with orgId when user has editor role", async () => {
    mockCheckHasRoleOnOrg.mockResolvedValue({
      success: true,
      orgId: 10,
      roleName: "editor",
      mode: "direct-permission",
    });

    await expect(
      assertEditorOnEventOrg({
        ctx: {
          ...baseCtx,
          session: {
            id: 1,
            email: "editor@example.com",
            roles: [],
            user: {
              id: "1",
              email: "editor@example.com",
              name: "Editor User",
              roles: [],
            },
            expires: new Date().toISOString(),
          },
        },
        eventInstanceId: 1,
      }),
    ).resolves.toEqual({ orgId: 10 });
  });

  it("throws UNAUTHORIZED when user lacks editor role", async () => {
    mockCheckHasRoleOnOrg.mockResolvedValue({
      success: false,
      orgId: null,
      roleName: null,
      mode: "no-permission",
    });

    await expect(
      assertEditorOnEventOrg({
        ctx: {
          ...baseCtx,
          session: {
            id: 1,
            email: "user@example.com",
            roles: [],
            user: {
              id: "1",
              email: "user@example.com",
              name: "Regular User",
              roles: [],
            },
            expires: new Date().toISOString(),
          },
        },
        eventInstanceId: 1,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
