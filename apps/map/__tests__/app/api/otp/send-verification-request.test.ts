import { beforeEach, describe, expect, it, vi } from "vitest";

const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { createTransport: vi.fn(() => ({ sendMail })), sendMail };
});

vi.mock("nodemailer", () => ({ createTransport }));

import {
  renderOtpEmailHtml,
  renderOtpEmailText,
} from "~/app/api/otp/otp-email-template";
import { sendVerificationRequest } from "~/app/api/otp/send-verification-request";

const baseParams = {
  identifier: "user@example.com",
  url: "https://map.example.test/api/auth/callback/nodemailer?token=abc",
  server: "smtp://localhost:1025",
  from: "noreply@example.com",
  token: "AB12CD",
};

describe("sendVerificationRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMail.mockResolvedValue({ rejected: [], pending: [] });
  });

  it("connects with the given server string", async () => {
    await sendVerificationRequest(baseParams);

    expect(createTransport).toHaveBeenCalledWith(baseParams.server);
  });

  it("sends the text body as text and the HTML body as html", async () => {
    await sendVerificationRequest(baseParams);

    expect(sendMail).toHaveBeenCalledWith({
      to: baseParams.identifier,
      from: baseParams.from,
      subject: "Authentication code: AB12CD",
      text: renderOtpEmailText({ host: "map.example.test", token: "AB12CD" }),
      html: renderOtpEmailHtml({ host: "map.example.test", token: "AB12CD" }),
    });
  });

  it("escapes the token and host in the HTML body but not the text body", async () => {
    await sendVerificationRequest({ ...baseParams, token: "<b>&" });

    const { html, text } = sendMail.mock.calls[0]?.[0] as {
      html: string;
      text: string;
    };
    expect(html).toContain("&lt;b&gt;&amp;");
    expect(html).toContain("map&#8203;.example&#8203;.test");
    expect(html).not.toContain("<b>");
    expect(text).toContain("map.example.test");
    expect(text).not.toContain("<html");
  });

  it("throws when the recipient is rejected", async () => {
    sendMail.mockResolvedValue({ rejected: ["user@example.com"] });

    await expect(sendVerificationRequest(baseParams)).rejects.toThrow(
      "Email (user@example.com) could not be sent",
    );
  });

  it("throws when the recipient is left pending", async () => {
    sendMail.mockResolvedValue({ rejected: [], pending: ["user@example.com"] });

    await expect(sendVerificationRequest(baseParams)).rejects.toThrow(
      "could not be sent",
    );
  });
});
