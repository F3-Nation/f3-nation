import type { NodemailerConfig } from "next-auth/providers/nodemailer";
import { createTransport } from "nodemailer";

import { renderOtpEmailHtml, renderOtpEmailText } from "./otp-email-template";

/**
 * Mails the sign-in code through the provider's own SMTP settings, in this
 * process. Keep delivery here: under `trustHost` the sign-in URL's host can
 * follow the request's Host header, so a call to any host derived from it
 * could hand the SMTP credentials and the code to whoever set that header.
 */
export const sendOtpEmail: NodemailerConfig["sendVerificationRequest"] = async (
  params,
) => {
  const { identifier, url, provider, token } = params;
  const { host } = new URL(url);

  // This provider is configured with an SMTP connection string; refuse any
  // other transport config before connecting.
  if (typeof provider.server !== "string") {
    throw new Error("OTP provider server must be an SMTP connection string");
  }
  const transport = createTransport(provider.server);
  const result = await transport.sendMail({
    to: identifier,
    from: provider.from,
    subject: `Authentication code: ${token}`,
    text: renderOtpEmailText({ host, token }),
    html: renderOtpEmailHtml({ host, token }),
    // Disable SendGrid click/open tracking on auth mail.
    headers: {
      "X-SMTPAPI": JSON.stringify({
        filters: {
          clicktrack: { settings: { enable: 0 } },
          opentrack: { settings: { enable: 0 } },
        },
      }),
    },
  });
  const failed = result.rejected.concat(result.pending ?? []).filter(Boolean);
  if (failed.length) {
    throw new Error(
      "OTP email was rejected or left pending by the SMTP server",
    );
  }
};
