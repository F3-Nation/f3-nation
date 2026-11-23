import { beforeEach, describe, expect, it, vi } from "vitest";

const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { createTransport: vi.fn(() => ({ sendMail })), sendMail };
});

const { EmailCodeRateLimitedError, recordEmailCode, logWarn } = vi.hoisted(
  () => ({
    EmailCodeRateLimitedError: class EmailCodeRateLimitedError extends Error {},
    recordEmailCode: vi.fn(),
    logWarn: vi.fn(),
  }),
);

vi.mock("nodemailer", () => ({ createTransport }));
vi.mock("~/lib/email-mfa", () => ({
  EmailCodeRateLimitedError,
  recordEmailCode,
}));
vi.mock("~/lib/logging", () => ({ logWarn }));
vi.mock("~/env", () => ({
  env: {
    EMAIL_SERVER: "smtp://localhost:1025",
    EMAIL_FROM: "noreply@example.com",
  },
}));

const { deliverBetterAuthOtp, sendBetterAuthOtpEmail } =
  await import("../../src/lib/better-auth-email");

interface TestMailOptions {
  from?: string;
  to?: string;
  subject?: string;
  html?: string;
  headers?: Record<string, string>;
}

describe("sendBetterAuthOtpEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMail.mockResolvedValue({ messageId: "test-msg-id" });
  });

  it("sends the OTP over EMAIL_SERVER with SendGrid click/open tracking disabled", async () => {
    await sendBetterAuthOtpEmail("user@example.com", "123456");

    expect(createTransport).toHaveBeenCalledWith("smtp://localhost:1025");
    expect(sendMail).toHaveBeenCalledTimes(1);

    const callArgs = (sendMail.mock.calls[0]?.[0] ?? {}) as TestMailOptions;
    expect(callArgs.from).toBe("noreply@example.com");
    expect(callArgs.to).toBe("user@example.com");
    expect(callArgs.subject).toBe("Your F3 Nation sign-in code");
    expect(callArgs.html).toContain("123456");

    expect(JSON.parse(callArgs.headers?.["X-SMTPAPI"] ?? "{}")).toEqual({
      filters: {
        clicktrack: { settings: { enable: 0 } },
        opentrack: { settings: { enable: 0 } },
      },
    });
  });
});

describe("deliverBetterAuthOtp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMail.mockResolvedValue({ messageId: "test-msg-id" });
  });

  it("records a sign-in code for /api/register before mailing it", async () => {
    const order: string[] = [];
    recordEmailCode.mockImplementation(() => order.push("record"));
    sendMail.mockImplementation(() => order.push("send"));

    await deliverBetterAuthOtp({
      email: "user@example.com",
      otp: "123456",
      type: "sign-in",
    });

    expect(recordEmailCode).toHaveBeenCalledExactlyOnceWith(
      "user@example.com",
      "123456",
      { checkable: true },
    );
    expect(order).toEqual(["record", "send"]);
  });

  it.each(["email-verification", "forget-password", "change-email"])(
    "counts a %s code toward the send limit without making it checkable",
    async (type) => {
      await deliverBetterAuthOtp({
        email: "user@example.com",
        otp: "123456",
        type,
      });

      expect(recordEmailCode).toHaveBeenCalledExactlyOnceWith(
        "user@example.com",
        "123456",
        { checkable: false },
      );
      expect(sendMail).toHaveBeenCalledTimes(1);
    },
  );

  it("sends nothing once the address is over the send limit", async () => {
    recordEmailCode.mockRejectedValueOnce(new EmailCodeRateLimitedError());

    await deliverBetterAuthOtp({
      email: "user@example.com",
      otp: "123456",
      type: "sign-in",
    });

    expect(sendMail).not.toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalledExactlyOnceWith(
      "auth.better_auth.otp_send_rate_limited",
      { type: "sign-in" },
    );
  });

  it("sends nothing and rethrows when recording fails for another reason", async () => {
    const failure = new Error("db down");
    recordEmailCode.mockRejectedValueOnce(failure);

    await expect(
      deliverBetterAuthOtp({
        email: "user@example.com",
        otp: "123456",
        type: "sign-in",
      }),
    ).rejects.toBe(failure);
    expect(sendMail).not.toHaveBeenCalled();
    expect(logWarn).not.toHaveBeenCalled();
  });
});
