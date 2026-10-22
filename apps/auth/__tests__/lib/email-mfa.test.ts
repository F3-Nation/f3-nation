import crypto from "node:crypto";

import type { SQL } from "drizzle-orm";
import type { Mock } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { and, eq, gt, isNull, lt } from "@acme/db";
import { emailMfaCodes, users } from "@acme/db/schema/schema";

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
function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  for (const method of [
    "from",
    "where",
    "limit",
    "set",
    "values",
    "returning",
  ]) {
    obj[method] = vi.fn(() => obj);
  }
  obj.then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return obj;
}

// update() resolves to one row by default, so findMatchingCode's attempt
// claim succeeds unless a test says otherwise.
const dbMock = {
  update: vi.fn<(table: unknown) => ReturnType<typeof chain>>(() =>
    chain([{ id: "code-1" }]),
  ),
  insert: vi.fn(() => chain([])),
  select: vi.fn(() => chain([])),
};

vi.mock("~/lib/db", () => ({ db: dbMock }));
vi.mock("~/lib/logging", () => ({ logWarn: vi.fn(), logError: vi.fn() }));
vi.mock("~/env", () => ({
  env: {
    EMAIL_SERVER: "smtp://localhost:1025",
    EMAIL_FROM: "noreply@example.com",
    NEXT_PUBLIC_AUTH_URL: "https://auth.f3nation.com",
    NODE_ENV: "test",
  },
}));

const {
  checkEmailCode,
  claimEmailCode,
  recordEmailCode,
  sendEmailCode,
  verifyEmailCode,
} = await import("../../src/lib/email-mfa");

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

const NOW = "2026-09-25T00:00:00.000Z";

const toQuery = (s: SQL | undefined) => new PgDialect().sqlToQuery(s!);

interface ChainMock {
  set: Mock;
  where: Mock;
  values: Mock;
}

function updateChain(index: number) {
  return dbMock.update.mock.results[index]?.value as ChainMock;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sendEmailCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMail.mockResolvedValue({ messageId: "test-msg-id" });
  });

  it("sends email with SendGrid clicktrack and opentrack disabled via X-SMTPAPI header", async () => {
    await sendEmailCode("User@Example.COM  ");

    expect(sendMail).toHaveBeenCalledTimes(1);

    const callArgs = (sendMail.mock.calls[0]?.[0] ?? {}) as TestMailOptions;
    const code = /code=(\d{6})/.exec(callArgs.html ?? "")?.[1];
    expect(code).toBeDefined();

    expect(updateChain(0).set).toHaveBeenCalledWith({ consumedAt: NOW });
    const insertChain = dbMock.insert.mock.results[0]?.value as ChainMock;
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "user@example.com",
        codeHash: hashCode(code ?? ""),
        attemptCount: 0,
        expiresAt: "2026-09-25T00:10:00.000Z",
      }),
    );

    expect(callArgs.from).toBe("noreply@example.com");
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

  it("logs only origin + path of a rejected external callbackUrl and omits it from the link", async () => {
    const { logWarn } = await import("~/lib/logging");
    await sendEmailCode(
      "user@example.com",
      "https://evil.com/phishing?token=secret#frag",
    );

    expect(logWarn).toHaveBeenCalledWith(
      "auth.email_mfa.invalid_callback_url",
      { callbackUrl: "https://evil.com/phishing" },
    );
    const callArgs = (sendMail.mock.calls[0]?.[0] ?? {}) as TestMailOptions;
    expect(callArgs.html).not.toContain("callbackUrl=");
  });

  it("logs 'unparseable' when the rejected callbackUrl is not a valid URL", async () => {
    const { logWarn } = await import("~/lib/logging");
    await sendEmailCode("user@example.com", "https://[bad");

    expect(logWarn).toHaveBeenCalledWith(
      "auth.email_mfa.invalid_callback_url",
      { callbackUrl: "unparseable" },
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
    const selectChain = chain([]);
    dbMock.select.mockReturnValueOnce(selectChain);

    const result = await verifyEmailCode("User@Example.com", "123456");
    expect(result).toBeNull();
    expect(
      toQuery((selectChain.where as Mock).mock.calls[0]?.[0] as SQL),
    ).toEqual(
      toQuery(
        and(
          eq(emailMfaCodes.email, "user@example.com"),
          isNull(emailMfaCodes.consumedAt),
          gt(emailMfaCodes.expiresAt, NOW),
        ),
      ),
    );
  });

  it("normalizes surrounding whitespace in the email like the Better Auth path does", async () => {
    const code = "654321";
    const codeSelect = chain([
      {
        id: "code-1",
        email: "user@example.com",
        codeHash: hashCode(code),
        attemptCount: 0,
      },
    ]);
    const userSelect = chain([
      { id: 42, email: "user@example.com", emailVerified: NOW, f3Name: "Ocho" },
    ]);
    dbMock.select
      .mockReturnValueOnce(codeSelect)
      .mockReturnValueOnce(userSelect);

    await verifyEmailCode("  User@Example.com ", code);

    expect(
      toQuery((codeSelect.where as Mock).mock.calls[0]?.[0] as SQL),
    ).toEqual(
      toQuery(
        and(
          eq(emailMfaCodes.email, "user@example.com"),
          isNull(emailMfaCodes.consumedAt),
          gt(emailMfaCodes.expiresAt, NOW),
        ),
      ),
    );
    expect(
      toQuery((userSelect.where as Mock).mock.calls[0]?.[0] as SQL),
    ).toEqual(toQuery(eq(users.email, "user@example.com")));
  });

  it("returns null without comparing when no attempt is left to claim", async () => {
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
    dbMock.update.mockReturnValueOnce(chain([]));

    const result = await verifyEmailCode("user@example.com", "123456");
    expect(result).toBeNull();
    // Only the failed claim; the right code is never consumed.
    expect(dbMock.update).toHaveBeenCalledTimes(1);
    expect(toQuery(updateChain(0).where.mock.calls[0]?.[0] as SQL)).toEqual(
      toQuery(
        and(eq(emailMfaCodes.id, "code-1"), lt(emailMfaCodes.attemptCount, 5)),
      ),
    );
  });

  it("claims one attempt and returns null if code does not match", async () => {
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
    expect(dbMock.update).toHaveBeenCalledTimes(1);
    const updateChain = dbMock.update.mock.results[0]?.value as {
      set: ReturnType<typeof vi.fn>;
    };
    const setArg = updateChain.set.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(setArg)).toEqual(["attemptCount"]);
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
    expect(dbMock.update).toHaveBeenCalledTimes(3);
    expect(
      Object.keys(updateChain(0).set.mock.calls[0]?.[0] as object),
    ).toEqual(["attemptCount"]);

    // One update gives the attempt back and marks the code consumed.
    const consume = updateChain(1);
    expect(dbMock.update.mock.calls[1]?.[0]).toBe(emailMfaCodes);
    expect(consume.set).toHaveBeenCalledWith(
      expect.objectContaining({ consumedAt: NOW }),
    );
    expect(toQuery(consume.where.mock.calls[0]?.[0] as SQL)).toEqual(
      toQuery(
        and(eq(emailMfaCodes.id, "code-1"), isNull(emailMfaCodes.consumedAt)),
      ),
    );

    const verify = updateChain(2);
    expect(dbMock.update.mock.calls[2]?.[0]).toBe(users);
    expect(verify.set).toHaveBeenCalledWith({ emailVerified: NOW });
    expect(toQuery(verify.where.mock.calls[0]?.[0] as SQL)).toEqual(
      toQuery(eq(users.id, 42)),
    );
  });

  it("does not re-mark emailVerified when the user is already verified", async () => {
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
            emailVerified: "2026-01-01T00:00:00.000Z",
            f3Name: "Ocho",
          },
        ]),
      );

    const result = await verifyEmailCode("user@example.com", code);
    expect(result).toMatchObject({ id: 42 });
    // The attempt claim and the code-consumed update; no emailVerified write
    expect(dbMock.update).toHaveBeenCalledTimes(2);
    expect(updateChain(1).set).toHaveBeenCalledWith(
      expect.objectContaining({ consumedAt: NOW }),
    );
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

describe("recordEmailCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores a hash of an externally generated code without sending mail", async () => {
    await recordEmailCode(" User@Example.COM", "246810");

    expect(updateChain(0).set).toHaveBeenCalledWith({ consumedAt: NOW });
    const insertChain = dbMock.insert.mock.results[0]?.value as ChainMock;
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "user@example.com",
        codeHash: hashCode("246810"),
        attemptCount: 0,
      }),
    );
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("checkEmailCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const activeCode = (attemptCount = 0) =>
    chain([
      {
        id: "code-1",
        email: "user@example.com",
        codeHash: hashCode("123456"),
        attemptCount,
      },
    ]);

  it("accepts a matching code, giving its attempt back without consuming it", async () => {
    dbMock.select.mockReturnValueOnce(activeCode());

    expect(await checkEmailCode("user@example.com", "123456")).toBe(true);
    // The attempt claim, then the refund; nothing marks the code consumed.
    expect(dbMock.update).toHaveBeenCalledTimes(2);
    const [claim, refund] = [0, 1].map(
      (i) => updateChain(i).set.mock.calls[0]?.[0] as { attemptCount: SQL },
    );
    expect(toQuery(claim?.attemptCount).sql).toContain("+ 1");
    expect(Object.keys(refund ?? {})).toEqual(["attemptCount"]);
    expect(toQuery(refund?.attemptCount).sql).toContain("- 1");
    // Only this code's row, and whether or not it was used.
    expect(toQuery(updateChain(1).where.mock.calls[0]?.[0] as SQL)).toEqual(
      toQuery(eq(emailMfaCodes.id, "code-1")),
    );
  });

  it("looks the code up under the trimmed, lowercased email it was stored under", async () => {
    const selectChain = activeCode();
    dbMock.select.mockReturnValueOnce(selectChain);

    expect(await checkEmailCode("  User@Example.com ", "123456")).toBe(true);
    expect(
      toQuery((selectChain.where as Mock).mock.calls[0]?.[0] as SQL),
    ).toEqual(
      toQuery(
        and(
          eq(emailMfaCodes.email, "user@example.com"),
          isNull(emailMfaCodes.consumedAt),
          gt(emailMfaCodes.expiresAt, NOW),
        ),
      ),
    );
  });

  it("counts a wrong code toward the lockout", async () => {
    dbMock.select.mockReturnValueOnce(activeCode(1));

    expect(await checkEmailCode("user@example.com", "999999")).toBe(false);
    expect(updateChain(0).set).toHaveBeenCalledTimes(1);
  });

  it("rejects even the right code once no attempt can be claimed", async () => {
    dbMock.select.mockReturnValueOnce(activeCode(5));
    dbMock.update.mockReturnValueOnce(chain([]));

    expect(await checkEmailCode("user@example.com", "123456")).toBe(false);
  });

  it("rejects when there is no active code", async () => {
    dbMock.select.mockReturnValueOnce(chain([]));

    expect(await checkEmailCode("user@example.com", "123456")).toBe(false);
    expect(dbMock.update).not.toHaveBeenCalled();
  });
});

describe("claimEmailCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const activeCode = () =>
    chain([
      {
        id: "code-1",
        email: "user@example.com",
        codeHash: hashCode("123456"),
        attemptCount: 0,
      },
    ]);

  it("uses a verified code up without spending an attempt", async () => {
    dbMock.select.mockReturnValueOnce(activeCode());

    expect(
      await claimEmailCode("user@example.com", "123456", { consume: true }),
    ).toBe(true);
    expect(dbMock.update).toHaveBeenCalledTimes(1);
    expect(updateChain(0).set).toHaveBeenCalledWith({ consumedAt: NOW });
    expect(toQuery(updateChain(0).where.mock.calls[0]?.[0] as SQL)).toEqual(
      toQuery(
        and(eq(emailMfaCodes.id, "code-1"), isNull(emailMfaCodes.consumedAt)),
      ),
    );
  });

  it("uses a code up even when a parallel check has filled the budget", async () => {
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

    expect(
      await claimEmailCode("user@example.com", "123456", { consume: true }),
    ).toBe(true);
    expect(updateChain(0).set).toHaveBeenCalledWith({ consumedAt: NOW });
  });

  it("refuses a code a parallel request used up first", async () => {
    dbMock.select.mockReturnValueOnce(activeCode());
    dbMock.update.mockReturnValueOnce(chain([]));

    expect(
      await claimEmailCode("user@example.com", "123456", { consume: true }),
    ).toBe(false);
  });

  it("leaves a code that doesn't match alone", async () => {
    dbMock.select.mockReturnValueOnce(activeCode());

    expect(
      await claimEmailCode("user@example.com", "999999", { consume: true }),
    ).toBe(false);
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("checks without consuming when consume is off", async () => {
    dbMock.select.mockReturnValueOnce(activeCode());

    expect(
      await claimEmailCode("user@example.com", "123456", { consume: false }),
    ).toBe(true);
    // The refund only gives the attempt back.
    expect(
      Object.keys(updateChain(1).set.mock.calls[0]?.[0] as object),
    ).toEqual(["attemptCount"]);
  });
});
