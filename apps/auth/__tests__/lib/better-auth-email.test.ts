import { beforeEach, describe, expect, it, vi } from "vitest";

const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { createTransport: vi.fn(() => ({ sendMail })), sendMail };
});

const { recordEmailCode } = vi.hoisted(() => ({ recordEmailCode: vi.fn() }));

vi.mock("nodemailer", () => ({ createTransport }));
vi.mock("~/lib/email-mfa", () => ({ recordEmailCode }));
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
    );
    expect(order).toEqual(["record", "send"]);
  });

  it("only mails codes of other types", async () => {
    await deliverBetterAuthOtp({
      email: "user@example.com",
      otp: "123456",
      type: "email-verification",
    });

    expect(recordEmailCode).not.toHaveBeenCalled();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});
