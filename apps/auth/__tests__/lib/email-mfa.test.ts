import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { createTransport: vi.fn(() => ({ sendMail })), sendMail };
});

vi.mock("nodemailer", () => ({ createTransport }));

interface TestMailOptions {
  from?: string;
  to?: string;
  subject?: string;
  html?: string;
  headers?: Record<string, string>;
}

// Mock db chain
function chain<T>(result: T) {
  const obj: Record<string, unknown> = {};
  for (const method of ["from", "where", "limit", "set", "values"]) {
    obj[method] = vi.fn(() => obj);
  }
  obj.then = (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

const dbMock = {
  update: vi.fn(() => chain([])),
  insert: vi.fn(() => chain([])),
  select: vi.fn(() => chain([])),
};

vi.mock("~/lib/db", () => ({ db: dbMock }));
vi.mock("~/lib/logging", () => ({ logWarn: vi.fn(), logError: vi.fn() }));
vi.mock("~/env", () => ({
  env: {
    EMAIL_SERVER: "smtp://localhost:1025",
    EMAIL_FROM: "noreply@f3nation.com",
    NEXT_PUBLIC_AUTH_URL: "https://auth.f3nation.com",
    NODE_ENV: "test",
  },
}));

const { sendEmailCode, verifyEmailCode } =
  await import("../../src/lib/email-mfa");

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

describe("sendEmailCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMail.mockResolvedValue({ messageId: "test-msg-id" });
  });

  it("sends email with SendGrid clicktrack and opentrack disabled via X-SMTPAPI header", async () => {
    await sendEmailCode("User@Example.COM  ");

    expect(dbMock.update).toHaveBeenCalled();
    expect(dbMock.insert).toHaveBeenCalled();
    expect(sendMail).toHaveBeenCalledTimes(1);

    const callArgs = (sendMail.mock.calls[0]?.[0] ?? {}) as TestMailOptions;
    expect(callArgs.from).toBe("noreply@f3nation.com");
    expect(callArgs.to).toBe("user@example.com");
    expect(callArgs.subject).toBe("Your F3 Nation sign-in code");
    expect(callArgs.html).toContain("Your verification code");
    expect(callArgs.html).toContain(
      "https://auth.f3nation.com/login/email/verify?email=user%40example.com&code=",
    );

    // Verify SendGrid tracking disable headers
    expect(callArgs.headers).toBeDefined();
    expect(callArgs.headers?.["X-SMTPAPI"]).toBeDefined();
    const smtpApi = JSON.parse(callArgs.headers?.["X-SMTPAPI"] ?? "{}") as {
      filters: {
        clicktrack: { settings: { enable: number } };
        opentrack: { settings: { enable: number } };
      };
    };
    expect(smtpApi).toEqual({
      filters: {
        clicktrack: { settings: { enable: 0 } },
        opentrack: { settings: { enable: 0 } },
      },
    });
  });

  it("embeds callbackUrl in magic link when callbackUrl is valid same-origin", async () => {
    await sendEmailCode(
      "user@example.com",
      "https://auth.f3nation.com/oauth/authorize?foo=bar",
    );

    expect(sendMail).toHaveBeenCalledTimes(1);
    const callArgs = (sendMail.mock.calls[0]?.[0] ?? {}) as TestMailOptions;
    expect(callArgs.html).toContain(
      "callbackUrl=https%3A%2F%2Fauth.f3nation.com%2Foauth%2Fauthorize%3Ffoo%3Dbar",
    );
  });

  it("logs warning and omits callbackUrl when invalid external URL is passed", async () => {
    const { logWarn } = await import("~/lib/logging");
    await sendEmailCode("user@example.com", "https://evil.com/phishing");

    expect(logWarn).toHaveBeenCalledWith(
      "auth.email_mfa.invalid_callback_url",
      { callbackUrl: "https://evil.com/phishing" },
    );
    const callArgs = (sendMail.mock.calls[0]?.[0] ?? {}) as TestMailOptions;
    expect(callArgs.html).not.toContain("callbackUrl=");
  });
});

describe("verifyEmailCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null if no active MFA code is found", async () => {
    dbMock.select.mockReturnValueOnce(chain([]));

    const result = await verifyEmailCode("user@example.com", "123456");
    expect(result).toBeNull();
  });

  it("returns null if attempt count has reached max attempts", async () => {
    dbMock.select.mockReturnValueOnce(
      chain([
        {
          id: "code-1",
          email: "user@example.com",
          codeHash: hashCode("123456"),
          attemptCount: 5,
        },
      ]),
    );

    const result = await verifyEmailCode("user@example.com", "123456");
    expect(result).toBeNull();
  });

  it("increments attemptCount and returns null if code does not match", async () => {
    dbMock.select.mockReturnValueOnce(
      chain([
        {
          id: "code-1",
          email: "user@example.com",
          codeHash: hashCode("123456"),
          attemptCount: 1,
        },
      ]),
    );

    const result = await verifyEmailCode("user@example.com", "999999");
    expect(result).toBeNull();
    expect(dbMock.update).toHaveBeenCalled();
  });

  it("marks code as consumed and returns user if code matches existing user", async () => {
    const code = "654321";
    dbMock.select
      .mockReturnValueOnce(
        chain([
          {
            id: "code-1",
            email: "user@example.com",
            codeHash: hashCode(code),
            attemptCount: 0,
          },
        ]),
      )
      .mockReturnValueOnce(
        chain([
          {
            id: 42,
            email: "user@example.com",
            emailVerified: null,
            f3Name: "Ocho",
          },
        ]),
      );

    const result = await verifyEmailCode("User@Example.com", code);
    expect(result).toEqual({
      id: 42,
      email: "user@example.com",
      emailVerified: null,
      f3Name: "Ocho",
    });
    // Should update code as consumed and mark emailVerified
    expect(dbMock.update).toHaveBeenCalledTimes(2);
  });

  it("returns null when code matches but user does not exist in users table", async () => {
    const code = "654321";
    dbMock.select
      .mockReturnValueOnce(
        chain([
          {
            id: "code-1",
            email: "newuser@example.com",
            codeHash: hashCode(code),
            attemptCount: 0,
          },
        ]),
      )
      .mockReturnValueOnce(chain([]));

    const result = await verifyEmailCode("newuser@example.com", code);
    expect(result).toBeNull();
  });
});
