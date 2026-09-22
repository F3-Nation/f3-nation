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
const { sendEmailCode, verifyEmailCode } = await import("~/lib/email-mfa");
const { logError } = await import("~/lib/logging");

// The CredentialsProvider factory stores the config object callers pass in
// (including the real `authorize`) under `.options`, and stubs the top-level
// `authorize` to `() => null` — NextAuth's own internal init merges `.options`
// over the top-level defaults before handling a request (see the "Provider
// with id \"credentials\" not found" bug this was written to catch: the
// *effective* id is `options.id`, not the stub's `"credentials"`). Tests must
// call the same nested function NextAuth actually invokes.
const credentialsProvider = authOptions.providers[0] as unknown as {
  options: {
    authorize: (credentials: Record<string, unknown>) => Promise<unknown>;
  };
};
const authorize = credentialsProvider.options.authorize;

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

describe("email-mfa CredentialsProvider.authorize", () => {
  it("returns null without attempting anything when email is missing", async () => {
    const result = await authorize({});

    expect(result).toBeNull();
    expect(sendEmailCode).not.toHaveBeenCalled();
    expect(verifyEmailCode).not.toHaveBeenCalled();
  });

  it('sends a code and returns null when action is "send"', async () => {
    vi.mocked(sendEmailCode).mockResolvedValueOnce(undefined);

    const result = await authorize({
      email: "PAX@Example.com",
      action: "send",
    });

    // Normalized (lowercased/trimmed) before being handed to sendEmailCode
    expect(sendEmailCode).toHaveBeenCalledWith("pax@example.com");
    expect(result).toBeNull();
  });

  it("sends a code and returns null when no code is provided", async () => {
    vi.mocked(sendEmailCode).mockResolvedValueOnce(undefined);

    const result = await authorize({ email: "pax@example.com" });

    expect(sendEmailCode).toHaveBeenCalledWith("pax@example.com");
    expect(result).toBeNull();
  });

  it("logs and rethrows a generic error when sending the code fails", async () => {
    const dbError = new Error("connection reset");
    vi.mocked(sendEmailCode).mockRejectedValueOnce(dbError);

    await expect(
      authorize({ email: "pax@example.com", action: "send" }),
    ).rejects.toThrow("Failed to send verification code. Please try again.");

    expect(logError).toHaveBeenCalledWith(
      "auth.authorize.send_code_failed",
      {},
      dbError,
    );
  });

  it("returns null when the code fails to verify", async () => {
    vi.mocked(verifyEmailCode).mockResolvedValueOnce(null);

    const result = await authorize({
      email: "pax@example.com",
      code: "000000",
    });

    expect(verifyEmailCode).toHaveBeenCalledWith("pax@example.com", "000000");
    expect(result).toBeNull();
  });

  it("returns the mapped user when the code verifies", async () => {
    vi.mocked(verifyEmailCode).mockResolvedValueOnce({
      id: 42,
      email: "pax@example.com",
      f3Name: "PermVac",
    });

    const result = await authorize({
      email: "pax@example.com",
      code: "123456",
    });

    expect(result).toEqual({
      id: "42",
      email: "pax@example.com",
      name: "PermVac",
      roles: [],
    });
  });

  it("logs and rethrows a generic error when code verification throws", async () => {
    const dbError = new Error("connection reset");
    vi.mocked(verifyEmailCode).mockRejectedValueOnce(dbError);

    await expect(
      authorize({ email: "pax@example.com", code: "123456" }),
    ).rejects.toThrow("Failed to verify code. Please try again.");

    expect(logError).toHaveBeenCalledWith(
      "auth.authorize.verify_code_failed",
      {},
      dbError,
    );
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
