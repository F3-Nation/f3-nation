import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// db mock — same chainable pattern as oauth.test.ts, so `jwt`'s DB-enrichment
// select can resolve to a queued row.
// ---------------------------------------------------------------------------

function chain<T>(result: T) {
  const obj: Record<string, unknown> = {};
  for (const method of ["from", "where", "limit"]) {
    obj[method] = vi.fn(() => obj);
  }
  obj.then = (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

const dbMock = {
  select: vi.fn(() => chain([])),
};

vi.mock("~/lib/db", () => ({ db: dbMock }));
vi.mock("~/lib/email-mfa", () => ({
  sendEmailCode: vi.fn(),
  verifyEmailCode: vi.fn(),
}));
vi.mock("~/lib/logging", () => ({ logError: vi.fn() }));
vi.mock("~/env", () => ({
  env: { AUTH_SECRET: "test-secret", NODE_ENV: "test" },
}));

const { authOptions } = await import("../../src/lib/auth-options");

describe("authOptions.callbacks.jwt — auth_time", () => {
  it("stamps authTime once, only when `user` is present (the actual sign-in call)", async () => {
    const token = await authOptions.callbacks!.jwt!({
      token: {},
      user: { id: "42", email: "pax@example.com", name: "PermVac" },
    } as never);

    expect(typeof token!.authTime).toBe("string");
    expect(Number.isNaN(new Date(token!.authTime!).getTime())).toBe(false);
  });

  it("preserves the original authTime on a later call with no `user` (session re-decode)", async () => {
    const originalAuthTime = "2025-01-01T00:00:00.000Z";

    const token = await authOptions.callbacks!.jwt!({
      token: { userId: 42, authTime: originalAuthTime },
      user: undefined,
    } as never);

    // Guards the assumption the OIDC auth_time feature is built on: without
    // `user`, this is a re-decode of an existing token, not a new sign-in —
    // if a future NextAuth version ever passed `user` again here (e.g. on a
    // `trigger: "update"` call), authTime would silently reset to "now" and
    // the auth_time claim would become meaningless with nothing to catch it.
    expect(token!.authTime).toBe(originalAuthTime);
  });
});

describe("authOptions.callbacks.session — auth_time", () => {
  it("passes token.authTime through to session.authTime verbatim", async () => {
    const authTime = "2025-06-15T12:00:00.000Z";

    const session = (await authOptions.callbacks!.session!({
      session: { user: {} },
      token: { userId: 42, authTime },
    } as never)) as { authTime: string };

    expect(session.authTime).toBe(authTime);
  });
});
