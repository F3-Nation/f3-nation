import { beforeEach, describe, expect, it, vi } from "vitest";

const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { createTransport: vi.fn(() => ({ sendMail })), sendMail };
});

vi.mock("nodemailer", () => ({ createTransport }));
vi.mock("~/env", () => ({
  env: {
    EMAIL_SERVER: "smtp://localhost:1025",
    EMAIL_FROM: "noreply@f3nation.com",
  },
}));

const { sendBetterAuthOtpEmail } =
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
    expect(callArgs.from).toBe("noreply@f3nation.com");
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
