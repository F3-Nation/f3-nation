/**
 * Email delivery for the Better Auth emailOTP plugin.
 *
 * Deliberately separate from apps/auth/src/lib/email-mfa.ts's
 * sendEmailCode: that function generates and stores its own code (for the
 * hand-rolled server's email_mfa_codes table); this one just delivers a
 * code Better Auth already generated and is storing itself. Reuses the same
 * EMAIL_SERVER transport and template style rather than inventing a second
 * one — see apps/auth/AGENTS.md for how EMAIL_SERVER resolves locally
 * (Mailpit) vs in production (SendGrid).
 */
import { createTransport } from "nodemailer";

import { env } from "~/env";

let _transporter: ReturnType<typeof createTransport> | null = null;
function getTransporter() {
  _transporter ??= createTransport(env.EMAIL_SERVER);
  return _transporter;
}

export async function sendBetterAuthOtpEmail(
  email: string,
  otp: string,
): Promise<void> {
  const transporter = getTransporter();

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: email,
    subject: "Your F3 Nation sign-in code",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Your verification code</h2>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 16px; background: #f5f5f5; border-radius: 8px;">${otp}</p>
        <p>This code expires in 10 minutes.</p>
        <p style="color: #666; font-size: 12px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
}
