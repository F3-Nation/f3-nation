import crypto from "crypto";

import { and, eq, gt, isNull, sql } from "@acme/db";
import { emailMfaCodes, users } from "@acme/db/schema/schema";

import { constantTimeEqual } from "~/lib/crypto-utils";
import { db } from "~/lib/db";
import { env } from "~/env";

const MAX_ATTEMPTS = 5;
const CODE_TTL_MINUTES = 10;

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/**
 * Generate a 6-digit code, hash-store it, and email it to the user.
 * Invalidates any previous active code for that email.
 */
export async function sendEmailCode(email: string): Promise<void> {
  const code = crypto.randomInt(100000, 999999).toString();
  const codeHash = hashCode(code);
  const id = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + CODE_TTL_MINUTES * 60 * 1000,
  ).toISOString();

  // Invalidate previous codes for this email
  await db
    .update(emailMfaCodes)
    .set({ consumedAt: new Date().toISOString() })
    .where(
      and(
        eq(emailMfaCodes.email, email.toLowerCase()),
        isNull(emailMfaCodes.consumedAt),
        gt(emailMfaCodes.expiresAt, new Date().toISOString()),
      ),
    );

  // Insert new code
  await db.insert(emailMfaCodes).values({
    id,
    email: email.toLowerCase(),
    codeHash,
    expiresAt,
    attemptCount: 0,
  });

  // Build the magic link
  const authUrl = env.NEXT_PUBLIC_AUTH_URL;
  const magicLink = `${authUrl}/login/email/verify?email=${encodeURIComponent(email)}&code=${code}`;

  // Send via SendGrid SMTP
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport(
    env.NODE_ENV === "production"
      ? {
          host: "smtp.sendgrid.net",
          port: 587,
          secure: false,
          auth: {
            user: "apikey",
            pass: env.SENDGRID_API_KEY,
          },
        }
      : await nodemailer.createTestAccount().then(({ user, pass }) => ({
          host: "smtp.ethereal.email",
          port: 587,
          secure: false,
          auth: { user, pass },
        })),
  );

  const info = await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: email,
    subject: "Your F3 Nation sign-in code",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Your verification code</h2>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 16px; background: #f5f5f5; border-radius: 8px;">${code}</p>
        <p>This code expires in ${CODE_TTL_MINUTES} minutes.</p>
        <p>Or click the link below to sign in automatically:</p>
        <p><a href="${magicLink}">Sign in to F3 Nation</a></p>
        <p style="color: #666; font-size: 12px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });

  if (env.NODE_ENV !== "production") {
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log("Preview email:", previewUrl);
    }
  }
}

/**
 * Verify a 6-digit code against the stored hash.
 * Returns the user if verification succeeds, null otherwise.
 */
export async function verifyEmailCode(
  email: string,
  code: string,
): Promise<{ id: number; email: string; f3Name: string | null } | null> {
  const normalizedEmail = email.toLowerCase();
  const now = new Date().toISOString();

  // Find the active code for this email
  const [mfaCode] = await db
    .select()
    .from(emailMfaCodes)
    .where(
      and(
        eq(emailMfaCodes.email, normalizedEmail),
        isNull(emailMfaCodes.consumedAt),
        gt(emailMfaCodes.expiresAt, now),
      ),
    )
    .limit(1);

  if (!mfaCode) return null;

  // Check brute-force lockout
  if (mfaCode.attemptCount >= MAX_ATTEMPTS) return null;

  const expectedHash = hashCode(code);

  if (!constantTimeEqual(mfaCode.codeHash, expectedHash)) {
    // Increment attempt count
    await db
      .update(emailMfaCodes)
      .set({ attemptCount: sql`${emailMfaCodes.attemptCount} + 1` })
      .where(eq(emailMfaCodes.id, mfaCode.id));
    return null;
  }

  // Mark code as consumed
  await db
    .update(emailMfaCodes)
    .set({ consumedAt: now })
    .where(eq(emailMfaCodes.id, mfaCode.id));

  // Find or signal user creation
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      emailVerified: users.emailVerified,
      f3Name: users.f3Name,
    })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  if (user) {
    // Mark email as verified if not already (direct DB write — avoids
    // crupdate's roles-diffing which would wipe existing roles)
    if (!user.emailVerified) {
      await db
        .update(users)
        .set({ emailVerified: now })
        .where(eq(users.id, user.id));
    }
    return user;
  }

  // User doesn't exist — registration required
  return null;
}
