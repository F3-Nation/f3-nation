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

import { EmailCodeRateLimitedError, recordEmailCode } from "~/lib/email-mfa";
import { logWarn } from "~/lib/logging";
import { NO_TRACKING_HEADERS } from "~/lib/mail-headers";
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
    headers: NO_TRACKING_HEADERS,
  });
}

/**
 * Better Auth's sendVerificationOTP callback. Every code is recorded in
 * email_mfa_codes first, filling in the send the hooks.before check in
 * better-auth.ts reserved for it under the address's limit (the same one
 * sendEmailCode enforces). Sign-in codes are recorded checkable: Better
 * Auth's own store burns a code on any read, and /api/register checks
 * ownership there without consuming it (checkEmailCode).
 *
 * The limit itself is settled in that reservation, before the code is
 * generated. If a caller skipped it and the address is over the limit,
 * nothing is sent; Better Auth runs this callback through
 * runInBackgroundOrAwait, which catches anything it throws.
 */
export async function deliverBetterAuthOtp({
  email,
  otp,
  type,
}: {
  email: string;
  otp: string;
  type: string;
}): Promise<void> {
  try {
    await recordEmailCode(email, otp, { checkable: type === "sign-in" });
  } catch (err) {
    if (err instanceof EmailCodeRateLimitedError) {
      logWarn("auth.better_auth.otp_send_rate_limited", { type });
      return;
    }
    throw err;
  }
  await sendBetterAuthOtpEmail(email, otp);
}
