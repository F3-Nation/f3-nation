import { beforeEach, describe, expect, it, vi } from "vitest";

const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { createTransport: vi.fn(() => ({ sendMail })), sendMail };
});

vi.mock("nodemailer", () => ({ createTransport }));

import {
  renderOtpEmailHtml,
  renderOtpEmailText,
} from "@acme/auth/lib/otp-email-template";
import { sendOtpEmail } from "@acme/auth/lib/send-otp-email";

const baseParams = {
  identifier: "user@example.com",
  url: "https://map.example.test/api/auth/callback/nodemailer?token=abc",
  server: "smtp://localhost:1025",
  from: "noreply@example.com",
  token: "AB12CD",
};

const sendWithServer = ({ server, from, ...rest }: typeof baseParams) =>
  sendOtpEmail({
    ...rest,
    provider: { server, from },
    expires: new Date(),
    theme: {},
    request: new Request(rest.url),
  } as unknown as Parameters<typeof sendOtpEmail>[0]);

describe("sendOtpEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMail.mockResolvedValue({ rejected: [], pending: [] });
  });

  it("connects with the given server string", async () => {
    await sendWithServer(baseParams);

    expect(createTransport).toHaveBeenCalledWith(baseParams.server);
  });

  it("sends the text body as text and the HTML body as html", async () => {
    await sendWithServer(baseParams);

    expect(sendMail).toHaveBeenCalledWith({
      to: baseParams.identifier,
      from: baseParams.from,
      subject: "Authentication code: AB12CD",
      text: renderOtpEmailText({ host: "map.example.test", token: "AB12CD" }),
      html: renderOtpEmailHtml({ host: "map.example.test", token: "AB12CD" }),
      headers: { "X-SMTPAPI": expect.any(String) as string },
    });
  });

  it("disables SendGrid click and open tracking", async () => {
    await sendWithServer(baseParams);

    const { headers } = sendMail.mock.calls[0]?.[0] as {
      headers: Record<string, string>;
    };
    expect(JSON.parse(headers["X-SMTPAPI"] ?? "{}")).toEqual({
      filters: {
        clicktrack: { settings: { enable: 0 } },
        opentrack: { settings: { enable: 0 } },
      },
    });
  });

  it("escapes the token and host in the HTML body but not the text body", async () => {
    await sendWithServer({ ...baseParams, token: "<b>&" });

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

  it("throws without the address when the recipient is rejected", async () => {
    sendMail.mockResolvedValue({ rejected: ["user@example.com"] });

    const err = await Promise.resolve(sendWithServer(baseParams)).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(
      "OTP email was rejected or left pending by the SMTP server",
    );
    expect((err as Error).message).not.toContain("user@example.com");
  });

  it("throws without the address when the recipient is left pending", async () => {
    sendMail.mockResolvedValue({ rejected: [], pending: ["user@example.com"] });

    const err = await Promise.resolve(sendWithServer(baseParams)).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(
      "OTP email was rejected or left pending by the SMTP server",
    );
    expect((err as Error).message).not.toContain("user@example.com");
  });

  it("rejects a non-string server before connecting", async () => {
    await expect(
      sendOtpEmail({
        identifier: baseParams.identifier,
        url: baseParams.url,
        token: baseParams.token,
        provider: {
          server: { host: "smtp.example.test" },
          from: baseParams.from,
        },
        expires: new Date(),
        theme: {},
        request: new Request(baseParams.url),
      } as unknown as Parameters<typeof sendOtpEmail>[0]),
    ).rejects.toThrow("OTP provider server must be an SMTP connection string");
    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });
});
