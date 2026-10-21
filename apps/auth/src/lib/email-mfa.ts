import crypto from "crypto";

import { createTransport } from "nodemailer";

import { and, eq, gt, isNull, lt, sql } from "@acme/db";
import { emailMfaCodes, users } from "@acme/db/schema/schema";

import { isValidCallbackUrl } from "~/lib/callback-url";
import { constantTimeEqual } from "~/lib/crypto-utils";
import { db } from "~/lib/db";
import { logWarn } from "~/lib/logging";
import { NO_TRACKING_HEADERS } from "~/lib/mail-headers";
import { env } from "~/env";

const MAX_ATTEMPTS = 5;
const CODE_TTL_MINUTES = 10;

let _transporter: ReturnType<typeof createTransport> | null = null;
function getTransporter() {
  _transporter ??= createTransport(env.EMAIL_SERVER);
  return _transporter;
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/**
 * Hash-store a code for an already-normalized email, invalidating any
 * previous active code for that email.
 */
async function storeCode(normalizedEmail: string, code: string): Promise<void> {
  const expiresAt = new Date(
    Date.now() + CODE_TTL_MINUTES * 60 * 1000,
  ).toISOString();

  // Invalidate previous codes for this email
  await db
    .update(emailMfaCodes)
    .set({ consumedAt: new Date().toISOString() })
    .where(
      and(
        eq(emailMfaCodes.email, normalizedEmail),
        isNull(emailMfaCodes.consumedAt),
        gt(emailMfaCodes.expiresAt, new Date().toISOString()),
      ),
    );

  // Insert new code
  await db.insert(emailMfaCodes).values({
    id: crypto.randomUUID(),
    email: normalizedEmail,
    codeHash: hashCode(code),
    expiresAt,
    attemptCount: 0,
  });
}

/**
 * Hash-store a code that something else generated and emailed — Better
 * Auth's emailOTP plugin, whose own hashed store can't be checked without
 * consuming the code. Recording it here lets /api/register prove email
 * ownership with checkEmailCode on either auth backend.
 */
export async function recordEmailCode(
  email: string,
  code: string,
): Promise<void> {
  await storeCode(email.toLowerCase().trim(), code);
}

/**
 * Generate a 6-digit code, hash-store it, and email it to the user.
 * Invalidates any previous active code for that email.
 *
 * @param callbackUrl - Optional URL to redirect to after sign-in via magic link.
 */
export async function sendEmailCode(
  email: string,
  callbackUrl?: string,
): Promise<void> {
  // Normalize early so all downstream usage (DB keys, magic link URL) is consistent.
  const normalizedEmail = email.toLowerCase().trim();

  const code = crypto.randomInt(100000, 999999).toString();
  await storeCode(normalizedEmail, code);

  // Build the magic link — include callbackUrl so clicking the link lands
  // back in the originating app, not on the auth homepage.
  // Only embed the callbackUrl if it is same-origin or a relative path;
  // this prevents open-redirect attacks via crafted magic links.
  const authUrl = env.NEXT_PUBLIC_AUTH_URL;
  const verifyParams = new URLSearchParams({ email: normalizedEmail, code });
  if (callbackUrl && isValidCallbackUrl(callbackUrl, authUrl)) {
    verifyParams.set("callbackUrl", callbackUrl);
  } else if (callbackUrl) {
    // Log only origin + path of the rejected URL — enough for open-redirect
    // forensics, without persisting any query/fragment that could carry
    // injected tokens or PII.
    let sanitizedCallbackUrl: string;
    try {
      const parsed = new URL(callbackUrl, authUrl);
      sanitizedCallbackUrl = `${parsed.origin}${parsed.pathname}`;
    } catch {
      sanitizedCallbackUrl = "unparseable";
    }
    logWarn("auth.email_mfa.invalid_callback_url", {
      callbackUrl: sanitizedCallbackUrl,
    });
  }
  const magicLink = `${authUrl}/login/email/verify?${verifyParams.toString()}`;

  const transporter = getTransporter();

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: normalizedEmail,
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
    headers: NO_TRACKING_HEADERS,
  });
}

/**
 * Find the active code row for this email and compare it to `code`. A
 * mismatch counts toward the brute-force lockout; a match gives its attempt
 * back, and is marked consumed when `consume` is set.
 */
async function findMatchingCode(
  email: string,
  code: string,
  { consume = false }: { consume?: boolean } = {},
) {
  // Same normalization storeCode's callers use.
  const normalizedEmail = email.toLowerCase().trim();
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

  // Claim an attempt before comparing, in one conditional update, so a burst
  // of parallel guesses can't all read "0 attempts used" and each get a free
  // try. A new code starts a fresh row.
  const [claimed] = await db
    .update(emailMfaCodes)
    .set({ attemptCount: sql`${emailMfaCodes.attemptCount} + 1` })
    .where(
      and(
        eq(emailMfaCodes.id, mfaCode.id),
        lt(emailMfaCodes.attemptCount, MAX_ATTEMPTS),
      ),
    )
    .returning({ id: emailMfaCodes.id });
  if (!claimed) return null;

  if (!constantTimeEqual(mfaCode.codeHash, hashCode(code))) return null;

  // Only wrong guesses count, so the owner's registration check and the
  // sign-in after it don't eat into their 5 tries.
  await db
    .update(emailMfaCodes)
    .set({
      attemptCount: sql`${emailMfaCodes.attemptCount} - 1`,
      ...(consume && { consumedAt: now }),
    })
    .where(eq(emailMfaCodes.id, mfaCode.id));

  return mfaCode;
}

/**
 * Check a code without consuming it — proof that the caller owns `email`,
 * for steps (registration) that must run before the sign-in that consumes
 * the code. A wrong code spends one of the code's attempts, the same budget
 * sign-in draws on.
 */
export async function checkEmailCode(
  email: string,
  code: string,
): Promise<boolean> {
  return (await findMatchingCode(email, code)) !== null;
}

/**
 * Better Auth's claimOtpAttempt: checkEmailCode, except that with `consume`
 * a matching code is used up. Sign-in passes it, since Better Auth verifies
 * against its own store and the email_mfa_codes copy shouldn't stay
 * replayable at /api/register afterwards.
 */
export async function claimEmailCode(
  email: string,
  code: string,
  options: { consume: boolean },
): Promise<boolean> {
  return (await findMatchingCode(email, code, options)) !== null;
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

  const mfaCode = await findMatchingCode(email, code, { consume: true });
  if (!mfaCode) return null;

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
