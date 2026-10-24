import type { JWT } from "next-auth/jwt";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OrgRole } from "@acme/shared/app/types";

// The jwt callback re-reads roles through the auth adapter. config.ts imports
// the adapter relatively; vitest resolves both specifiers to the same file, so
// this mock is what the callback sees.
const getUser = vi.fn();
vi.mock("@acme/auth/lib/md-pg-drizzzle-adapter", () => ({
  MDPGDrizzleAdapter: () => ({ getUser }),
}));

const EDITOR: OrgRole = { orgId: 42, orgName: "Anytown", roleName: "editor" };
const FORGED_ADMIN: OrgRole = {
  orgId: 1,
  orgName: "F3 Nation",
  roleName: "admin",
};

type JwtCallback = (params: {
  token: JWT;
  user?: unknown;
  trigger?: "signIn" | "signUp" | "update";
  session?: unknown;
}) => Promise<JWT | null>;

const loadJwtCallback = async (): Promise<JwtCallback> => {
  vi.resetModules();
  // @acme/env validates the full server env on import; config.ts pulls it in
  // through the db client.
  vi.stubEnv("SKIP_ENV_VALIDATION", "1");
  const { authConfig } = await import("@acme/auth/config");
  return authConfig.callbacks!.jwt as unknown as JwtCallback;
};

const token = (overrides: Partial<JWT> = {}): JWT =>
  ({
    id: 7,
    email: "pax@example.com",
    name: "Pax",
    roles: [EDITOR],
    rolesVersion: 1,
    ...overrides,
  }) as JWT;

describe("jwt callback on trigger=update", () => {
  beforeEach(() => {
    getUser.mockReset();
  });

  it("ignores roles in the client-supplied session payload", async () => {
    getUser.mockResolvedValue({ id: 7, roles: [EDITOR] });
    const jwt = await loadJwtCallback();

    const result = await jwt({
      token: token(),
      trigger: "update",
      session: { roles: [FORGED_ADMIN] },
    });

    expect(result?.roles).toEqual([EDITOR]);
    expect(getUser).toHaveBeenCalledWith(7);
  });

  it("refreshes roles from the database for the token's own user", async () => {
    getUser.mockResolvedValue({ id: 7, roles: [EDITOR, FORGED_ADMIN] });
    const jwt = await loadJwtCallback();

    const result = await jwt({
      token: token({ roles: [] }),
      trigger: "update",
    });

    expect(result?.roles).toEqual([EDITOR, FORGED_ADMIN]);
    expect(getUser).toHaveBeenCalledWith(7);
  });

  it("looks up a string token id as a number", async () => {
    getUser.mockResolvedValue({ id: 7, roles: [EDITOR] });
    const jwt = await loadJwtCallback();

    await jwt({ token: token({ id: "7" }), trigger: "update" });

    expect(getUser).toHaveBeenCalledWith(7);
  });

  it("signs out when the user no longer exists", async () => {
    getUser.mockResolvedValue(null);
    const jwt = await loadJwtCallback();

    const result = await jwt({
      token: token(),
      trigger: "update",
      session: { roles: [FORGED_ADMIN] },
    });

    expect(result).toBeNull();
  });

  it("signs out without a lookup when the token has no usable id", async () => {
    const jwt = await loadJwtCallback();

    const result = await jwt({
      token: token({ id: undefined }),
      trigger: "update",
      session: { roles: [FORGED_ADMIN] },
    });

    expect(result).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  it.each(["not-a-number", "7.5", ""])(
    "signs out without a lookup when the token id is %j",
    async (id) => {
      const jwt = await loadJwtCallback();

      const result = await jwt({
        token: token({ id }),
        trigger: "update",
        session: { roles: [FORGED_ADMIN] },
      });

      expect(result).toBeNull();
      expect(getUser).not.toHaveBeenCalled();
    },
  );

  // Fail closed: the callback must reject rather than keep the old roles.
  // @auth/core's session action catches the rejection and clears the session
  // cookie (lib/actions/session.js, `sessionStore.clean()`); that part is
  // @auth/core's behavior and is not re-tested here.
  it("rejects, keeping nothing, when the database lookup fails", async () => {
    getUser.mockRejectedValue(new Error("db outage"));
    const jwt = await loadJwtCallback();

    await expect(
      jwt({
        token: token(),
        trigger: "update",
        session: { roles: [FORGED_ADMIN] },
      }),
    ).rejects.toThrow("db outage");
  });

  it("leaves roles alone on a plain session read", async () => {
    const jwt = await loadJwtCallback();

    const result = await jwt({ token: token() });

    expect(result?.roles).toEqual([EDITOR]);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("stamps the roles marker on sign-in", async () => {
    const jwt = await loadJwtCallback();

    const result = await jwt({
      token: token({ rolesVersion: undefined }),
      user: { id: 7, email: "pax@example.com", name: "Pax", roles: [EDITOR] },
      trigger: "signIn",
    });

    expect(result?.rolesVersion).toBe(1);
    expect(result?.roles).toEqual([EDITOR]);
  });
});

// Tokens minted before the fix carry no marker and may hold forged roles.
describe("jwt callback on a pre-marker token", () => {
  beforeEach(() => {
    getUser.mockReset();
  });

  it("replaces embedded roles with the database's on a plain read", async () => {
    getUser.mockResolvedValue({ id: 7, roles: [EDITOR] });
    const jwt = await loadJwtCallback();

    const result = await jwt({
      token: token({ roles: [FORGED_ADMIN], rolesVersion: undefined }),
    });

    expect(getUser).toHaveBeenCalledWith(7);
    expect(result?.roles).toEqual([EDITOR]);
    expect(result?.rolesVersion).toBe(1);
  });

  it("signs out on a plain read when the user no longer exists", async () => {
    getUser.mockResolvedValue(null);
    const jwt = await loadJwtCallback();

    const result = await jwt({
      token: token({ roles: [FORGED_ADMIN], rolesVersion: undefined }),
    });

    expect(result).toBeNull();
  });
});
