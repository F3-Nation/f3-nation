import type { NodemailerConfig } from "next-auth/providers/nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { createTransport } from "nodemailer";

import { renderOtpEmailHtml, renderOtpEmailText } from "./otp-email-template";

export const sendVerificationRequest = async (
  params: Omit<
    Parameters<NodemailerConfig["sendVerificationRequest"]>[0],
    "provider" | "theme" | "expires" | "request"
  > & {
    // Arrives as a JSON body over HTTP (see ../otp/route.tsx), so it's always
    // a plain SMTP connection string, never NodemailerConfig["server"]'s full
    // config-time union (which also resolves to `any` under nodemailer 10 --
    // see send-otp-verification-request-server.ts for why).
    server: string;
    from: NodemailerConfig["from"];
  },
) => {
  const { identifier, url, server, from, token } = params;
  const { host } = new URL(url);

  const transport = createTransport(server as SMTPTransport.Options);
  const subject = `Authentication code: ${token}`;
  const result = await transport.sendMail({
    to: identifier,
    from: from,
    subject,
    text: renderOtpEmailText({ host, token }),
    html: renderOtpEmailHtml({ host, token }),
  });
  const failed = result.rejected.concat(result.pending ?? []).filter(Boolean);
  if (failed.length) {
    throw new Error(`Email (${failed.join(", ")}) could not be sent`);
  }
};
